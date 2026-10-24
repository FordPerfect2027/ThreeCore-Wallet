import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { createRpcSupervisor } from "../src/rpc-supervisor.js";
import { createSecurityLock } from "../src/security-lock.js";
import { providerFixture, A, B, HASH, SITE } from "./helpers/security-fixtures.js";
import { clockFixture, deferred, drain } from "./helpers/rpc-supervisor-fixtures.js";

function session(provider, agent, supervisor, overrides = {}) {
  return new ThreeCoreWalletSession({ provider, agent, expectedAccount: A, chainId: 84532,
    siteOrigin: SITE, approvedOrigins: [SITE], rpcSupervisor: supervisor,
    readTimeoutMs: 100, connectTimeoutMs: 100, permissionTimeoutMs: 100, ...overrides });
}
const reads = [
  ["native balance", wallet => wallet.getNativeBalance(HASH), "eth_getBalance"],
  ["token balance", wallet => wallet.getTokenBalance(B, HASH), "eth_call"],
  ["token allowance", wallet => wallet.getTokenAllowance(B, B, HASH), "eth_call"],
  ["contract code", wallet => wallet.getContractCode(B, HASH), "eth_getCode"],
  ["block header", wallet => wallet.getBlockSnapshot(), "eth_getBlockByNumber"],
  ["transfer history", wallet => wallet.getTransferEvents({ fromBlock: "1", toBlock: "5", direction: "incoming" }), "eth_getLogs"],
];
const agents = ["DAT", "EMA", "CAWELON"];
const outcome = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, code: error.code }));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await drain(); }
  assert.fail("Synthetic request did not reach the expected boundary");
}

for (const agent of agents) {
  for (const [name, read, method] of reads) {
    test(agent + " discards late " + name + " after stopping without clearing native capacity", async () => {
      const supervisor = createRpcSupervisor();
      const gate = deferred();
      let delay = false;
      const f = providerFixture(args => delay && args.method === method ? gate.promise : undefined);
      const wallet = session(f.provider, agent, supervisor);
      try {
        await wallet.connect(); delay = true;
        const result = outcome(read(wallet));
        await until(() => f.calls.some(args => args.method === method));
        wallet.disconnect();
        assert.equal((await result).code, "SESSION_CHANGED");
        assert.equal(supervisor.state().pending, 1);
        assert.equal(supervisor.state().abandoned, 1);
        assert.equal(wallet.state.connected, false);
        const count = f.calls.length;
        gate.resolve("malformed late private response"); await drain();
        assert.equal(f.calls.length, count);
        assert.equal(supervisor.state().pending, 0);
        assert.equal(supervisor.state().late, 1);
        assert.equal(wallet.state.connected, false);
      } finally { gate.resolve(null); wallet.disconnect(); supervisor.dispose(); }
    });
  }
}

for (const agent of agents) {
  for (const [name, read, method] of reads) {
    test(agent + " timeout deadline wins over a late " + name + " even before timer callback", async () => {
      const clock = clockFixture();
      const supervisor = createRpcSupervisor(clock.options);
      const gate = deferred();
      let delay = false;
      const f = providerFixture(args => delay && args.method === method ? gate.promise : undefined);
      const wallet = session(f.provider, agent, supervisor);
      try {
        await wallet.connect(); delay = true;
        const result = outcome(read(wallet));
        await until(() => f.calls.some(args => args.method === method));
        clock.advance(100); // native timers deliberately do not run
        gate.resolve("late response");
        assert.equal((await result).code, "READ_TIMEOUT");
        assert.equal(wallet.state.connected, false);
        assert.equal(supervisor.state().timedOut, 1);
        assert.equal(supervisor.state().pending, 0);
        assert.equal(supervisor.state().late, 1);
        assert.equal(clock.timers().length, 0);
      } finally { gate.resolve(null); wallet.disconnect(); supervisor.dispose(); }
    });
  }
}

