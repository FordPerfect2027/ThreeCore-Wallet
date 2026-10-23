import test from "node:test";
import assert from "node:assert/strict";
import { collectPeriod } from "../src/period-reader.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { periodDraftWorkspace, periodDraftProgress } from "../src/period-draft.js";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { TRANSFER_TOPIC, addressTopic } from "../src/transfer-codec.js";
import { periodProvider } from "./helpers/period-provider.js";
import { plan, context, ACCOUNT, OTHER, THIRD, deferred, tick, hash, code } from "./helpers/period-fixtures.js";

const ALLOWED = new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_getBlockByNumber",
  "eth_getCode", "eth_getBalance", "eth_call", "eth_getLogs"]);

for (const [agent, account] of [["DAT", ACCOUNT], ["EMA", OTHER], ["CAWELON", THIRD]]) {
  for (const chainId of [8453, 84532]) {
    test(`real session adapter collects ${agent}, chain ${chainId}, distinct account`, async () => {
      const selected = plan({}, context(agent, chainId, account));
      const f = periodProvider(selected);
      try {
        await f.session.connect();
        const callsBeforeRead = f.calls.length;
        const draft = await collectPeriod(f.session, selected);
        const report = reconcileWorkspace(periodDraftWorkspace(draft));
        assert.equal(report.slots.find(slot => slot.agent === agent).status, "arithmetic-agreement");
        assert.equal(draft.earlier.account, account);
        assert.equal(draft.later.balanceBaseUnits, "107000000000000000000");
        assert.equal(f.calls.slice(callsBeforeRead).some(row => row.method === "eth_requestAccounts"), false);
        assert.equal(f.calls.every(row => ALLOWED.has(row.method)), true);
        for (const call of f.calls.filter(row => ["eth_call", "eth_getBalance", "eth_getCode"].includes(row.method))) {
          assert.equal(call.params[1].requireCanonical, true);
          assert.match(call.params[1].blockHash, /^0x[0-9a-f]{64}$/);
        }
        for (const call of f.calls.filter(row => row.method === "eth_call")) {
          assert.equal(call.params[0].to, f.token.address);
          assert.equal(["0x06fdde03", "0x95d89b41", "0x313ce567", "0x18160ddd", "0x70a08231"].includes(call.params[0].data.slice(0, 10)), true);
        }
      } finally { f.session.disconnect(); }
    });
  }
}

test("log requests always retain fixed token and selected account filters", async () => {
  const f = periodProvider();
  try {
    await f.session.connect();
    await collectPeriod(f.session, plan());
    const filters = f.calls.filter(row => row.method === "eth_getLogs").map(row => row.params[0]);
    assert.equal(filters.length, 6);
    for (let index = 0; index < filters.length; index++) {
      const value = filters[index];
      assert.equal(value.address, f.token.address);
      assert.equal(value.topics[0], TRANSFER_TOPIC);
      assert.equal(value.topics[index % 2 === 0 ? 1 : 2], addressTopic(ACCOUNT));
      assert.ok(BigInt(value.fromBlock) > 30n);
      assert.ok(BigInt(value.toBlock) <= 42n);
    }
  } finally { f.session.disconnect(); }
});

test("session adapter rejects malformed provider log instead of checkpointing empty history", async () => {
  const f = periodProvider(plan(), { before: input => input.method === "eth_getLogs" ? [{}] : undefined });
  const saved = [];
  try {
    await f.session.connect();
    await assert.rejects(collectPeriod(f.session, plan(), { onCheckpoint: value => saved.push(value) }));
    assert.equal(saved.at(-1).records.length, 0);
    assert.equal(periodDraftProgress(saved.at(-1)).completed, 2);
  } finally { f.session.disconnect(); }
});

test("lack of archival historical state is not replaced by latest balance", async () => {
  const f = periodProvider(plan(), { before: input => {
    if (input.method === "eth_call" && input.params[1].blockHash === hash(30)) throw Error("historical state unavailable");
  } });
  const saved = [];
  try {
    await f.session.connect();
    await assert.rejects(collectPeriod(f.session, plan(), { onCheckpoint: value => saved.push(value) }));
    assert.equal(saved.length, 0);
    assert.equal(f.calls.some(row => row.method === "eth_call" && row.params[1] === "latest"), false);
  } finally { f.session.disconnect(); }
});

