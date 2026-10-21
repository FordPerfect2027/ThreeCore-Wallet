import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";

const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "22".repeat(20);
const SPENDER = "0x" + "33".repeat(20);
const BLOCK = { number: "0x2a", hash: "0x" + "ab".repeat(32) };
const options = { tokenAddress: TOKEN, spenderAddress: SPENDER };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
// Flush promise continuations without advancing the controlled deadline clock.
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function observe(promise) {
  const result = { status: "pending" };
  promise.then(value => Object.assign(result, { status: "fulfilled", value }),
    error => Object.assign(result, { status: "rejected", error }));
  return result;
}
function fixture(config = {}) {
  let override = () => undefined;
  const calls = [], listeners = new Map();
  const provider = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); },
    emit(event, data) { for (const fn of [...listeners.get(event) ?? []]) fn(data); },
    request(args) {
      calls.push(args);
      const custom = override(args);
      if (custom !== undefined) return Promise.resolve(custom);
      switch (args.method) {
        case "eth_chainId": return Promise.resolve("0x2105");
        case "eth_accounts":
        case "eth_requestAccounts": return Promise.resolve([ACCOUNT]);
        case "eth_getBlockByNumber": return Promise.resolve({ ...BLOCK });
        case "eth_getBalance": return Promise.resolve("0x2a");
        case "eth_getCode": return Promise.resolve("0x6000");
        case "eth_call": return Promise.resolve("0x" + "2a".padStart(64, "0"));
        default: throw Error("Forbidden request " + args.method);
      }
    },
  };
  const wallet = new ThreeCoreWalletSession({
    provider, agent: "DAT", siteOrigin: "https://dex.example", approvedOrigins: ["https://dex.example"],
    expectedAccount: ACCOUNT, chainId: 8453, ...config,
  });
  return { wallet, provider, calls, listeners, setOverride: fn => { override = fn; } };
}

const reads = [
  ["chain precheck", "eth_chainId", w => w.getNativeBalance()],
  ["account precheck", "eth_accounts", w => w.getNativeBalance()],
  ["header", "eth_getBlockByNumber", w => w.getBlockSnapshot()],
  ["native balance", "eth_getBalance", w => w.getNativeBalance(BLOCK.hash)],
  ["token balance", "eth_call", w => w.getTokenBalance(TOKEN, BLOCK.hash)],
  ["allowance", "eth_call", w => w.getTokenAllowance(TOKEN, SPENDER, BLOCK.hash)],
  ["code", "eth_getCode", w => w.getContractCode(TOKEN, BLOCK.hash)],
];
for (const [label, method, read] of reads) {
  test(`${label} ends at the configured deadline with no retry`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture({ readTimeoutMs: 100 }), gate = deferred(), entered = deferred();
    t.after(() => f.wallet.disconnect());
    await f.wallet.connect();
    f.setOverride(args => { if (args.method === method) { entered.resolve(); return gate.promise; } });
    const pending = observe(read(f.wallet));
    await entered.promise;
    const count = f.calls.length;
    t.mock.timers.tick(99);
    await flush();
    assert.equal(pending.status, "pending");
    t.mock.timers.tick(1);
    await flush();
    assert.equal(pending.status, "rejected");
    assert.equal(pending.error.code, "READ_TIMEOUT");
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.wallet.state.account, null);
    assert.equal(f.calls.length, count, "No automatic retry");
    assert.ok([...f.listeners.values()].every(set => set.size === 0));
    await assert.rejects(read(f.wallet), { code: "NOT_CONNECTED" });
    assert.equal(f.calls.length, count);
    gate.resolve("late invalid result");
    await flush();
    assert.equal(f.wallet.state.connected, false);
  });
}

test("the default read deadline is 30 seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(), entered = deferred();
  t.after(() => f.wallet.disconnect());
  await f.wallet.connect();
  f.setOverride(({ method }) => {
    if (method === "eth_getBalance") { entered.resolve(); return new Promise(() => {}); }
  });
  const pending = observe(f.wallet.getNativeBalance());
  await entered.promise;
  t.mock.timers.tick(29_999);
  await flush();
  assert.equal(pending.status, "pending");
  t.mock.timers.tick(1);
  await flush();
  assert.equal(pending.status, "rejected");
  assert.equal(pending.error.code, "READ_TIMEOUT");
});

for (const invalid of [0, -1, 0.5, 120_001, Infinity, NaN, "100", null]) {
  test(`invalid timeout ${String(invalid)} is rejected before provider access`, () => {
    assert.throws(() => fixture({ readTimeoutMs: invalid }), { code: "INVALID_READ_TIMEOUT" });
  });
}

