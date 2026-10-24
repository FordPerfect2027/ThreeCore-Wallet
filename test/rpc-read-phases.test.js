import test from "node:test";
import assert from "node:assert/strict";
import { createRpcSupervisor } from "../src/rpc-supervisor.js";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { providerFixture, A, B, HASH, SITE } from "./helpers/security-fixtures.js";
import { clockFixture, deferred, drain } from "./helpers/rpc-supervisor-fixtures.js";

const methods = [
  ["balance", wallet => wallet.getNativeBalance(HASH), "eth_getBalance", "0x1"],
  ["token", wallet => wallet.getTokenBalance(B, HASH), "eth_call", "0x" + "1".padStart(64, "0")],
  ["allowance", wallet => wallet.getTokenAllowance(B, B, HASH), "eth_call", "0x" + "1".padStart(64, "0")],
  ["code", wallet => wallet.getContractCode(B, HASH), "eth_getCode", "0x6000"],
  ["header", wallet => wallet.getBlockSnapshot(), "eth_getBlockByNumber", { number: "0x2a", hash: HASH }],
  ["events", wallet => wallet.getTransferEvents({ fromBlock: "1", toBlock: "5", direction: "incoming" }), "eth_getLogs", []],
];
async function until(predicate) {
  for (let i = 0; i < 50; i++) { if (predicate()) return; await drain(); }
  assert.fail("Expected read phase was not reached");
}
function result(promise) {
  return promise.then(value => ({ value }), error => ({ code: error.code }));
}
function fixture({ target, mode = "timeout", agent = "DAT", response } = {}) {
  const clock = clockFixture(), gate = deferred();
  const supervisor = createRpcSupervisor(clock.options);
  let readActive = false, position = 0;
  const f = providerFixture(args => {
    if (!readActive) return;
    position++;
    if (position === target) return gate.promise;
    if (response) return response(args);
  });
  const wallet = new ThreeCoreWalletSession({ provider: f.provider, agent, expectedAccount: A,
    chainId: 84532, siteOrigin: SITE, approvedOrigins: [SITE], rpcSupervisor: supervisor,
    readTimeoutMs: 100 });
  return { ...f, wallet, clock, supervisor, gate,
    activate() { readActive = true; }, position: () => position,
    async stop() {
      if (mode === "timeout") { clock.advance(100); clock.run(); }
      else wallet.disconnect();
      await drain();
    },
    async cleanup() { gate.resolve(null); wallet.disconnect(); supervisor.dispose(); await drain(); },
  };
}

// A verified read has two identity checks before and after its payload RPC.
// Each stalled phase must retain exactly its own native slot and abort the rest.
for (const [name, read, method, response] of methods) {
  for (const target of [1, 2, 3, 4, 5]) {
    for (const mode of ["timeout", "cancel"]) {
      test(name + " retains outstanding native work at phase " + target + " after " + mode, async () => {
        const f = fixture({ target, mode });
        try {
          await f.wallet.connect(); f.activate();
          const pending = result(read(f.wallet));
          await until(() => f.position() === target);
          const count = f.calls.length;
          await f.stop();
          assert.equal((await pending).code, mode === "timeout" ? "READ_TIMEOUT" : "SESSION_CHANGED");
          assert.equal(f.supervisor.state().abandoned, 1);
          assert.equal(f.supervisor.state().waiting, 0);
          assert.equal(f.wallet.state.connected, false);
          const sequence = ["eth_chainId", "eth_accounts", method, "eth_chainId", "eth_accounts"];
          const values = ["0x14a34", [A], response, "0x14a34", [A]];
          assert.deepEqual(f.calls.slice(4).map(call => call.method), sequence.slice(0, target));
          f.gate.resolve(values[target - 1]); await drain();
          assert.equal(f.calls.length, count);
          assert.equal(f.supervisor.state().pending, 0);
          assert.equal(f.supervisor.state().late, 1);
          assert.equal(f.wallet.state.connected, false);
        } finally { await f.cleanup(); }
      });
    }
  }
}