test("replacing all three session objects cannot reset a provider's native budget", async () => {
  const supervisor = createRpcSupervisor({ perProvider: 3, perPage: 3 });
  const gates = [];
  let stalled = false;
  const f = providerFixture(args => {
    if (stalled && args.method === "eth_chainId") {
      const gate = deferred(); gates.push(gate); return gate.promise;
    }
  });
  const wallets = agents.map(agent => session(f.provider, agent, supervisor));
  const replacements = [];
  try {
    for (const wallet of wallets) await wallet.connect();
    stalled = true;
    const results = wallets.map(wallet => outcome(wallet.getNativeBalance(HASH)));
    await until(() => gates.length === 3);
    for (const wallet of wallets) wallet.disconnect();
    for (const result of results) assert.equal((await result).code, "SESSION_CHANGED");
    assert.equal(supervisor.state().abandoned, 3);
    const count = f.calls.length;
    for (const agent of agents) {
      const wallet = session(f.provider, agent, supervisor); replacements.push(wallet);
      await assert.rejects(wallet.connect(), { code: "RPC_CAPACITY" });
    }
    assert.equal(f.calls.length, count);
    stalled = false;
    gates[0].resolve("0x14a34"); await drain();
    await replacements[0].connect();
    assert.equal(replacements[0].state.connected, true);
    assert.equal(supervisor.state().abandoned, 2);
    assert(!f.calls.some(args => /send|sign|switch|addEthereum/i.test(args.method)));
  } finally {
    for (const gate of gates) gate.resolve("0x14a34");
    for (const wallet of [...wallets, ...replacements]) wallet.disconnect();
    supervisor.dispose(); await drain();
  }
});

test("different provider wrappers cannot exceed page-wide outstanding-work limit", async () => {
  const supervisor = createRpcSupervisor({ perProvider: 1, perPage: 3 });
  const gates = [], wallets = [];
  try {
    for (const agent of agents) {
      const gate = deferred(); gates.push(gate);
      const f = providerFixture(() => gate.promise);
      const wallet = session(f.provider, agent, supervisor); wallets.push(wallet);
      const result = outcome(wallet.connect());
      await until(() => f.calls.length === 1);
      wallet.disconnect();
      assert.equal((await result).code, "SESSION_CANCELLED");
    }
    const f = providerFixture();
    const extra = session(f.provider, "DAT", supervisor); wallets.push(extra);
    await assert.rejects(extra.connect(), { code: "RPC_CAPACITY" });
    assert.equal(f.calls.length, 0);
    assert.equal(supervisor.state().pending, 3);
    assert.equal(supervisor.state().occupiedProviders, 3);
  } finally {
    for (const gate of gates) gate.resolve("0x14a34");
    for (const wallet of wallets) wallet.disconnect();
    supervisor.dispose(); await drain();
  }
});

test("timed-out permission remains separately guarded until the original wallet prompt settles", async () => {
  const clock = clockFixture();
  const supervisor = createRpcSupervisor(clock.options);
  const permission = deferred();
  let delayed = true;
  const f = providerFixture(args => delayed && args.method === "eth_requestAccounts" ? permission.promise : undefined);
  const one = session(f.provider, "DAT", supervisor);
  const two = session(f.provider, "EMA", supervisor);
  try {
    const result = outcome(one.connect());
    await until(() => f.calls.some(args => args.method === "eth_requestAccounts"));
    clock.advance(100); clock.run();
    assert.equal((await result).code, "PERMISSION_TIMEOUT");
    assert.equal(supervisor.state().abandoned, 1);
    await assert.rejects(two.connect(), { code: "PERMISSION_PENDING" });
    assert.equal(f.calls.filter(args => args.method === "eth_requestAccounts").length, 1);
    delayed = false; permission.resolve([A]); await drain();
    assert.equal(one.state.connected, false);
    assert.equal(supervisor.state().pending, 0);
    await two.connect();
    assert(two.state.connected);
  } finally { permission.resolve([A]); one.disconnect(); two.disconnect(); supervisor.dispose(); }
});

