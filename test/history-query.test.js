import test from "node:test";
import assert from "node:assert/strict";
import { validateHistoryQuery, queryPortfolioHistory, exportFilteredHistory } from "../src/history-query.js";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { archive, observation, ACCOUNT, OTHER, MAX } from "./helpers/history-fixtures.js";

const sample = () => archive([
  observation("2"),
  observation("10"),
  observation("20", { account: OTHER }),
  observation("30", { chainId: 8453 }),
  observation(MAX),
]);

test("empty query preserves every record and grants no capabilities", () => {
  const result = queryPortfolioHistory(sample());
  assert.equal(result.totalCount, 5);
  assert.equal(result.matchCount, 5);
  assert.equal(result.canAuthorizeConnection, false);
  assert.equal(result.canAuthorizeTransaction, false);
  assert.equal(result.historicalObservation, true);
  assert.ok(Object.isFrozen(result));
});

test("account filter matches normalized exact address", () => {
  const result = queryPortfolioHistory(sample(), { account: OTHER });
  assert.equal(result.matchCount, 1);
  assert.equal(result.rows[0].snapshot.account, OTHER);
  assert.equal(result.rows[0].index, 2);
});

test("case normalization is performed without substring matches", () => {
  const address = "0x" + "ab".repeat(20);
  const text = archive([observation("1", { account: address })]);
  const result = queryPortfolioHistory(text, { account: "0x" + "AB".repeat(20) });
  assert.equal(result.matchCount, 1);
  assert.equal(result.query.account, address);
});

test("chain filter separates Base mainnet from testnet", () => {
  const result = queryPortfolioHistory(sample(), { chainId: 8453 });
  assert.equal(result.matchCount, 1);
  assert.equal(result.rows[0].snapshot.chainId, 8453);
});

test("combined account and chain conditions use intersection", () => {
  const result = queryPortfolioHistory(sample(), { account: OTHER, chainId: 8453 });
  assert.equal(result.matchCount, 0);
});

for (const [query, expected] of [
  [{ minimumBlock: "10" }, ["10", "20", "30", MAX]],
  [{ maximumBlock: "10" }, ["2", "10"]],
  [{ minimumBlock: "10", maximumBlock: "20" }, ["10", "20"]],
  [{ minimumBlock: MAX, maximumBlock: MAX }, [MAX]],
  [{ minimumBlock: "0", maximumBlock: "0" }, []],
  [{ order: "newest" }, [MAX, "30", "20", "10", "2"]],
]) {
  test("exact block bounds and numeric ordering " + JSON.stringify(query), () => {
    const result = queryPortfolioHistory(sample(), query);
    assert.deepEqual(result.rows.map(row => row.snapshot.blockNumber), expected);
  });
}

test("block values above Number precision are not rounded", () => {
  const text = archive([observation("9007199254740992"), observation("9007199254740993")]);
  const result = queryPortfolioHistory(text, { minimumBlock: "9007199254740993" });
  assert.equal(result.matchCount, 1);
  assert.equal(result.rows[0].snapshot.blockNumber, "9007199254740993");
});

for (const [key, values] of [
  ["minimumBlock", ["01", "-1", "1.0", "1e3", " 1", 1, null, undefined, MAX + "0"]],
  ["maximumBlock", ["00", "-2", "0x10", "+1", "1 ", 1, {}, MAX + "0"]],
  ["account", ["partial", "0x123", 123, {}, []]],
  ["chainId", [0, -1, 1.5, "8453", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]],
  ["order", ["asc", "desc", 1, {}, []]],
]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    test("invalid filter field " + key + "=" + String(value), () => {
      assert.throws(() => validateHistoryQuery({ [key]: value }), error => error.code === "INVALID_HISTORY_QUERY");
    });
  }
}

test("reversed block range is rejected rather than silently swapped", () => {
  assert.throws(() => queryPortfolioHistory(sample(), { minimumBlock: "20", maximumBlock: "10" }));
});

for (const query of [null, [], "query", 1, new Date(), Object.assign(Object.create({}), { order: "oldest" })]) {
  test("query must be a plain data object " + String(query), () => {
    assert.throws(() => validateHistoryQuery(query));
  });
}

