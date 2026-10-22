import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { summarizePortfolioHistory, describePortfolioHistory } from "../src/portfolio-history-summary.js";

const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "33".repeat(20);
const OTHER = "0x" + "44".repeat(20);
const MAX = ((1n << 256n) - 1n).toString();

function snapshot(block, amount = "0", changes = {}) {
  return {
    agent: "DAT",
    account: ACCOUNT,
    chainId: 84532,
    siteOrigin: "http://localhost:4184",
    connectionEpoch: 1,
    blockNumber: String(block),
    blockHash: "0x" + "ab".repeat(32),
    nativeBalanceBaseUnits: amount,
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: amount, notice: null }],
    readOnly: true,
    securityAudit: false,
    ...changes,
  };
}

function archive(rows) {
  const history = createPortfolioHistory();
  history.merge(rows);
  return history.exportText();
}

test("empty history summary is bounded and grants no authority", () => {
  const summary = summarizePortfolioHistory(archive([]));
  assert.equal(summary.observationCount, 0);
  assert.equal(summary.identityCount, 0);
  assert.deepEqual(summary.groups, []);
  assert.equal(summary.canAuthorizeTransaction, false);
  assert.equal(summary.canAuthorizeConnection, false);
  assert.equal(summary.provesProfit, false);
  assert.equal(summary.provesTransfers, false);
  assert.equal(summary.securityAudit, false);
});

test("timeline sorts numeric block heights without changing caller archive", () => {
  const text = archive([snapshot("10"), snapshot("2"), snapshot(MAX)]);
  const summary = summarizePortfolioHistory(text);
  assert.deepEqual(summary.groups[0].observations.map(row => row.blockNumber), ["2", "10", MAX]);
  assert.equal(JSON.parse(text).reports[0].snapshot.blockNumber, "10");
  assert.equal(summary.groups[0].transitions.length, 2);
});

test("single observation has no manufactured transition", () => {
  const summary = summarizePortfolioHistory(archive([snapshot("1")]));
  assert.equal(summary.groups[0].observations.length, 1);
  assert.equal(summary.groups[0].transitions.length, 0);
});

for (const changes of [
  { agent: "EMA" },
  { agent: "CAWELON" },
  { account: OTHER },
  { chainId: 8453 },
  { siteOrigin: "http://localhost:4185" },
]) {
  test("distinct identity never receives cross-identity transitions " + JSON.stringify(changes), () => {
    const summary = summarizePortfolioHistory(archive([snapshot("1"), snapshot("2", "0", changes)]));
    assert.equal(summary.identityCount, 2);
    for (const group of summary.groups) assert.equal(group.transitions.length, 0);
  });
}

for (const [before, after, expected] of [
  ["0", MAX, MAX],
  [MAX, "0", "-" + MAX],
  ["9007199254740992", "9007199254740993", "1"],
  ["10", "10", "0"],
]) {
  test("timeline retains exact base-unit transition " + expected, () => {
    const summary = summarizePortfolioHistory(archive([snapshot("1", before), snapshot("2", after)]));
    const transition = summary.groups[0].transitions[0];
    assert.equal(transition.native.deltaBaseUnits, expected);
    assert.equal(transition.holdings[0].deltaBaseUnits, expected);
    assert.equal(transition.provesProfit, false);
  });
}

test("unknown token balances remain unknown in structured and text summaries", () => {
  const holdings = [{ address: TOKEN, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }];
  const text = archive([snapshot("1", "0", { holdings }), snapshot("2")]);
  const summary = summarizePortfolioHistory(text);
  assert.equal(summary.groups[0].observations[0].unknownTokenCount, 1);
  assert.equal(summary.groups[0].observations[0].knownTokenCount, 0);
  assert.equal(summary.groups[0].transitions[0].holdings[0].deltaBaseUnits, null);
  assert.match(describePortfolioHistory(text), /比較不可/);
});

test("summary and every returned nested collection are frozen", () => {
  const summary = summarizePortfolioHistory(archive([snapshot("1"), snapshot("2")]));
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(summary.groups));
  assert.ok(Object.isFrozen(summary.groups[0]));
  assert.ok(Object.isFrozen(summary.groups[0].observations));
  assert.ok(Object.isFrozen(summary.groups[0].observations[0]));
  assert.ok(Object.isFrozen(summary.groups[0].transitions));
});

for (const text of ["", "null", "[]", "{}", "broken"]) {
  test("invalid archive is rejected before rendering " + text, () => {
    assert.throws(() => summarizePortfolioHistory(text));
    assert.throws(() => describePortfolioHistory(text));
  });
}

test("plain text explains observation limits and preserves raw units", () => {
  const text = describePortfolioHistory(archive([snapshot("1", MAX)]));
  assert.match(text, /現在の残高・所有権・送金履歴・利益を証明するものではありません/);
  assert.ok(text.includes(MAX));
  assert.match(text, /チェーン: 84532/);
  assert.match(text, /DAT/);
  assert.ok(!text.includes("USD"));
});

test("summary makes no wallet provider calls", () => {
  let calls = 0;
  const previous = globalThis.ethereum;
  globalThis.ethereum = { request() { calls++; throw Error("Unexpected provider call"); } };
  try {
    describePortfolioHistory(archive([snapshot("1"), snapshot("2")]));
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete globalThis.ethereum;
    else globalThis.ethereum = previous;
  }
});
