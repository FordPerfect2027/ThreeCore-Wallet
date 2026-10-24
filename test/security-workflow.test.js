import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityLock } from "../src/security-lock.js";
import { createSecurityJournal, exportSecurityJournal } from "../src/security-journal.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { guardRpcResponse } from "../src/security-rpc.js";
import { A, B, HASH, WORD, SITE, fakeClock, providerFixture, deferred } from "./helpers/security-fixtures.js";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const observe = promise => promise.then(value => ({ value }), error => ({ error }));
const operations = [
  ["native balance", "eth_getBalance", wallet => wallet.getNativeBalance(HASH), "0xff"],
  ["token balance", "eth_call", wallet => wallet.getTokenBalance(B, HASH), WORD],
  ["allowance", "eth_call", wallet => wallet.getTokenAllowance(B, B, HASH), WORD],
  ["bytecode", "eth_getCode", wallet => wallet.getContractCode(B, HASH), "0x6000"],
  ["block header", "eth_getBlockByNumber", wallet => wallet.getBlockSnapshot(), { number: "0x2a", hash: HASH }],
  ["transfer events", "eth_getLogs", wallet => wallet.getTransferEvents({ fromBlock: "1", toBlock: "5", direction: "incoming" }), []],
];

function protectedProvider(agent, override = () => undefined) {
  const clock = fakeClock(), journal = createSecurityJournal();
  let wallet;
  const lock = createSecurityLock({ ...clock.options, onLock(state) {
    journal.record(state.reason); wallet?.disconnect();
  } });
  const provider = providerFixture(override, { agent, isAccessAllowed: lock.check });
  wallet = provider.wallet;
  return { ...provider, lock, clock, journal, close() { wallet.disconnect(); lock.dispose(); journal.dispose(); } };
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const [name, method, read, value] of operations) {
    test(agent + ": stopping during " + name + " never restores a result after explicit resume", async () => {
      const pending = deferred(), entered = deferred(); let hold = true;
      const f = protectedProvider(agent, args => {
        if (hold && args.method === method) { entered.resolve(); return pending.promise; }
      });
      try {
        await f.wallet.connect();
        const old = observe(read(f.wallet)); await entered.promise;
        f.lock.lock();
        assert.equal((await old).error.code, "ACCESS_LOCKED");
        f.lock.unlock();
        const count = f.calls.length;
        await assert.rejects(read(f.wallet), { code: "NOT_CONNECTED" });
        assert.equal(f.calls.length, count);
        hold = false; await f.wallet.connect();
        const freshState = f.wallet.state;
        pending.resolve(value); await tick();
        assert.deepEqual(f.wallet.state, freshState);
        await read(f.wallet);
        assert.equal(f.journal.state().counts.manual, 1);
      } finally { pending.resolve(value); f.close(); }
    });

    test(agent + ": idle timeout during " + name + " consumes a late rejection without reconnecting", async () => {
      const pending = deferred(), entered = deferred();
      const f = protectedProvider(agent, args => {
        if (args.method === method) { entered.resolve(); return pending.promise; }
      });
      try {
        await f.wallet.connect();
        const old = observe(read(f.wallet)); await entered.promise;
        f.clock.advance(300_000);
        assert.equal((await old).error.code, "ACCESS_LOCKED");
        const count = f.calls.length;
        pending.reject(Object.assign(Error("Private provider payload"), { code: 4900 }));
        await tick();
        assert.equal(f.calls.length, count);
        assert.equal(f.wallet.state.connected, false);
        assert.equal(f.journal.state().counts.idle, 1);
        assert.ok(!exportSecurityJournal(f.journal.state()).includes("Private provider payload"));
      } finally { pending.resolve(value); f.close(); }
    });
  }
}

for (const reason of ["manual", "idle", "hidden", "page-exit", "clock"]) {
  test("one protection gate terminates every pending token read for reason " + reason, async () => {
    const waiting = deferred(), gates = [], fixtures = [], clock = fakeClock();
    const lock = createSecurityLock({ ...clock.options, onLock() {
      for (const item of fixtures) item.wallet.disconnect();
    } });
    try {
      for (const agent of ["DAT", "EMA", "CAWELON"]) {
        const entered = deferred(); gates.push(entered);
        const item = providerFixture(({ method }) => {
          if (method === "eth_getBalance") { entered.resolve(); return waiting.promise; }
        }, { agent, isAccessAllowed: lock.check });
        fixtures.push(item); await item.wallet.connect();
      }
      const reads = fixtures.map(item => observe(item.wallet.getNativeBalance()));
      await Promise.all(gates.map(gate => gate.promise));
      lock.lock(reason);
      for (const result of await Promise.all(reads)) assert.equal(result.error.code, "ACCESS_LOCKED");
      assert.ok(fixtures.every(item => !item.wallet.state.connected));
      const counts = fixtures.map(item => item.calls.length);
      waiting.resolve("0xff"); lock.unlock(); await tick();
      assert.deepEqual(fixtures.map(item => item.calls.length), counts);
      assert.ok(fixtures.every(item => !item.wallet.state.connected));
    } finally { waiting.resolve("0x0"); lock.dispose(); }
  });
}