for (const name of ["privateKey", "regex", "limit", "__proto__", "constructor"]) {
  test("unknown query field rejected " + name, () => {
    const query = Object.create(null);
    query[name] = "x";
    assert.throws(() => validateHistoryQuery(query));
  });
}

test("query accessors are not evaluated", () => {
  let calls = 0;
  const query = {};
  Object.defineProperty(query, "account", { enumerable: true, get() { calls++; return ACCOUNT; } });
  assert.throws(() => validateHistoryQuery(query));
  assert.equal(calls, 0);
});

test("symbol query fields are forbidden", () => {
  assert.throws(() => validateHistoryQuery({ [Symbol("field")]: true }));
});

test("null-prototype data is accepted and copied", () => {
  const query = Object.create(null);
  query.order = "newest";
  const result = validateHistoryQuery(query);
  query.order = "other";
  assert.equal(result.order, "newest");
  assert.ok(Object.isFrozen(result));
});

test("source ordering is unchanged by a sorted query", () => {
  const text = archive([observation("20"), observation("2"), observation("10")]);
  const before = JSON.parse(text);
  queryPortfolioHistory(text);
  assert.deepEqual(JSON.parse(text), before);
});

test("equal heights retain deterministic insertion ordering", () => {
  const text = archive([observation("10"), observation("10", { account: OTHER })]);
  assert.deepEqual(queryPortfolioHistory(text).rows.map(row => row.index), [0, 1]);
  assert.deepEqual(queryPortfolioHistory(text, { order: "newest" }).rows.map(row => row.index), [1, 0]);
});

test("all returned observations and row containers are immutable", () => {
  const result = queryPortfolioHistory(sample());
  assert.ok(Object.isFrozen(result.rows));
  assert.ok(Object.isFrozen(result.rows[0]));
  assert.ok(Object.isFrozen(result.rows[0].snapshot));
  assert.throws(() => { result.rows[0].index = 999; });
});

test("filtered export has a normal importable history schema", () => {
  const result = exportFilteredHistory(sample(), { maximumBlock: "10" });
  const restored = createPortfolioHistory();
  restored.importText(result.text);
  assert.equal(restored.state().size, 2);
  assert.equal(result.exportedCount, 2);
  assert.equal(result.totalCount, 5);
  assert.equal(result.excludesOtherRecords, true);
});

test("full export does not claim excluded records", () => {
  const result = exportFilteredHistory(sample(), {});
  assert.equal(result.exportedCount, 5);
  assert.equal(result.excludesOtherRecords, false);
});

test("no-match filtered export is a valid empty archive", () => {
  const result = exportFilteredHistory(sample(), { account: OTHER, chainId: 8453 });
  const restored = createPortfolioHistory();
  restored.importText(result.text);
  assert.equal(restored.state().size, 0);
  assert.equal(result.excludesOtherRecords, true);
});

test("subset preserves exact balances and block hashes", () => {
  const text = archive([observation("1", { nativeBalanceBaseUnits: MAX })]);
  const result = exportFilteredHistory(text, { minimumBlock: "1", maximumBlock: "1" });
  const restored = createPortfolioHistory();
  restored.importText(result.text);
  assert.equal(restored.state().snapshots[0].nativeBalanceBaseUnits, MAX);
  assert.equal(restored.state().snapshots[0].blockHash, "0x" + "ab".repeat(32));
});

for (const text of ["null", "{", "[]", "{}", "<html>"]) {
  test("invalid archive cannot be queried or exported " + text, () => {
    assert.throws(() => queryPortfolioHistory(text));
    assert.throws(() => exportFilteredHistory(text, {}));
  });
}

test("query never consults a wallet provider", () => {
  const previous = globalThis.ethereum;
  let calls = 0;
  globalThis.ethereum = { request() { calls++; } };
  try {
    queryPortfolioHistory(sample(), { minimumBlock: "10" });
    exportFilteredHistory(sample(), { chainId: 8453 });
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete globalThis.ethereum;
    else globalThis.ethereum = previous;
  }
});
