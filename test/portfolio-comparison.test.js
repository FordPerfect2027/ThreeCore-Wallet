import test from "node:test";
import assert from "node:assert/strict";
import {
  comparePortfolioSnapshots, describePortfolioComparison, PortfolioComparisonError,
} from "../src/portfolio-comparison.js";

const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "33".repeat(20);
const OTHER = "0x" + "44".repeat(20);
const THIRD = "0x" + "55".repeat(20);
const HASH = "0x" + "ab".repeat(32);
const NEXT_HASH = "0x" + "cd".repeat(32);
const MAX = (1n << 256n) - 1n;
function holding(address = TOKEN, amount = "42") {
  return { address, hasCode: true, balanceBaseUnits: amount, notice: null };
}
function missing(address = TOKEN) {
  return { address, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" };
}
function snapshot(overrides = {}) {
  return {
    agent: "DAT", account: ACCOUNT, chainId: 84532,
    siteOrigin: "http://localhost:4184", connectionEpoch: 1,
    blockNumber: "42", blockHash: HASH, nativeBalanceBaseUnits: "16",
    holdings: [holding()], readOnly: true, securityAudit: false, ...overrides,
  };
}
function later(overrides = {}) {
  return snapshot({ blockNumber: "43", blockHash: NEXT_HASH, ...overrides });
}
function rejectsCode(first, last, code) {
  assert.throws(() => comparePortfolioSnapshots(first, last),
    error => error instanceof PortfolioComparisonError && error.code === code);
}

test("a comparison represents historical observations and grants no capabilities", () => {
  const result = comparePortfolioSnapshots(snapshot(), later());
  assert.equal(result.historicalObservation, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.securityAudit, false);
  assert.equal(result.provesTransfers, false);
  assert.equal(result.provesProfit, false);
  assert.equal(result.canAuthorizeConnection, false);
  assert.equal(result.canAuthorizeTransaction, false);
  assert.equal(result.native.deltaBaseUnits, "0");
  assert.equal(result.holdings[0].direction, "unchanged");
});

for (const [before, after, delta, direction] of [
  ["0", "1", "1", "increased"],
  ["1", "0", "-1", "decreased"],
  ["0", "0", "0", "unchanged"],
  [MAX.toString(), "0", "-" + MAX, "decreased"],
  ["0", MAX.toString(), MAX.toString(), "increased"],
  [(MAX - 1n).toString(), MAX.toString(), "1", "increased"],
]) {
  test("native and token differences retain exact signed uint256 magnitude: " + delta, () => {
    const result = comparePortfolioSnapshots(
      snapshot({ nativeBalanceBaseUnits: before, holdings: [holding(TOKEN, before)] }),
      later({ nativeBalanceBaseUnits: after, holdings: [holding(TOKEN, after)] }),
    );
    assert.equal(result.native.deltaBaseUnits, delta);
    assert.equal(result.native.direction, direction);
    assert.equal(result.holdings[0].deltaBaseUnits, delta);
    assert.equal(result.holdings[0].direction, direction);
  });
}

for (const [field, value] of [
  ["agent", "EMA"],
  ["account", "0x" + "22".repeat(20)],
  ["chainId", 8453],
  ["siteOrigin", "http://localhost:4185"],
]) {
  test("different " + field + " is not comparable", () => {
    rejectsCode(snapshot(), later({ [field]: value }), "IDENTITY_MISMATCH");
  });
}

test("reconnection epochs can differ without changing the observed identity", () => {
  const result = comparePortfolioSnapshots(snapshot(), later({ connectionEpoch: 99 }));
  assert.equal(result.account, ACCOUNT);
  assert.equal(result.native.deltaBaseUnits, "0");
});

test("mixed-case addresses and block hashes normalize before comparison", () => {
  const first = snapshot({ account: ACCOUNT.toUpperCase().replace("0X", "0x"),
    blockHash: HASH.toUpperCase().replace("0X", "0x") });
  const result = comparePortfolioSnapshots(first, snapshot());
  assert.equal(result.sameBlock, true);
  assert.equal(result.earlierBlockHash, HASH);
});

test("the baseline cannot silently reverse chronological order", () => {
  rejectsCode(later(), snapshot(), "REVERSED_BLOCKS");
});

test("same block height with conflicting hashes is rejected", () => {
  rejectsCode(snapshot(), snapshot({ blockHash: NEXT_HASH }), "BLOCK_CONFLICT");
});

for (const change of [
  { nativeBalanceBaseUnits: "17" },
  { holdings: [holding(TOKEN, "43")] },
  { holdings: [missing()] },
]) {
  test("contradictory observations at one block are rejected: " + JSON.stringify(change), () => {
    rejectsCode(snapshot(), snapshot(change), "OBSERVATION_CONFLICT");
  });
}

test("equal observations from the same block produce exact zero differences", () => {
  const result = comparePortfolioSnapshots(snapshot(), snapshot());
  assert.equal(result.sameBlock, true);
  assert.equal(result.native.deltaBaseUnits, "0");
  assert.equal(result.holdings[0].availability, "comparable");
});

test("newly observed contracts do not acquire an invented zero baseline", () => {
  const result = comparePortfolioSnapshots(snapshot(), later({ holdings: [holding(), holding(OTHER, "7")] }));
  const row = result.holdings[1];
  assert.equal(row.address, OTHER);
  assert.equal(row.earlierBalanceBaseUnits, null);
  assert.equal(row.laterBalanceBaseUnits, "7");
  assert.equal(row.deltaBaseUnits, null);
  assert.equal(row.direction, "unknown");
  assert.equal(row.availability, "not_observed_before");
});

test("contracts omitted from the later plan do not become observed zero balances", () => {
  const result = comparePortfolioSnapshots(
    snapshot({ holdings: [holding(), holding(OTHER, "7")] }), later(),
  );
  assert.equal(result.holdings[1].laterBalanceBaseUnits, null);
  assert.equal(result.holdings[1].deltaBaseUnits, null);
  assert.equal(result.holdings[1].availability, "not_observed_after");
});

for (const [before, after] of [
  [[missing()], [holding()]],
  [[holding()], [missing()]],
  [[missing()], [missing()]],
]) {
  test("missing contract code prevents a numeric difference: " + JSON.stringify([before, after]), () => {
    const row = comparePortfolioSnapshots(snapshot({ holdings: before }), later({ holdings: after })).holdings[0];
    assert.equal(row.deltaBaseUnits, null);
    assert.equal(row.direction, "unknown");
    assert.equal(row.availability, "contract_code_missing");
  });
}

test("contract matching uses addresses rather than array position", () => {
  const result = comparePortfolioSnapshots(
    snapshot({ holdings: [holding(TOKEN, "10"), holding(OTHER, "20")] }),
    later({ holdings: [holding(OTHER, "15"), holding(TOKEN, "12")] }),
  );
  assert.deepEqual(result.holdings.map(row => [row.address, row.deltaBaseUnits]),
    [[TOKEN, "2"], [OTHER, "-5"]]);
});

test("union order keeps baseline order and appends newly observed contracts", () => {
  const result = comparePortfolioSnapshots(
    snapshot({ holdings: [holding(OTHER), holding(TOKEN)] }),
    later({ holdings: [holding(THIRD), holding(TOKEN)] }),
  );
  assert.deepEqual(result.holdings.map(row => row.address), [OTHER, TOKEN, THIRD]);
});

test("a union of two maximum-size plans can describe 64 distinct contracts", () => {
  const address = index => "0x" + index.toString(16).padStart(40, "0");
  const first = Array.from({ length: 32 }, (_, i) => holding(address(i + 1)));
  const last = Array.from({ length: 32 }, (_, i) => holding(address(i + 33)));
  const result = comparePortfolioSnapshots(snapshot({ holdings: first }), later({ holdings: last }));
  assert.equal(result.holdings.length, 64);
  assert.equal(result.holdings.filter(row => row.availability === "not_observed_before").length, 32);
  assert.equal(result.holdings.filter(row => row.availability === "not_observed_after").length, 32);
});

test("comparison does not mutate or retain mutable input objects", () => {
  const first = snapshot(), last = later();
  const before = structuredClone([first, last]);
  const result = comparePortfolioSnapshots(first, last);
  assert.deepEqual([first, last], before);
  last.holdings[0].balanceBaseUnits = "999";
  first.nativeBalanceBaseUnits = "999";
  assert.equal(result.native.earlierBalanceBaseUnits, "16");
  assert.equal(result.holdings[0].laterBalanceBaseUnits, "42");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.native), true);
  assert.equal(Object.isFrozen(result.holdings), true);
  assert.equal(Object.isFrozen(result.holdings[0]), true);
});