for (const [label, cancel] of [
  ["manual disconnect", f => f.wallet.disconnect()],
  ["account change", f => f.provider.emit("accountsChanged", [])],
  ["chain change", f => f.provider.emit("chainChanged", "0x1")],
  ["provider disconnect", f => f.provider.emit("disconnect", {})],
]) {
  test(`${label} settles an unresponsive read before its deadline`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(), entered = deferred();
    await f.wallet.connect();
    f.setOverride(({ method }) => {
      if (method === "eth_getBalance") { entered.resolve(); return new Promise(() => {}); }
    });
    const pending = observe(f.wallet.getNativeBalance());
    await entered.promise;
    cancel(f);
    await flush();
    assert.equal(pending.status, "rejected");
    assert.equal(pending.error.code, "SESSION_CHANGED");
    f.setOverride(() => undefined);
    await f.wallet.connect();
    const state = f.wallet.state;
    t.mock.timers.tick(120_000);
    await flush();
    assert.deepEqual(f.wallet.state, state, "No old timer may invalidate the new connection");
    assert.equal(await f.wallet.getNativeBalance(), 42n);
    f.wallet.disconnect();
  });
}

for (const late of ["resolve", "reject"]) {
  test(`a late ${late} after timeout cannot alter an explicit reconnection`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture({ readTimeoutMs: 100 }), gate = deferred(), entered = deferred();
    await f.wallet.connect();
    f.setOverride(({ method }) => { if (method === "eth_call") { entered.resolve(); return gate.promise; } });
    const pending = observe(f.wallet.getTokenBalance(TOKEN));
    await entered.promise;
    t.mock.timers.tick(100);
    await flush();
    assert.equal(pending.status, "rejected");
    assert.equal(pending.error.code, "READ_TIMEOUT");
    f.setOverride(() => undefined);
    await f.wallet.connect();
    const state = f.wallet.state;
    gate[late](late === "resolve" ? "0x" + "ff".repeat(32) : Object.assign(Error("Old error"), { code: 4900 }));
    await flush();
    assert.deepEqual(f.wallet.state, state);
    assert.equal(await f.wallet.getTokenBalance(TOKEN), 42n);
    f.wallet.disconnect();
  });
}

test("the first timeout settles other pending reads from the same session", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ readTimeoutMs: 100 }), balanceStarted = deferred(), codeStarted = deferred();
  await f.wallet.connect();
  f.setOverride(({ method }) => {
    if (method === "eth_getBalance") { balanceStarted.resolve(); return new Promise(() => {}); }
    if (method === "eth_getCode") { codeStarted.resolve(); return new Promise(() => {}); }
  });
  const first = observe(f.wallet.getNativeBalance());
  await balanceStarted.promise;
  t.mock.timers.tick(50);
  const second = observe(f.wallet.getContractCode(TOKEN));
  await codeStarted.promise;
  t.mock.timers.tick(50);
  await flush();
  assert.equal(first.status, "rejected");
  assert.equal(first.error.code, "READ_TIMEOUT");
  assert.equal(second.status, "rejected");
  assert.equal(second.error.code, "SESSION_CHANGED");
  assert.equal(f.wallet.state.connected, false);
});

test("completed and ordinary failed reads do not leave active deadlines", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ readTimeoutMs: 1 });
  await f.wallet.connect();
  assert.equal(await f.wallet.getNativeBalance(), 42n);
  const error = Object.assign(Error("Unsupported"), { code: 4200 });
  f.setOverride(({ method }) => { if (method === "eth_call") throw error; });
  await assert.rejects(f.wallet.getTokenBalance(TOKEN), actual => actual === error);
  const state = f.wallet.state;
  t.mock.timers.tick(120_000);
  await flush();
  assert.deepEqual(f.wallet.state, state);
  f.wallet.disconnect();
});

test("read deadlines do not time out or repeat a human permission prompt", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ readTimeoutMs: 1 }), gate = deferred(), entered = deferred();
  f.setOverride(({ method }) => { if (method === "eth_requestAccounts") { entered.resolve(); return gate.promise; } });
  const connection = f.wallet.connect(), pending = observe(connection);
  await entered.promise;
  t.mock.timers.tick(10_000); // Still below the separate permission deadline.
  await flush();
  assert.equal(pending.status, "pending");
  assert.equal(f.wallet.connect(), connection);
  assert.equal(f.calls.filter(x => x.method === "eth_requestAccounts").length, 1);
  gate.resolve([ACCOUNT]);
  await connection;
  assert.equal(f.wallet.state.connected, true);
  f.wallet.disconnect();
});

for (const operation of ["readBalances", "inspect"]) {
  test(`${operation} shows a timeout, clears the result and can explicitly reconnect`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(), entered = deferred();
    const controller = createWalletCardController({
      agent: "DAT", siteOrigin: "https://dex.example",
      createSession: config => new ThreeCoreWalletSession({ ...config, readTimeoutMs: 100 }),
    });
    t.after(() => controller.dispose());
    const connect = () => controller.connect({ provider: f.provider, account: ACCOUNT, chainId: 8453 });
    await connect();
    assert.equal(await controller[operation](options), true);
    f.setOverride(({ method }) => { if (method === "eth_call") { entered.resolve(); return new Promise(() => {}); } });
    const pending = observe(controller[operation](options));
    await entered.promise;
    t.mock.timers.tick(100);
    await flush();
    assert.equal(pending.status, "fulfilled");
    assert.equal(pending.value, false);
    assert.equal(controller.state.phase, "disconnected");
    assert.equal(controller.state.result, null);
    assert.match(controller.state.error, /応答.*再接続/);
    f.setOverride(() => undefined);
    assert.equal(await connect(), true);
    assert.equal(await controller[operation](options), true);
  });
}
