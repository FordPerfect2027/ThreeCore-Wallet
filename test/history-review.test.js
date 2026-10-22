import test from "node:test";
import assert from "node:assert/strict";
import { reviewPortfolioHistory, describeHistoryReview, HISTORY_REVIEW_SCHEMA } from "../src/history-review.js";
import { observation, archive, ACCOUNT, OTHER, TOKEN, MAX } from "./helpers/history-fixtures.js";

const SECOND = "0x" + "44".repeat(20);
function missing(address = TOKEN) {
  return { address, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" };
}
function known(address = TOKEN, amount = "0") {
  return { address, hasCode: true, balanceBaseUnits: amount, notice: null };
}

test("empty history reports coverage without manufacturing balances", () => {
  const result = reviewPortfolioHistory(archive([]));
  assert.equal(result.schema, HISTORY_REVIEW_SCHEMA);
  assert.equal(result.observationCount, 0);
  assert.equal(result.identityCount, 0);
  assert.equal(result.distinctChainContracts, 0);
  assert.equal(result.knownTokenObservations, 0);
  assert.equal(result.unknownTokenObservations, 0);
  assert.deepEqual(result.warnings, ["EMPTY_HISTORY"]);
  assert.deepEqual(result.groups, []);
});

test("coverage report explicitly grants no safety or transaction claims", () => {
  const result = reviewPortfolioHistory(archive());
  assert.equal(result.historicalObservation, true);
  for (const key of ["provesCurrentBalance", "provesOwnership", "provesTransfers", "provesProfit",
    "securityAudit", "canAuthorizeConnection", "canAuthorizeTransaction"]) {
    assert.equal(result[key], false, key);
  }
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test("single observation identity is retained for " + agent, () => {
    const result = reviewPortfolioHistory(archive([observation("42", { agent })]));
    const group = result.groups[0];
    assert.equal(group.agent, agent);
    assert.equal(group.account, ACCOUNT);
    assert.equal(group.chainId, 84532);
    assert.equal(group.siteOrigin, "http://localhost:4184");
    assert.equal(group.observationCount, 1);
    assert.equal(group.earliestBlockNumber, "42");
    assert.equal(group.latestBlockNumber, "42");
    assert.equal(group.contractCount, 1);
    assert.equal(group.missingCodeObservations, 0);
    assert.deepEqual(group.observationGaps, []);
    assert.deepEqual(group.coverageChanges, []);
  });
}

test("zero token balance is known, not missing", () => {
  const result = reviewPortfolioHistory(archive([observation("42", { holdings: [known()] })]));
  assert.equal(result.knownTokenObservations, 1);
  assert.equal(result.unknownTokenObservations, 0);
  assert.equal(result.warnings.includes("UNKNOWN_TOKEN_BALANCES"), false);
});

test("missing code stays unknown and generates an explicit warning", () => {
  const result = reviewPortfolioHistory(archive([observation("42", { holdings: [missing()] })]));
  assert.equal(result.knownTokenObservations, 0);
  assert.equal(result.unknownTokenObservations, 1);
  assert.equal(result.groups[0].missingCodeObservations, 1);
  assert.ok(result.warnings.includes("UNKNOWN_TOKEN_BALANCES"));
});

test("mixed known and unknown rows are counted separately", () => {
  const result = reviewPortfolioHistory(archive([
    observation("1", { holdings: [known(), missing(SECOND)] }),
    observation("2", { holdings: [missing(), known(SECOND)] }),
  ]));
  assert.equal(result.knownTokenObservations, 2);
  assert.equal(result.unknownTokenObservations, 2);
  assert.equal(result.distinctChainContracts, 2);
  assert.equal(result.groups[0].contractCount, 2);
  assert.equal(result.groups[0].coverageChanges.length, 0);
});

for (const changes of [
  { account: OTHER },
  { chainId: 8453 },
  { agent: "EMA" },
  { siteOrigin: "http://localhost:4185" },
]) {
  test("identity boundary remains separate " + JSON.stringify(changes), () => {
    const result = reviewPortfolioHistory(archive([observation("1"), observation("100", changes)]));
    assert.equal(result.identityCount, 2);
    assert.ok(result.warnings.includes("SEPARATE_IDENTITIES"));
    assert.ok(result.groups.every(group => group.observationGaps.length === 0));
  });
}

test("same address on different chains counts as distinct contracts", () => {
  const result = reviewPortfolioHistory(archive([observation("1"), observation("2", { chainId: 8453 })]));
  assert.equal(result.distinctChainContracts, 2);
});

test("same contract on same chain across accounts is not double-counted", () => {
  const result = reviewPortfolioHistory(archive([observation("1"), observation("2", { account: OTHER })]));
  assert.equal(result.distinctChainContracts, 1);
  assert.equal(result.knownTokenObservations, 2);
});

test("consecutive observations have no unobserved-height gap", () => {
  const result = reviewPortfolioHistory(archive([observation("1"), observation("2"), observation("3")]));
  assert.deepEqual(result.groups[0].observationGaps, []);
  assert.ok(!result.warnings.includes("SAMPLED_BLOCKS"));
});

for (const [first, last, between] of [
  ["1", "3", "1"],
  ["0", "100", "99"],
  ["9007199254740992", "9007199254740994", "1"],
  ["0", MAX, (BigInt(MAX) - 1n).toString()],
]) {
  test("sampled block distance remains exact " + first + ".." + last, () => {
    const result = reviewPortfolioHistory(archive([observation(last), observation(first)]));
    assert.deepEqual(result.groups[0].observationGaps[0], {
      earlierBlockNumber: first, laterBlockNumber: last, unobservedHeightsBetween: between,
    });
    assert.ok(result.warnings.includes("SAMPLED_BLOCKS"));
  });
}

test("token additions and exclusions are not treated as balance changes", () => {
  const result = reviewPortfolioHistory(archive([
    observation("1", { holdings: [known()] }),
    observation("2", { holdings: [known(SECOND)] }),
  ]));
  const change = result.groups[0].coverageChanges[0];
  assert.deepEqual(change.newlyObservedContracts, [SECOND]);
  assert.deepEqual(change.noLongerObservedContracts, [TOKEN]);
  assert.ok(result.warnings.includes("TOKEN_COVERAGE_CHANGED"));
});

test("reordered token rows do not create a coverage change", () => {
  const result = reviewPortfolioHistory(archive([
    observation("1", { holdings: [known(), known(SECOND)] }),
    observation("2", { holdings: [known(SECOND), known()] }),
  ]));
  assert.deepEqual(result.groups[0].coverageChanges, []);
});

test("contract code recovery is not a token coverage addition", () => {
  const result = reviewPortfolioHistory(archive([
    observation("1", { holdings: [missing()] }),
    observation("2", { holdings: [known()] }),
  ]));
  assert.equal(result.unknownTokenObservations, 1);
  assert.deepEqual(result.groups[0].coverageChanges, []);
});

test("uint256 amounts are not summed or converted to market values", () => {
  const text = archive([
    observation("1", { nativeBalanceBaseUnits: MAX, holdings: [known(TOKEN, MAX)] }),
    observation("2", { nativeBalanceBaseUnits: MAX, holdings: [known(TOKEN, MAX)] }),
  ]);
  const result = reviewPortfolioHistory(text);
  assert.equal(result.knownTokenObservations, 2);
  assert.ok(!("totalBalance" in result));
  assert.ok(!("usdValue" in result));
});

test("review leaves original archive unchanged", () => {
  const text = archive([observation("10"), observation("1")]);
  const before = JSON.parse(text);
  reviewPortfolioHistory(text);
  assert.deepEqual(JSON.parse(text), before);
});

test("every returned nested collection is frozen", () => {
  const result = reviewPortfolioHistory(archive([
    observation("1"), observation("3", { holdings: [missing(SECOND)] }),
  ]));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.warnings));
  assert.ok(Object.isFrozen(result.groups));
  assert.ok(Object.isFrozen(result.groups[0]));
  assert.ok(Object.isFrozen(result.groups[0].observationGaps));
  assert.ok(Object.isFrozen(result.groups[0].observationGaps[0]));
  assert.ok(Object.isFrozen(result.groups[0].coverageChanges[0]));
  assert.ok(Object.isFrozen(result.groups[0].coverageChanges[0].newlyObservedContracts));
});