test("account event during collection aborts without reading another interval", async () => {
  let switched = false;
  const f = periodProvider(plan(), { before(input, provider) {
    if (!switched && input.method === "eth_getLogs") {
      switched = true;
      provider.account = OTHER;
      provider.emit("accountsChanged", [OTHER]);
    }
  } });
  try {
    await f.session.connect();
    await assert.rejects(collectPeriod(f.session, plan()));
    assert.equal(f.calls.filter(row => row.method === "eth_getLogs").length, 1);
    assert.equal(f.session.state.connected, false);
  } finally { f.session.disconnect(); }
});

test("silent chain changes are caught by normal adapter read guards", async () => {
  const f = periodProvider(plan(), { before(input, provider) {
    if (input.method === "eth_getLogs") provider.chain = "0x14a34";
  } });
  try {
    await f.session.connect();
    await assert.rejects(collectPeriod(f.session, plan()));
    assert.equal(f.session.state.connected, false);
    assert.equal(f.calls.filter(row => row.method === "eth_getLogs").length, 1);
  } finally { f.session.disconnect(); }
});

function cardFixture(options = {}) {
  const selected = plan();
  const f = periodProvider(selected, options);
  const views = [];
  const card = createWalletCardController({ agent: "DAT", siteOrigin: f.origin,
    onChange: value => views.push(value) });
  return { ...f, card, selected, views,
    connect: () => card.connect({ provider: f.provider, account: ACCOUNT, chainId: 8453 }) };
}

test("card-level period collection uses its existing selected session", async () => {
  const f = cardFixture();
  try {
    assert.equal(await f.connect(), true);
    const result = await f.card.readPeriod(f.selected);
    assert.equal(periodDraftProgress(result).complete, true);
    assert.equal(f.card.state.result.kind, "period");
    assert.equal(f.card.state.result.blockNumber, "42");
    assert.equal(f.card.state.phase, "connected");
    assert.equal(f.calls.filter(row => row.method === "eth_requestAccounts").length, 1);
  } finally { f.card.dispose(); }
});

test("unconnected card refuses to collect without opening a permission dialog", async () => {
  const f = cardFixture();
  try {
    await assert.rejects(f.card.readPeriod(f.selected), code("PERIOD_NOT_CONNECTED"));
    assert.deepEqual(f.calls, []);
  } finally { f.card.dispose(); }
});

for (const action of ["clearResult", "disconnect", "dispose"]) {
  test("card " + action + " stops a pending period request and ignores its late reply", async () => {
    const entered = deferred();
    const gate = deferred();
    const f = cardFixture({ before: input => {
      if (input.method === "eth_getLogs") { entered.resolve(); return gate.promise; }
    } });
    try {
      await f.connect();
      const pending = f.card.readPeriod(f.selected);
      const rejected = assert.rejects(pending);
      await entered.promise;
      const count = f.calls.length;
      f.card[action]();
      await rejected;
      gate.resolve([]);
      await tick();
      const newRequests = f.calls.slice(count).filter(row => row.method === "eth_getLogs" || row.method === "eth_call");
      assert.deepEqual(newRequests, []);
      assert.equal(f.card.state.result, null);
    } finally { gate.resolve([]); f.card.dispose(); }
  });
}

test("starting a different card read cancels the previous period collection", async () => {
  const entered = deferred();
  const gate = deferred();
  const f = cardFixture({ before: input => {
    if (input.method === "eth_getLogs") { entered.resolve(); return gate.promise; }
  } });
  try {
    await f.connect();
    const period = f.card.readPeriod(f.selected);
    const rejected = assert.rejects(period);
    await entered.promise;
    assert.equal(await f.card.readBalances(), true);
    await rejected;
    gate.resolve([]);
    await tick();
    assert.equal(f.card.state.result.kind, "balances");
    assert.equal(f.calls.filter(row => row.method === "eth_getLogs").length, 1);
  } finally { gate.resolve([]); f.card.dispose(); }
});

test("external cancellation reaches the card reader and preserves the connection", async () => {
  const entered = deferred();
  const gate = deferred();
  const f = cardFixture({ before: input => {
    if (input.method === "eth_getLogs") { entered.resolve(); return gate.promise; }
  } });
  try {
    await f.connect();
    const aborter = new AbortController();
    const pending = f.card.readPeriod(f.selected, { signal: aborter.signal });
    const rejected = assert.rejects(pending, code("PERIOD_CANCELLED"));
    await entered.promise;
    aborter.abort();
    await rejected;
    assert.equal(f.card.state.connection.connected, true);
    assert.equal(f.card.state.phase, "connected");
    gate.resolve([]);
  } finally { gate.resolve([]); f.card.dispose(); }
});