function abiString(value) {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  return "0x" + "20".padStart(64, "0") + (bytes.length / 2).toString(16).padStart(64, "0") +
    bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
}
const metadata = {
  "0x06fdde03": abiString("Synthetic Token"),
  "0x95d89b41": abiString("SYN"),
  "0x313ce567": "0x" + "12".padStart(64, "0"),
  "0x18160ddd": "0x" + "f4240".padStart(64, "0"),
};

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const selector of Object.keys(metadata)) {
    test(agent + " metadata sequence stops after stalled selector " + selector, async () => {
      const clock = clockFixture(), gate = deferred();
      const supervisor = createRpcSupervisor(clock.options);
      const f = providerFixture(args => {
        if (args.method === "eth_call") {
          return args.params[0].data === selector ? gate.promise : metadata[args.params[0].data];
        }
      });
      const wallet = new ThreeCoreWalletSession({ provider: f.provider, agent, expectedAccount: A,
        chainId: 84532, siteOrigin: SITE, approvedOrigins: [SITE], rpcSupervisor: supervisor, readTimeoutMs: 100 });
      try {
        await wallet.connect();
        const pending = result(wallet.getTokenMetadata(B, HASH));
        await until(() => f.calls.some(call => call.method === "eth_call" && call.params[0].data === selector));
        clock.advance(100); clock.run();
        assert.equal((await pending).code, "READ_TIMEOUT");
        assert.equal(supervisor.state().abandoned, 1);
        const count = f.calls.length;
        gate.resolve(metadata[selector]); await drain();
        assert.equal(f.calls.length, count);
        assert.equal(supervisor.state().late, 1);
        assert.equal(wallet.state.connected, false);
        assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
      } finally { gate.resolve(null); wallet.disconnect(); supervisor.dispose(); }
    });
  }
}

test("healthy metadata pipeline consumes bounded read capabilities and releases every slot", async () => {
  const supervisor = createRpcSupervisor();
  const f = providerFixture(args => args.method === "eth_call" ? metadata[args.params[0].data] : undefined);
  const wallet = new ThreeCoreWalletSession({ provider: f.provider, agent: "DAT", expectedAccount: A,
    chainId: 84532, siteOrigin: SITE, approvedOrigins: [SITE], rpcSupervisor: supervisor });
  try {
    await wallet.connect();
    const value = await wallet.getTokenMetadata(B, HASH);
    assert(value);
    assert.equal(supervisor.state().pending, 0);
    assert.equal(supervisor.state().timedOut, 0);
    assert.deepEqual(f.calls.filter(call => call.method === "eth_call").map(call => call.params[0].data), Object.keys(metadata));
    for (const call of f.calls.filter(call => call.method === "eth_call")) {
      assert.deepEqual(call.params[1], { blockHash: HASH, requireCanonical: true });
      assert.equal(call.params[0].to, B);
    }
  } finally { wallet.disconnect(); supervisor.dispose(); }
});

test("failing final identity check cannot publish a successful payload fetched earlier", async () => {
  const f = fixture({ target: 5 });
  try {
    await f.wallet.connect(); f.activate();
    const pending = result(f.wallet.getNativeBalance(HASH));
    await until(() => f.position() === 5);
    f.gate.resolve([B]);
    assert.equal((await pending).code, "ACCOUNT_CHANGED");
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.supervisor.state().pending, 0);
    assert.equal(f.supervisor.state().abandoned, 0);
  } finally { await f.cleanup(); }
});

test("no lease remains when a payload is rejected by semantic decoding", async () => {
  const supervisor = createRpcSupervisor();
  const f = providerFixture(args => args.method === "eth_getBalance" ? "not a quantity" : undefined);
  const wallet = new ThreeCoreWalletSession({ provider: f.provider, agent: "DAT", expectedAccount: A,
    chainId: 84532, siteOrigin: SITE, approvedOrigins: [SITE], rpcSupervisor: supervisor });
  try {
    await wallet.connect();
    await assert.rejects(wallet.getNativeBalance(HASH), { code: "INVALID_RPC_RESULT" });
    assert.equal(supervisor.state().pending, 0);
    assert.equal(supervisor.state().waiting, 0);
    assert.equal(supervisor.state().abandoned, 0);
  } finally { wallet.disconnect(); supervisor.dispose(); }
});

test("repeated current-account notifications exceeding budget stop the session", async () => {
  const supervisor = createRpcSupervisor();
  const f = providerFixture();
  const wallet = new ThreeCoreWalletSession({ provider: f.provider, agent: "DAT", expectedAccount: A,
    chainId: 84532, siteOrigin: SITE, approvedOrigins: [SITE], rpcSupervisor: supervisor });
  try {
    await wallet.connect();
    const count = f.calls.length;
    for (let i = 0; i < 257; i++) f.provider.emit("accountsChanged", [A]);
    assert.equal(wallet.state.connected, false);
    assert.equal(f.calls.length, count);
    assert([...f.listeners.values()].every(listeners => listeners.size === 0));
    await wallet.connect();
    assert.equal(wallet.state.connected, true);
    assert.equal(await wallet.getNativeBalance(HASH), 1n);
  } finally { wallet.disconnect(); supervisor.dispose(); }
});
