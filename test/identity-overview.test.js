import test from "node:test";
import assert from "node:assert/strict";
import { summarizeIdentityCards, describeIdentityCards } from "../src/identity-overview.js";
import { observation, clone, code } from "./helpers/identity-fixtures.js";

const agents = ["DAT", "EMA", "CAWELON"];
function rows({ sameAccount = false, provenance = "read", chainId = 8453 } = {}) {
  return agents.map((agent, index) => ({ agent, phase: "ready", provenance,
    observation: observation({ account: "0x" + (sameAccount ? "11" : ["11", "22", "33"][index]).repeat(20) }, agent, chainId) }));
}
const empty = () => agents.map(agent => ({ agent, phase: "idle", provenance: null, observation: null }));

test("empty overview does not claim any connection or balance", () => {
  const result = summarizeIdentityCards(empty());
  assert.equal(result.observedCards, 0);
  assert.equal(result.matchedCards, 0);
  assert.equal(result.distinctObservedAccounts, 0);
  assert.equal(result.monetaryTotal, null);
  assert.equal(result.provesCurrentConnection, false);
});

test("three distinct matching accounts are counted without adding token amounts", () => {
  const result = summarizeIdentityCards(rows());
  assert.equal(result.observedCards, 3);
  assert.equal(result.matchedCards, 3);
  assert.equal(result.distinctObservedAccounts, 3);
  assert.equal(result.readCards, 3);
  assert.equal(result.importedCards, 0);
  assert.equal(result.simultaneousSnapshot, false);
  assert.equal(result.securityAudit, false);
  assert.equal(result.monetaryTotal, null);
});

test("imports are counted separately from new reads", () => {
  const input = rows();
  input[1].provenance = "imported";
  const result = summarizeIdentityCards(input);
  assert.equal(result.matchedCards, 3);
  assert.equal(result.readCards, 2);
  assert.equal(result.importedCards, 1);
});

test("same wallet across cards is reported explicitly", () => {
  const input = rows({ sameAccount: true });
  const result = summarizeIdentityCards(input);
  assert.equal(result.distinctObservedAccounts, 1);
  assert.equal(result.duplicateAccounts.length, 1);
  assert.match(describeIdentityCards(input), /独立したWalletの確認とは扱いません/);
});

test("testnet and mainnet are never treated as a single network", () => {
  const input = rows();
  input[1].observation = observation({}, "EMA", 84532);
  const result = summarizeIdentityCards(input);
  assert.equal(result.mixedNetworks, true);
  assert.match(describeIdentityCards(input), /本番とテストネット/);
});

test("different origins remain visible in the summary", () => {
  const input = rows();
  input[1].observation.siteOrigin = "https://other.example";
  assert.equal(summarizeIdentityCards(input).mixedOrigins, true);
  assert.match(describeIdentityCards(input), /参照元が異なる/);
});

test("a mismatched token lowers matched count while retaining the account", () => {
  const input = rows();
  input[1].observation.metadata.symbol = "OTHER";
  const result = summarizeIdentityCards(input);
  assert.equal(result.observedCards, 3);
  assert.equal(result.matchedCards, 2);
  assert.equal(result.cards[1].amount, null);
  assert.match(describeIdentityCards(input), /EMA: 不一致あり/);
});

test("no code is shown as unknown instead of a zero balance", () => {
  const input = rows();
  Object.assign(input[2].observation, { hasCode: false, metadata: null, balanceBaseUnits: null });
  const result = summarizeIdentityCards(input);
  assert.equal(result.cards[2].amount, null);
  assert.match(describeIdentityCards(input), /CAWELON: 契約コードなし/);
});

test("card order is stable regardless of incoming order", () => {
  assert.deepEqual(summarizeIdentityCards(rows().reverse()).cards.map(row => row.agent), agents);
});

test("summary is detached, frozen and does not change its inputs", () => {
  const input = rows();
  const original = clone(input);
  const result = summarizeIdentityCards(input);
  input[0].observation.account = "0x" + "99".repeat(20);
  assert.equal(result.cards[0].account, original[0].observation.account);
  assert.equal(Object.isFrozen(result.cards), true);
  assert.equal(Object.isFrozen(result.cards[0]), true);
});

for (const phase of ["reading", "loading", "error", "cancelled", "disposed", "idle"]) {
  test("phase " + phase + " cannot retain a falsely ready observation", () => {
    const input = rows();
    input[0].phase = phase;
    assert.throws(() => summarizeIdentityCards(input), code("IDENTITY_OVERVIEW_SHAPE"));
  });
}

test("pending state may be summarized without an observation", () => {
  const input = empty();
  input[0].phase = "reading";
  assert.match(describeIdentityCards(input), /DAT: 処理中/);
});

for (const mutate of [
  input => input.pop(),
  input => { input[1] = input[0]; },
  input => { input[0].agent = "DOT"; },
  input => { input[0].provenance = "verified-live"; },
  input => { input[0].provenance = null; },
  input => { input[0].observation = null; },
  input => { input[0].observation = observation({}, "EMA"); },
  input => { input.extra = true; },
  input => { delete input[0]; },
]) {
  test("invalid overview data is rejected before aggregation", () => {
    const input = rows();
    mutate(input);
    assert.throws(() => summarizeIdentityCards(input));
  });
}

test("overview does not invoke array accessors", () => {
  const input = rows();
  let calls = 0;
  Object.defineProperty(input, "0", { get() { calls++; return {}; } });
  assert.throws(() => summarizeIdentityCards(input), code("IDENTITY_OVERVIEW_SHAPE"));
  assert.equal(calls, 0);
});

test("text summary includes exact amounts and individual block references", () => {
  const input = rows();
  input[1].observation.blockNumber = "43";
  const text = describeIdentityCards(input);
  assert.match(text, /1\.234567890123456789 DAT/);
  assert.match(text, /1\.234567890123456789 EMA/);
  assert.match(text, /block 42/);
  assert.match(text, /block 43/);
  assert.match(text, /同時点の一括残高/);
});