for (const bad of [
  null, [], {},
  snapshot({ readOnly: false }),
  snapshot({ securityAudit: true }),
  snapshot({ nativeBalanceBaseUnits: "1e18" }),
  snapshot({ holdings: [] }),
  snapshot({ holdings: [holding(), holding()] }),
  snapshot({ blockNumber: "-1" }),
]) {
  test("invalid snapshots cannot enter comparison: " + JSON.stringify(bad), () => {
    assert.throws(() => comparePortfolioSnapshots(bad, later()));
    assert.throws(() => comparePortfolioSnapshots(snapshot(), bad));
  });
}

test("accessor payloads cannot execute during validation", () => {
  let ran = false;
  const bad = snapshot();
  Object.defineProperty(bad, "account", { enumerable: true, get() { ran = true; return ACCOUNT; } });
  assert.throws(() => comparePortfolioSnapshots(bad, later()));
  assert.equal(ran, false);
});

test("text display marks positive differences and preserves negative signs", () => {
  const text = describePortfolioComparison(snapshot(), later({
    nativeBalanceBaseUnits: "20", holdings: [holding(TOKEN, "1")],
  }));
  assert.match(text, /wei）: \+4/);
  assert.match(text, /最小単位）: -41/);
  assert.match(text, /42 → 43/);
  assert.match(text, /現在の残高・送金履歴・利益の証明ではありません/);
  assert.match(text, /資産間の合算・価格換算は行っていません/);
  assert.ok(text.includes(HASH) && text.includes(NEXT_HASH));
});