for (const text of ["", "null", "{}", "[]", "broken", "<script>"]) {
  test("invalid archive cannot become a coverage report " + text, () => {
    assert.throws(() => reviewPortfolioHistory(text));
    assert.throws(() => describeHistoryReview(text));
  });
}

for (const change of [
  row => { row.nativeBalanceBaseUnits = "-1"; },
  row => { row.readOnly = false; },
  row => { row.securityAudit = true; },
  row => { row.holdings[0].balanceBaseUnits = MAX + "0"; },
  row => { row.extra = true; },
]) {
  test("invalid snapshot fails before coverage is displayed " + change.toString(), () => {
    const document = JSON.parse(archive());
    change(document.reports[0].snapshot);
    assert.throws(() => reviewPortfolioHistory(JSON.stringify(document)));
  });
}

test("text report labels unknown balances and sampled blocks precisely", () => {
  const result = describeHistoryReview(archive([
    observation("1", { holdings: [missing()] }), observation("10"),
  ]));
  assert.match(result, /ゼロ残高とは異なります/);
  assert.match(result, /連続した送金履歴ではありません/);
  assert.match(result, /監査・安全性の判定ではありません/);
  assert.match(result, /間の未観測ブロック数 8/);
});

test("text report explains absent token coverage instead of reporting a sale", () => {
  const result = describeHistoryReview(archive([
    observation("1"), observation("2", { holdings: [known(SECOND)] }),
  ]));
  assert.match(result, /確認対象に追加/);
  assert.match(result, /後の記録では対象外/);
  assert.ok(!result.includes("売却済み"));
});

test("review never invokes injected wallet provider methods", () => {
  const previous = globalThis.ethereum;
  let calls = 0;
  globalThis.ethereum = { request() { calls++; } };
  try {
    describeHistoryReview(archive([observation("1"), observation("3")]));
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete globalThis.ethereum;
    else globalThis.ethereum = previous;
  }
});