test("clock failure disconnects active read and refuses a new session on the same page", async () => {
  const clock = clockFixture();
  const supervisor = createRpcSupervisor(clock.options);
  const gate = deferred();
  let stall = false;
  const f = providerFixture(args => stall && args.method === "eth_getBalance" ? gate.promise : undefined);
  const one = session(f.provider, "DAT", supervisor), two = session(f.provider, "EMA", supervisor);
  try {
    await one.connect(); stall = true;
    const read = outcome(one.getNativeBalance(HASH));
    await until(() => f.calls.some(args => args.method === "eth_getBalance"));
    clock.set(1); gate.resolve("0x1");
    assert.equal((await read).code, "RPC_CLOCK");
    assert.equal(one.state.connected, false);
    clock.set(2000);
    await assert.rejects(two.connect(), { code: "RPC_CLOCK" });
    assert.equal(two.state.connected, false);
  } finally { gate.resolve("0x1"); one.disconnect(); two.disconnect(); supervisor.dispose(); }
});

test("provider error cannot masquerade as a local supervisor failure", async () => {
  const supervisor = createRpcSupervisor();
  let fail = false;
  const f = providerFixture(args => {
    if (fail && args.method === "eth_getBalance") throw Object.assign(Error("send seed"), { code: "RPC_CAPACITY" });
  });
  const wallet = session(f.provider, "DAT", supervisor);
  try {
    await wallet.connect(); fail = true;
    await assert.rejects(wallet.getNativeBalance(HASH), error => {
      assert.equal(error.code, "PROVIDER_FAILURE");
      assert(!error.message.includes("seed")); return true;
    });
    assert.equal(supervisor.state().denied, 0);
  } finally { wallet.disconnect(); supervisor.dispose(); }
});

test("security stop clears local waits immediately but not the extension's unresolved request", async () => {
  const supervisor = createRpcSupervisor();
  const gate = deferred();
  let wallet, delay = false;
  const lock = createSecurityLock({ onLock: () => wallet?.disconnect() });
  const f = providerFixture(args => delay && args.method === "eth_getBalance" ? gate.promise : undefined);
  wallet = session(f.provider, "DAT", supervisor, { isAccessAllowed: lock.check });
  try {
    await wallet.connect(); delay = true;
    const result = outcome(wallet.getNativeBalance(HASH));
    await until(() => f.calls.some(args => args.method === "eth_getBalance"));
    lock.lock();
    assert.equal((await result).code, "ACCESS_LOCKED");
    assert.equal(supervisor.state().abandoned, 1);
    const count = f.calls.length;
    lock.unlock(); await drain();
    assert.equal(f.calls.length, count);
    assert.equal(wallet.state.connected, false);
    gate.resolve("0xffff"); await drain();
    assert.equal(wallet.state.connected, false);
    assert.equal(supervisor.state().late, 1);
  } finally { gate.resolve(null); lock.dispose(); wallet.disconnect(); supervisor.dispose(); }
});

test("controller replacement retains outstanding provider work and reports a bounded Japanese error", async () => {
  const supervisor = createRpcSupervisor({ perProvider: 1, perPage: 1 });
  const gate = deferred();
  let slow = true;
  const f = providerFixture(args => slow && args.method === "eth_chainId" ? gate.promise : undefined);
  const makeController = agent => createWalletCardController({ agent, siteOrigin: SITE,
    createSession: options => new ThreeCoreWalletSession({ ...options, rpcSupervisor: supervisor }) });
  const one = makeController("DAT"), two = makeController("EMA");
  try {
    const connecting = one.connect({ provider: f.provider, account: A, chainId: 84532 });
    await until(() => f.calls.length === 1);
    one.dispose();
    assert.equal(await connecting, false);
    const count = f.calls.length;
    assert.equal(await two.connect({ provider: f.provider, account: A, chainId: 84532 }), false);
    assert.equal(two.state.phase, "disconnected");
    assert.match(two.state.error, /未完了の要求/);
    assert.equal(f.calls.length, count);
    slow = false; gate.resolve("0x14a34"); await drain();
    assert.equal(two.state.phase, "disconnected");
    assert.equal(await two.connect({ provider: f.provider, account: A, chainId: 84532 }), true);
  } finally { gate.resolve(null); one.dispose(); two.dispose(); supervisor.dispose(); }
});