test("text display explains all unknown comparison reasons without zero substitution", () => {
  const first = snapshot({ holdings: [missing(), holding(OTHER)] });
  const last = later({ holdings: [holding(), holding(THIRD)] });
  const text = describePortfolioComparison(first, last);
  assert.match(text, /契約コードがなく比較できません/);
  assert.match(text, /前の記録では未確認/);
  assert.match(text, /後の記録では未確認/);
  assert.doesNotMatch(text, /最小単位）: 0/);
});

test("formatting validates snapshots rather than trusting a fabricated comparison object", () => {
  const fabricated = { native: { deltaBaseUnits: "999" }, provesProfit: true };
  assert.throws(() => describePortfolioComparison(fabricated, later()));
});

test("sequential differences telescope across three observations without rounding", () => {
  const observations = [
    ["0", "1000000000000000001", MAX.toString()],
    [MAX.toString(), (MAX - 1n).toString(), "0"],
    ["9007199254740991", "9007199254740992", "9007199254740993"],
    ["123456789012345678901234567890", "7", "123456789012345678901234567890"],
  ];
  for (const [a, b, c] of observations) {
    const at = (height, amount) => snapshot({
      blockNumber: String(height),
      blockHash: "0x" + height.toString(16).padStart(64, "0"),
      nativeBalanceBaseUnits: amount,
      holdings: [holding(TOKEN, amount)],
    });
    const first = at(42, a), middle = at(43, b), last = at(44, c);
    const ab = comparePortfolioSnapshots(first, middle);
    const bc = comparePortfolioSnapshots(middle, last);
    const ac = comparePortfolioSnapshots(first, last);
    assert.equal(BigInt(ab.native.deltaBaseUnits) + BigInt(bc.native.deltaBaseUnits),
      BigInt(ac.native.deltaBaseUnits));
    assert.equal(BigInt(ab.holdings[0].deltaBaseUnits) + BigInt(bc.holdings[0].deltaBaseUnits),
      BigInt(ac.holdings[0].deltaBaseUnits));
  }
});

test("token-plan permutations cannot change any matched contract's difference", () => {
  const plans = [
    [holding(TOKEN, "0"), holding(OTHER, MAX.toString()), holding(THIRD, "100")],
    [holding(THIRD, "99"), holding(TOKEN, "1"), holding(OTHER, (MAX - 1n).toString())],
  ];
  const expected = new Map([[TOKEN, "1"], [OTHER, "-1"], [THIRD, "-1"]]);
  for (let shift = 0; shift < plans[1].length; shift++) {
    const reordered = [...plans[1].slice(shift), ...plans[1].slice(0, shift)];
    const result = comparePortfolioSnapshots(
      snapshot({ holdings: plans[0] }), later({ holdings: reordered }),
    );
    for (const row of result.holdings) {
      assert.equal(row.deltaBaseUnits, expected.get(row.address));
      assert.equal(row.availability, "comparable");
    }
  }
});

test("same-block observations may use different plans without inventing missing values", () => {
  const result = comparePortfolioSnapshots(
    snapshot({ holdings: [holding(TOKEN)] }),
    snapshot({ holdings: [holding(OTHER)] }),
  );
  assert.equal(result.sameBlock, true);
  assert.equal(result.holdings.length, 2);
  assert.equal(result.holdings[0].availability, "not_observed_after");
  assert.equal(result.holdings[1].availability, "not_observed_before");
  assert.equal(result.holdings.every(row => row.deltaBaseUnits === null), true);
});

test("very large block numbers compare as exact integers rather than floating point", () => {
  const first = "9007199254740992000000000000000000000";
  const last = (BigInt(first) + 1n).toString();
  const result = comparePortfolioSnapshots(
    snapshot({ blockNumber: first }), later({ blockNumber: last }),
  );
  assert.equal(result.sameBlock, false);
  assert.equal(result.earlierBlockNumber, first);
  assert.equal(result.laterBlockNumber, last);
});
