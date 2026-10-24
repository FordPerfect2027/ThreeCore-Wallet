import test from "node:test";
import assert from "node:assert/strict";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { plan, periodSession, context } from "./helpers/period-fixtures.js";
import { targets } from "./helpers/allowance-fixtures.js";
import { agents, deferred, flush } from "./helpers/access-lifecycle.js";

const operations = {
  balances: (card, f) => card.readBalances({ tokenAddress: f.token.address }),
  preflight: (card, f) => card.inspect({ tokenAddress: f.token.address, spenderAddress: "0x" + "66".repeat(20) }),
  identity: (card) => card.readIdentity(),
  portfolio: (card, f) => card.readPortfolio({ tokens: [f.token.address] }),
  allowances: (card, f) => card.readAllowances(targets(f.state.agent, f.state.chainId)),
  transfers: (card) => card.readTransfers({ fromBlock: "30", toBlock: "42", lookback: 250 }),
  period: (card, f, selected) => card.readPeriod(selected),
};

function fixture(t, agent, before) {
  const selected = plan({}, { ...context(), agent });
  const f = periodSession(selected, { before });
  f.session.connect = async () => { f.state.connected = true; };
  f.session.disconnect = () => { f.state.connected = false; f.state.connectionEpoch++; };
  f.session.getTokenAllowance = async () => 0n;
  const card = createWalletCardController({ agent, siteOrigin: f.state.siteOrigin, createSession: () => f.session });
  const provider = { request() { throw Error("No live provider in this fixture"); } };
  t.after(() => card.dispose());
  return { f, card, selected, connect: () => card.connect({ provider,
    account: f.state.account, chainId: f.state.chainId }) };
}

for (const agent of agents) {
  for (const [name, run] of Object.entries(operations)) {
    for (const action of ["clearResult", "disconnect", "dispose"]) {
      test(`${agent} ${name}: ${action} settles before provider and suppresses next subread`, async t => {
        const entered = deferred(), gate = deferred();
        let first = true;
        const { f, card, selected, connect } = fixture(t, agent, async () => {
          if (first) { first = false; entered.resolve(); await gate.promise; }
        });
        await connect();
        const pending = run(card, f, selected).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
        await entered.promise;
        const count = f.calls.length;
        card[action]();
        const result = await pending;
        assert(result.ok ? result.value === false : /unavailable/i.test(result.error.message));
        assert.equal(f.calls.length, count, "No subread while stopped");
        assert.equal(card.state.result, null);
        gate.resolve();
        await flush();
        assert.equal(f.calls.length, count, "Late provider reply must not schedule another subread");
        assert.equal(card.state.result, null);
        assert.equal(card.state.phase, action === "clearResult" ? "connected" : action === "dispose" ? "disposed" : "disconnected");
      });
    }
  }
}

for (const agent of agents) {
  for (const [name, run] of Object.entries(operations)) {
    test(`${agent} ${name}: a later explicit read succeeds after clearing the earlier one`, async t => {
      const entered = deferred(), gate = deferred();
      let first = true;
      const { f, card, selected, connect } = fixture(t, agent, async () => {
        if (first) { first = false; entered.resolve(); await gate.promise; }
      });
      await connect();
      const old = run(card, f, selected).catch(() => false);
      await entered.promise;
      card.clearResult();
      await old;
      assert.equal(await card.readBalances(), true);
      const latest = card.state;
      gate.resolve();
      await flush();
      assert.equal(card.state, latest);
      assert.equal(card.state.result.kind, "balances");
      assert.equal(f.state.connected, true);
    });
  }
}

for (const action of ["clearResult", "disconnect", "dispose"]) {
  test(`progress callback ${action} stops the first identity subread`, async t => {
    const { card, f, connect } = fixture(t, "DAT");
    await connect();
    let seen = 0;
    await assert.rejects(card.readIdentity({ onProgress() { seen++; card[action](); } }), /unavailable/);
    assert.equal(seen, 1);
    assert.equal(f.calls.length, 0);
    assert.equal(card.state.result, null);
  });
}

test("stopping one card leaves the other two cards' reads active", async t => {
  const waits = agents.map(() => deferred());
  const entered = agents.map(() => deferred());
  const cards = agents.map((agent, i) => {
    let first = true;
    return fixture(t, agent, async () => {
      if (first) { first = false; entered[i].resolve(); await waits[i].promise; }
    });
  });
  for (const item of cards) await item.connect();
  const pending = cards.map(item => item.card.readBalances());
  await Promise.all(entered.map(item => item.promise));
  cards[0].card.clearResult();
  assert.equal(await pending[0], false);
  waits[1].resolve(); waits[2].resolve();
  assert.equal(await pending[1], true);
  assert.equal(await pending[2], true);
  waits[0].resolve();
  await flush();
  assert.equal(cards[0].card.state.result, null);
  assert.equal(cards[1].card.state.result.kind, "balances");
  assert.equal(cards[2].card.state.result.kind, "balances");
});
