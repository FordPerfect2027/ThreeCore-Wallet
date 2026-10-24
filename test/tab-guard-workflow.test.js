import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityLock } from "../src/security-lock.js";
import { createTabGuard } from "../src/tab-guard-controller.js";
import { runProtectionBatch } from "../src/protection-batch.js";
import { createSecurityJournal, exportSecurityJournal } from "../src/security-journal.js";
import { A, B, HASH, WORD, fakeClock, providerFixture, deferred } from "./helpers/security-fixtures.js";
import { clockFixture, transportFixture, deterministicCrypto, signal, hubFixture } from "./helpers/tab-guard-fixtures.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
const observed = value => value.then(result => ({ result }), error => ({ error }));
const operations = [
  ["native balance", "eth_getBalance", wallet => wallet.getNativeBalance(HASH), "0xff"],
  ["token balance", "eth_call", wallet => wallet.getTokenBalance(B, HASH), WORD],
  ["allowance", "eth_call", wallet => wallet.getTokenAllowance(B, B, HASH), WORD],
  ["contract bytecode", "eth_getCode", wallet => wallet.getContractCode(B, HASH), "0x6000"],
  ["block snapshot", "eth_getBlockByNumber", wallet => wallet.getBlockSnapshot(), { number: "0x2a", hash: HASH }],
  ["transfer events", "eth_getLogs", wallet => wallet.getTransferEvents({ fromBlock: "1", toBlock: "5", direction: "incoming" }), []],
];

function protectedWallet(agent, override = () => undefined, transport = null, seed = 0) {
  const clock = clockFixture(), idleClock = fakeClock(), journal = createSecurityJournal();
  const wire = transportFixture();
  let wallet, cleanupCompleted = false;
  const lock = createSecurityLock({ ...idleClock.options, onLock(state) {
    journal.record(state.reason);
    cleanupCompleted = runProtectionBatch([{ name: agent, run: () => wallet.disconnect() }]).completed;
  } });
  const f = providerFixture(override, { agent, isAccessAllowed: lock.check });
  wallet = f.wallet;
  const guard = createTabGuard({ ...clock.options, crypto: deterministicCrypto(seed),
    transport: transport ?? wire.transport, onStop(reason) {
      lock.lock(reason);
      return !lock.check() && cleanupCompleted;
    } });
  assert(guard.start());
  return { ...f, guard, clock, wire, lock, journal,
    resume() { assert(guard.noteResume()); assert(lock.unlock()); },
    close() { guard.dispose(); wallet.disconnect(); lock.dispose(); journal.dispose(); } };
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const [name, method, read, value] of operations) {
    test(agent + ": peer stop cancels a pending " + name + " across resume", async () => {
      const pending = deferred(), entered = deferred();
      let hold = true;
      const f = protectedWallet(agent, args => {
        if (hold && args.method === method) { entered.resolve(); return pending.promise; }
      });
      try {
        await f.wallet.connect();
        const operation = observed(read(f.wallet));
        await entered.promise;
        f.wire.deliver(signal());
        assert.equal((await operation).error.code, "ACCESS_LOCKED");
        assert.equal(f.wallet.state.connected, false);
        assert.equal(f.guard.state().received, 1);
        assert.equal(f.wire.posts.length, 1);
        assert.equal(f.wire.posts[0].kind, "receipt");
        const count = f.calls.length;
        f.clock.advance(1); f.resume();
        await assert.rejects(read(f.wallet), { code: "NOT_CONNECTED" });
        assert.equal(f.calls.length, count);
        hold = false;
        await f.wallet.connect();
        const current = f.wallet.state;
        pending.resolve(value);
        await tick();
        assert.deepEqual(f.wallet.state, current);
        await read(f.wallet);
        assert.equal(f.journal.state().counts["peer-stop"], 1);
      } finally { pending.resolve(value); f.close(); }
    });

    test(agent + ": channel fault consumes a late rejected " + name, async () => {
      const pending = deferred(), entered = deferred();
      const f = protectedWallet(agent, args => {
        if (args.method === method) { entered.resolve(); return pending.promise; }
      });
      try {
        await f.wallet.connect();
        const operation = observed(read(f.wallet)); await entered.promise;
        f.wire.error();
        assert.equal((await operation).error.code, "ACCESS_LOCKED");
        const count = f.calls.length;
        pending.reject(Error("synthetic provider secret"));
        await tick();
        assert.equal(f.calls.length, count);
        assert.equal(f.wallet.state.connected, false);
        assert.equal(f.guard.state().available, false);
        assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
        assert.equal(f.journal.state().counts["channel-error"], 1);
        assert(!exportSecurityJournal(f.journal.state()).includes("synthetic provider secret"));
      } finally { pending.resolve(value); f.close(); }
    });
  }

  test(agent + ": permission prompt finishing after peer stop cannot attach a session", async () => {
    const pending = deferred(), entered = deferred();
    const f = protectedWallet(agent, ({ method }) => {
      if (method === "eth_requestAccounts") { entered.resolve(); return pending.promise; }
    });
    try {
      const connection = observed(f.wallet.connect());
      await entered.promise;
      f.wire.deliver(signal());
      pending.resolve([A]);
      const result = await connection;
      assert.equal(result.error.code, "ACCESS_LOCKED");
      assert.equal(f.wallet.state.connected, false);
      assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
      f.resume();
      assert.equal(f.wallet.state.connected, false);
      assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
    } finally { pending.resolve([A]); f.close(); }
  });

  test(agent + ": account and chain events after peer stop cannot recreate a session", async () => {
    const f = protectedWallet(agent);
    try {
      await f.wallet.connect(); f.wire.deliver(signal());
      const before = f.wallet.state, count = f.calls.length;
      f.provider.emit("accountsChanged", [B]);
      f.provider.emit("chainChanged", "0x2105");
      f.provider.emit("connect", { chainId: "0x14a34" });
      await tick();
      assert.deepEqual(f.wallet.state, before);
      assert.equal(f.calls.length, count);
      assert([...f.listeners.values()].every(listeners => listeners.size === 0));
    } finally { f.close(); }
  });

  test(agent + ": malformed notifications leave a healthy explicit read unchanged", async () => {
    const f = protectedWallet(agent);
    try {
      await f.wallet.connect();
      for (const input of [null, { kind: "unlock" }, { ...signal(), account: A }, { ...signal(), kind: "connect" }]) {
        f.wire.deliver(input);
      }
      assert.equal(await f.wallet.getNativeBalance(), 1n);
      assert.equal(f.wallet.state.connected, true);
      assert.equal(f.wire.posts.length, 0);
      assert.equal(f.guard.state().ignored, 4);
    } finally { f.close(); }
  });
}