test("one provider boundary failure does not silently disconnect a different token provider", async () => {
  const broken = protectedProvider("DAT", ({ method }) => method === "eth_getBalance" ? "x".repeat(2000) : undefined);
  const healthy = protectedProvider("EMA");
  try {
    await broken.wallet.connect(); await healthy.wallet.connect();
    await assert.rejects(broken.wallet.getNativeBalance(), { code: "RPC_RESULT_LIMIT" });
    assert.equal(broken.wallet.state.connected, false);
    assert.equal(healthy.wallet.state.connected, true);
    assert.equal(await healthy.wallet.getNativeBalance(), 1n);
  } finally { broken.close(); healthy.close(); }
});

test("account edits under a protection lock cannot reopen the controller", async () => {
  const clock = fakeClock(), lock = createSecurityLock(clock.options), f = providerFixture();
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: SITE, isAccessAllowed: lock.check });
  try {
    lock.lock();
    for (const account of [A, B]) {
      assert.equal(await controller.connect({ provider: f.provider, account, chainId: 84532 }), false);
      assert.equal(controller.state.result, null);
      assert.equal(controller.state.connection, null);
    }
    assert.equal(f.calls.length, 0);
    lock.unlock();
    assert.equal(await controller.connect({ provider: f.provider, account: A, chainId: 84532 }), true);
    assert.equal(await controller.readBalances(), true);
  } finally { controller.dispose(); lock.dispose(); }
});

const log = () => ({ address: B, topics: [HASH, HASH, HASH], data: WORD,
  blockNumber: "0x1", blockHash: HASH, transactionHash: HASH,
  transactionIndex: "0x0", logIndex: "0x0", removed: false });

test("a well-formed log response is copied and deeply frozen before interpretation", () => {
  const original = log(), result = guardRpcResponse("eth_getLogs", [original]);
  original.topics[0] = "mutated"; original.blockNumber = "0xff";
  assert.equal(result[0].topics[0], HASH);
  assert.equal(result[0].blockNumber, "0x1");
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result[0]) && Object.isFrozen(result[0].topics));
});

for (const field of Object.keys(log())) {
  test("missing log member is rejected at the boundary: " + field, () => {
    const value = log(); delete value[field];
    assert.throws(() => guardRpcResponse("eth_getLogs", [value]), { code: "RPC_RESULT_SHAPE" });
  });
  test("log getter is rejected without executing provider code: " + field, () => {
    const value = log(); let read = 0;
    Object.defineProperty(value, field, { get() { read++; throw Error("Do not execute"); } });
    assert.throws(() => guardRpcResponse("eth_getLogs", [value]), { code: "RPC_RESULT_SHAPE" });
    assert.equal(read, 0);
  });
}
for (const key of ["__proto__", "constructor", "privateKey", "unexpected", Symbol("extra")]) {
  test("unexpected log data cannot be stripped into an apparently valid event", () => {
    const value = log(); Object.defineProperty(value, key, { value: "untrusted" });
    assert.throws(() => guardRpcResponse("eth_getLogs", [value]), { code: "RPC_RESULT_SHAPE" });
  });
}

test("log snapshots retain removed=true so semantic decoders can reject reorg evidence", () => {
  const value = log(); value.removed = true;
  assert.equal(guardRpcResponse("eth_getLogs", [value])[0].removed, true);
});

test("log topic accessor is rejected without executing its getter", () => {
  const value = log(); let reads = 0;
  Object.defineProperty(value.topics, "1", { get() { reads++; return HASH; } });
  assert.throws(() => guardRpcResponse("eth_getLogs", [value]), { code: "RPC_RESULT_SHAPE" });
  assert.equal(reads, 0);
});

test("log byte payload has an upper bound before uint256 decoding", () => {
  const value = log(); value.data = "0x" + "f".repeat(100_000);
  assert.throws(() => guardRpcResponse("eth_getLogs", [value]), { code: "RPC_RESULT_LIMIT" });
});

test("arrays with non-index properties cannot hide alternate response fields", () => {
  const accounts = [A]; accounts.extra = "secret";
  assert.throws(() => guardRpcResponse("eth_accounts", accounts), { code: "RPC_RESULT_LIMIT" });
  const logs = [log()]; logs.extra = "secret";
  assert.throws(() => guardRpcResponse("eth_getLogs", logs), { code: "RPC_RESULT_LIMIT" });
});

test("revoked provider response proxies fail without coercing their content", () => {
  const item = Proxy.revocable(log(), {}); item.revoke();
  assert.throws(() => guardRpcResponse("eth_getLogs", [item.proxy]), { code: "RPC_RESULT_SHAPE" });
});
