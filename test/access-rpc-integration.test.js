import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityLock } from "../src/security-lock.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { createRpcSupervisor } from "../src/rpc-supervisor.js";
import { providerFixture, A, SITE, fakeClock, deferred } from "./helpers/security-fixtures.js";
import { agents, flush } from "./helpers/access-lifecycle.js";

for (const agent of agents) {
  for (const reason of ["manual", "idle", "clock", "timer", "page-exit", "page-freeze", "page-restored"]) {
    for (const outcome of ["resolve", "reject"]) {
      test(`${agent}: ${reason} consumes a late RPC ${outcome} without new reads`, async t => {
        const gate = deferred(), entered = deferred(), clock = fakeClock();
        const supervisor = createRpcSupervisor();
        const f = providerFixture(({ method }) => {
          if (method === "eth_getBalance") { entered.resolve(); return gate.promise; }
        }, { agent, rpcSupervisor: supervisor });
        let card;
        const lock = createSecurityLock({ ...clock.options, onLock: () => card?.disconnect() });
        card = createWalletCardController({ agent, siteOrigin: SITE, rpcSupervisor: supervisor, isAccessAllowed: lock.check });
        t.after(() => { card.dispose(); lock.dispose(); supervisor.dispose(); f.wallet.disconnect(); gate.resolve("0x0"); });
        assert.equal(await card.connect({ provider: f.provider, account: A, chainId: 84532 }), true);
        const pending = card.readBalances();
        await entered.promise;
        if (reason === "idle") { clock.set(300000); lock.check(); }
        else if (reason === "clock") { clock.set(-1); lock.check(); }
        else lock.lock(reason);
        assert.equal(await pending, false);
        const count = f.calls.length;
        assert.equal(card.state.phase, "disconnected");
        assert.equal(card.state.connection, null);
        gate[outcome](outcome === "resolve" ? "0xffff" : Error("private late RPC"));
        await flush();
        assert.equal(f.calls.length, count);
        assert.equal(card.state.result, null);
        assert(f.calls.every(row => ["eth_chainId", "eth_requestAccounts", "eth_accounts", "eth_getBlockByNumber", "eth_getBalance"].includes(row.method)));
      });
    }
  }
}

for (const agent of agents) {
  test(`${agent}: cancelled local read retains provider capacity until the original reply`, async t => {
    const supervisor = createRpcSupervisor(), gate = deferred(), entered = deferred();
    const f = providerFixture(({ method }) => {
      if (method === "eth_getBalance") { entered.resolve(); return gate.promise; }
    }, { agent, rpcSupervisor: supervisor });
    const card = createWalletCardController({ agent, siteOrigin: SITE, rpcSupervisor: supervisor });
    t.after(() => { card.dispose(); supervisor.dispose(); f.wallet.disconnect(); gate.resolve("0x0"); });
    await card.connect({ provider: f.provider, account: A, chainId: 84532 });
    const pending = card.readBalances();
    await entered.promise;
    const before = supervisor.state();
    assert.equal(before.pending, 1);
    card.clearResult();
    assert.equal(await pending, false);
    const retained = supervisor.state();
    assert.equal(retained.pending, before.pending);
    assert.equal(card.state.phase, "connected");
    gate.resolve("0x1");
    await flush();
    assert.equal(card.state.result, null);
    assert.equal(supervisor.state().pending, 0);
  });
}

test("one stop shuts down all three real session adapters without reconnecting on resume", async t => {
  const clock = fakeClock(), supervisor = createRpcSupervisor(), cards = [];
  const lock = createSecurityLock({ ...clock.options, onLock() {
    return cards.map(row => row.card.disconnect()).every(value => value === true);
  } });
  t.after(() => { for (const row of cards) { row.card.dispose(); row.f.wallet.disconnect(); } lock.dispose(); supervisor.dispose(); });
  for (const agent of agents) {
    const f = providerFixture(undefined, { agent, rpcSupervisor: supervisor });
    const card = createWalletCardController({ agent, siteOrigin: SITE, rpcSupervisor: supervisor, isAccessAllowed: lock.check });
    cards.push({ f, card });
    assert.equal(await card.connect({ provider: f.provider, account: A, chainId: 84532 }), true);
    assert.equal(await card.readBalances(), true);
  }
  lock.lock();
  const counts = cards.map(row => row.f.calls.length);
  assert(cards.every(row => row.card.state.phase === "disconnected"));
  assert.equal(lock.unlock(), true);
  await flush();
  assert.deepEqual(cards.map(row => row.f.calls.length), counts);
  assert(cards.every(row => row.card.state.result === null));
  assert.equal(await cards[0].card.readBalances(), false);
  assert.deepEqual(cards.map(row => row.f.calls.length), counts);
});