test("three independently connected pages stop from one explicit local request", async () => {
  const hub = hubFixture();
  const peers = ["DAT", "EMA", "CAWELON"].map((agent, index) =>
    protectedWallet(agent, undefined, hub.endpoint(), index * 100));
  try {
    await Promise.all(peers.map(peer => peer.wallet.connect()));
    const counts = peers.map(peer => peer.calls.length);
    assert(peers[0].guard.stop());
    assert.equal(peers[0].wallet.state.connected, false);
    assert.equal(peers[1].wallet.state.connected, true);
    hub.flush();
    assert(peers.every(peer => !peer.wallet.state.connected));
    assert.equal(peers[0].guard.state().receiptCount, 2);
    assert.deepEqual(peers.map(peer => peer.calls.length), counts);
    assert.equal(hub.traffic.filter(value => value.kind === "stop").length, 1);
    assert.equal(hub.traffic.filter(value => value.kind === "receipt").length, 2);
    peers[1].clock.advance(1); peers[1].resume();
    assert.equal(peers[1].lock.check(), true);
    assert.equal(peers[0].lock.check(), false);
    assert.equal(peers[2].lock.check(), false);
    assert(peers.every(peer => !peer.wallet.state.connected));
    await peers[1].wallet.connect();
    assert.equal(await peers[1].wallet.getNativeBalance(), 1n);
    assert.equal(peers[0].wallet.state.connected, false);
    assert.equal(peers[2].wallet.state.connected, false);
  } finally { for (const peer of peers) peer.close(); }
});

test("an unavailable transport still stops all current page reads before reporting failure", async () => {
  const f = protectedWallet("DAT");
  try {
    await f.wallet.connect();
    f.wire.error();
    const count = f.calls.length;
    assert.equal(f.guard.stop(), false);
    await assert.rejects(f.wallet.getNativeBalance(), { code: "NOT_CONNECTED" });
    assert.equal(f.calls.length, count);
    assert.equal(f.wallet.state.connected, false);
  } finally { f.close(); }
});

test("local hidden-page protection does not terminate another page's wallet", async () => {
  const hub = hubFixture();
  const first = protectedWallet("DAT", undefined, hub.endpoint());
  const second = protectedWallet("EMA", undefined, hub.endpoint(), 100);
  try {
    await first.wallet.connect(); await second.wallet.connect();
    first.lock.lock("hidden"); hub.flush();
    assert.equal(first.wallet.state.connected, false);
    assert.equal(second.wallet.state.connected, true);
    assert.equal(await second.wallet.getNativeBalance(), 1n);
    assert.deepEqual(hub.traffic, []);
  } finally { first.close(); second.close(); }
});

test("failed report cleanup cannot prevent backup erasure and all wallet disconnections", async () => {
  const peers = ["DAT", "EMA", "CAWELON"].map(agent => providerFixture(undefined, { agent }));
  let password = "synthetic test credential", displayedReport = "synthetic report";
  try {
    await Promise.all(peers.map(peer => peer.wallet.connect()));
    const result = runProtectionBatch([
      { name: "backup", run() { password = ""; } },
      { name: "period", run() { throw Error("synthetic report failure"); } },
      ...peers.map((peer, index) => ({ name: ["DAT", "EMA", "CAWELON"][index],
        run() { peer.wallet.disconnect(); } })),
    ]);
    assert.equal(password, "");
    assert.equal(displayedReport, "synthetic report");
    assert.equal(result.completed, false);
    assert.deepEqual(result.failed, ["period"]);
    assert(peers.every(peer => !peer.wallet.state.connected));
    displayedReport = "";
  } finally { for (const peer of peers) peer.wallet.disconnect(); }
});

test("flood refusal locks a real session without issuing new provider requests", async () => {
  const f = protectedWallet("CAWELON");
  try {
    await f.wallet.connect(); const count = f.calls.length;
    for (let i = 0; i < 257; i++) f.wire.deliver(null);
    assert.equal(f.guard.state().errorCode, "TAB_FLOOD");
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.calls.length, count);
    assert.equal(f.wire.posts.length, 0);
    assert.equal(f.journal.state().counts["channel-error"], 1);
  } finally { f.close(); }
});

test("receipt timeout never unlocks the sender's real session", async () => {
  const f = protectedWallet("EMA");
  try {
    await f.wallet.connect(); f.guard.stop();
    f.clock.advance(2000);
    assert.equal(f.guard.state().phase, "complete");
    assert.equal(f.guard.state().receiptCount, 0);
    assert.equal(f.lock.check(), false);
    assert.equal(f.wallet.state.connected, false);
    await assert.rejects(f.wallet.getNativeBalance(), { code: "NOT_CONNECTED" });
  } finally { f.close(); }
});