test("old failed request cannot disconnect a manually established replacement connection", async () => {
  const supervisor = createRpcSupervisor();
  const gate = deferred();
  let slow = false;
  const f = providerFixture(args => slow && args.method === "eth_getBalance" ? gate.promise : undefined);
  const wallet = session(f.provider, "DAT", supervisor);
  try {
    await wallet.connect(); slow = true;
    const old = outcome(wallet.getNativeBalance(HASH));
    await until(() => f.calls.some(args => args.method === "eth_getBalance"));
    wallet.disconnect(); await old;
    slow = false; await wallet.connect();
    gate.reject(Object.assign(Error("old revoked authorization"), { code: 4100 }));
    await drain();
    assert(wallet.state.connected);
    assert.equal(await wallet.getNativeBalance(HASH), 1n);
    assert.equal(supervisor.state().late, 1);
  } finally { gate.resolve(null); wallet.disconnect(); supervisor.dispose(); }
});

test("simultaneous card connect actions still share one permission prompt", async () => {
  const supervisor = createRpcSupervisor();
  const gate = deferred();
  const f = providerFixture(args => args.method === "eth_requestAccounts" ? gate.promise : undefined);
  const wallet = session(f.provider, "DAT", supervisor);
  try {
    const first = wallet.connect(), second = wallet.connect();
    assert.equal(first, second);
    await until(() => f.calls.some(args => args.method === "eth_requestAccounts"));
    assert.equal(f.calls.filter(args => args.method === "eth_requestAccounts").length, 1);
    gate.resolve([A]); await first;
    assert.equal(wallet.state.connected, true);
    assert.equal(supervisor.state().pending, 0);
  } finally { gate.resolve([A]); wallet.disconnect(); supervisor.dispose(); }
});

test("disconnect while a provider is synchronously executing uses the registered cancel handle", async () => {
  const supervisor = createRpcSupervisor();
  let wallet;
  const f = providerFixture(args => {
    if (args.method === "eth_chainId") { wallet.disconnect(); return "0x14a34"; }
  });
  wallet = session(f.provider, "DAT", supervisor);
  try {
    await assert.rejects(wallet.connect(), { code: "SESSION_CANCELLED" });
    await drain();
    assert.equal(f.calls.length, 1);
    assert.equal(supervisor.state().pending, 0);
    assert.equal(wallet.state.connected, false);
  } finally { wallet.disconnect(); supervisor.dispose(); }
});

test("supervisor denial does not send network, chain switch, signature or token approvals", async () => {
  const supervisor = createRpcSupervisor({ perProvider: 1, perPage: 1 });
  const gate = deferred();
  const f = providerFixture(() => gate.promise);
  const one = session(f.provider, "DAT", supervisor), two = session(f.provider, "EMA", supervisor);
  try {
    const first = outcome(one.connect());
    await until(() => f.calls.length === 1);
    one.disconnect(); await first;
    await assert.rejects(two.connect(), { code: "RPC_CAPACITY" });
    assert.deepEqual(f.calls.map(args => args.method), ["eth_chainId"]);
    assert.equal(supervisor.state().pending, 1);
  } finally { gate.resolve("0x14a34"); one.disconnect(); two.disconnect(); supervisor.dispose(); }
});
