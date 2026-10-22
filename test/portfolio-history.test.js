import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioHistory, PortfolioHistoryError, HISTORY_SCHEMA, HISTORY_TEXT_LIMIT } from "../src/portfolio-history.js";
import { createHistoryImportController } from "../src/history-import-controller.js";
import { encodePortfolioReport } from "../src/portfolio-report.js";

const ACCOUNT = "0x" + "11".repeat(20);
const OTHER = "0x" + "22".repeat(20);
const TOKEN = "0x" + "33".repeat(20);
const SECOND = "0x" + "44".repeat(20);
const HASH = "0x" + "ab".repeat(32);
const MAX = ((1n << 256n) - 1n).toString();

function snapshot(blockNumber = "42", changes = {}) {
  return {
    agent: "DAT",
    account: ACCOUNT,
    chainId: 84532,
    siteOrigin: "http://localhost:4184",
    connectionEpoch: 1,
    blockNumber,
    blockHash: HASH,
    nativeBalanceBaseUnits: "16",
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: "42", notice: null }],
    readOnly: true,
    securityAudit: false,
    ...changes,
  };
}

function document(rows) {
  return JSON.stringify({
    schema: HISTORY_SCHEMA,
    historicalObservation: true,
    reports: rows.map(row => JSON.parse(encodePortfolioReport(row))),
  });
}

function code(action, expected) {
  assert.throws(action, error => error instanceof PortfolioHistoryError && error.code === expected);
}

function unchanged(history, action) {
  const before = history.exportText();
  const revision = history.state().revision;
  assert.throws(action);
  assert.equal(history.exportText(), before);
  assert.equal(history.state().revision, revision);
}

test("empty collection has no authorization capabilities", () => {
  const history = createPortfolioHistory();
  const state = history.state();
  assert.equal(state.size, 0);
  assert.equal(state.revision, 0);
  assert.equal(state.capacity, 64);
  assert.equal(state.canAuthorizeConnection, false);
  assert.equal(state.canAuthorizeTransaction, false);
  assert.equal(state.securityAudit, false);
  assert.equal(state.historicalObservation, true);
  assert.deepEqual(history.groups(), []);
});

for (const capacity of [0, -1, 65, 1.5, NaN, Infinity, "3", null]) {
  test("reject invalid capacity " + String(capacity), () => {
    code(() => createPortfolioHistory({ capacity }), "INVALID_CAPACITY");
  });
}

for (const capacity of [1, 2, 16, 64]) {
  test("explicit capacity is enforced without eviction: " + capacity, () => {
    const history = createPortfolioHistory({ capacity });
    for (let n = 0; n < capacity; n++) history.add(snapshot(String(n)));
    assert.equal(history.state().size, capacity);
    unchanged(history, () => history.add(snapshot(String(capacity))));
    assert.equal(history.state().snapshots[0].blockNumber, "0");
  });
}

test("adding copies and freezes caller data", () => {
  const input = snapshot();
  const history = createPortfolioHistory();
  history.add(input);
  input.nativeBalanceBaseUnits = "999";
  input.holdings[0].balanceBaseUnits = "888";
  const state = history.state();
  assert.equal(state.snapshots[0].nativeBalanceBaseUnits, "16");
  assert.equal(state.snapshots[0].holdings[0].balanceBaseUnits, "42");
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.snapshots));
  assert.ok(Object.isFrozen(state.snapshots[0]));
  assert.ok(Object.isFrozen(state.snapshots[0].holdings[0]));
});

test("previous state remains a stable observation after further additions", () => {
  const history = createPortfolioHistory();
  history.add(snapshot());
  const old = history.state();
  history.add(snapshot("43"));
  assert.equal(old.size, 1);
  assert.equal(old.snapshots.length, 1);
  assert.equal(history.state().size, 2);
});

test("duplicate observation is a no-op despite a changed connection epoch", () => {
  const history = createPortfolioHistory();
  history.add(snapshot());
  const result = history.add(snapshot("42", { connectionEpoch: 900 }));
  assert.equal(result.duplicates, 1);
  assert.equal(result.added, 0);
  assert.equal(result.changed, false);
  assert.equal(history.state().revision, 1);
});

test("holding order does not manufacture a different observation", () => {
  const history = createPortfolioHistory();
  const first = snapshot();
  first.holdings.push({ address: SECOND, hasCode: true, balanceBaseUnits: "99", notice: null });
  history.add(first);
  const second = structuredClone(first);
  second.holdings.reverse();
  const result = history.add(second);
  assert.equal(result.duplicates, 1);
  assert.equal(history.state().size, 1);
});

for (const [name, changes] of [
  ["block hash", { blockHash: "0x" + "cd".repeat(32) }],
  ["native balance", { nativeBalanceBaseUnits: "17" }],
  ["token balance", { holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: "43", notice: null }] }],
  ["missing code", { holdings: [{ address: TOKEN, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }] }],
  ["token set", { holdings: [{ address: SECOND, hasCode: true, balanceBaseUnits: "42", notice: null }] }],
]) {
  test("conflicting same-height " + name + " never overwrites history", () => {
    const history = createPortfolioHistory();
    history.add(snapshot());
    code(() => history.add(snapshot("42", changes)), "OBSERVATION_CONFLICT");
    assert.equal(history.state().revision, 1);
    assert.equal(history.state().snapshots[0].nativeBalanceBaseUnits, "16");
  });
}

for (const changes of [
  { agent: "EMA" },
  { agent: "CAWELON" },
  { account: OTHER },
  { chainId: 8453 },
  { siteOrigin: "http://localhost:4185" },
]) {
  test("same height may exist under another identity " + JSON.stringify(changes), () => {
    const history = createPortfolioHistory();
    history.add(snapshot());
    history.add(snapshot("42", changes));
    assert.equal(history.state().size, 2);
    assert.equal(history.groups().length, 2);
    assert.throws(() => history.compare(0, 1, 2));
  });
}

test("failed batch is atomic after a valid prefix", () => {
  const history = createPortfolioHistory();
  history.add(snapshot());
  unchanged(history, () => history.merge([snapshot("43"), snapshot("44", { readOnly: false })]));
});

test("capacity failure in a batch preserves the prior collection", () => {
  const history = createPortfolioHistory({ capacity: 2 });
  history.add(snapshot());
  unchanged(history, () => history.merge([snapshot("43"), snapshot("44")]));
});

test("conflict against a preceding batch entry rejects the entire batch", () => {
  const history = createPortfolioHistory();
  unchanged(history, () => history.merge([snapshot(), snapshot("42", { nativeBalanceBaseUnits: "0" })]));
});

test("batch duplicate accounting and revision represent one commit", () => {
  const history = createPortfolioHistory();
  const result = history.merge([snapshot(), snapshot(), snapshot("43")]);
  assert.equal(result.added, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.state.revision, 1);
});

for (const make of [
  () => new Array(2),
  () => Object.assign([snapshot()], { extra: true }),
  () => Object.assign([snapshot()], { [Symbol("hidden")]: true }),
  () => ({ 0: snapshot(), length: 1 }),
  () => null,
  () => Array.from({ length: 65 }, (_, n) => snapshot(String(n))),
]) {
  test("malformed or oversized batch is rejected " + make.toString(), () => {
    const history = createPortfolioHistory();
    unchanged(history, () => history.merge(make()));
  });
}

test("array getter is not invoked during validation", () => {
  let called = 0;
  const rows = [];
  Object.defineProperty(rows, "0", { get() { called++; return snapshot(); }, enumerable: true });
  const history = createPortfolioHistory();
  unchanged(history, () => history.merge(rows));
  assert.equal(called, 0);
});

test("snapshot accessor cannot execute while adding a history record", () => {
  let called = 0;
  const input = snapshot();
  Object.defineProperty(input, "account", { get() { called++; return ACCOUNT; } });
  const history = createPortfolioHistory();
  unchanged(history, () => history.add(input));
  assert.equal(called, 0);
});

test("report and archive round trip retain exact large balances", () => {
  const history = createPortfolioHistory();
  history.addReport(encodePortfolioReport(snapshot("42", { nativeBalanceBaseUnits: MAX })));
  const restored = createPortfolioHistory();
  restored.importText(history.exportText());
  assert.equal(restored.state().snapshots[0].nativeBalanceBaseUnits, MAX);
  assert.equal(restored.exportText(), history.exportText());
});

test("repeated archive imports do not accumulate duplicates", () => {
  const history = createPortfolioHistory();
  const text = document([snapshot(), snapshot("43")]);
  history.importText(text);
  const result = history.importText(text);
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 2);
  assert.equal(result.changed, false);
  assert.equal(history.state().revision, 1);
});

test("empty archive may merge without clearing or explicitly replace", () => {
  const history = createPortfolioHistory();
  history.add(snapshot());
  history.importText(document([]));
  assert.equal(history.state().size, 1);
  history.importText(document([]), { replace: true });
  assert.equal(history.state().size, 0);
  assert.equal(history.state().revision, 2);
});

for (const text of ["", "{", "null", "[]", "1", '"text"', " ", "x".repeat(HISTORY_TEXT_LIMIT + 1)]) {
  test("invalid archive text is rejected with prior records intact: " + text.slice(0, 15), () => {
    const history = createPortfolioHistory();
    history.add(snapshot());
    unchanged(history, () => history.importText(text, { replace: true }));
  });
}

for (const mutate of [
  value => { value.schema = "other"; },
  value => { value.historicalObservation = false; },
  value => { value.extra = "ignored?"; },
  value => { delete value.reports; },
  value => { value.reports = null; },
  value => { value.reports[0].snapshot.securityAudit = true; },
  value => { value.reports[0].snapshot.privateKey = "never accepted"; },
]) {
  test("archive schema validation is transactional " + mutate.toString(), () => {
    const history = createPortfolioHistory();
    history.add(snapshot("10"));
    const value = JSON.parse(document([snapshot()]));
    mutate(value);
    unchanged(history, () => history.importText(JSON.stringify(value), { replace: true }));
  });
}

for (const replace of [0, 1, "true", null, {}, []]) {
  test("replacement requires a boolean " + JSON.stringify(replace), () => {
    const history = createPortfolioHistory();
    code(() => history.importText(document([]), { replace }), "INVALID_HISTORY");
  });
}

test("group ordering uses BigInt rather than lexical or floating ordering", () => {
  const history = createPortfolioHistory();
  history.merge([snapshot(MAX), snapshot("10"), snapshot("2"), snapshot("9007199254740993")]);
  const group = history.groups()[0];
  assert.deepEqual(group.indices, [2, 1, 3, 0]);
  assert.equal(group.earliestBlockNumber, "2");
  assert.equal(group.latestBlockNumber, MAX);
  assert.equal(history.state().snapshots[0].blockNumber, MAX);
  assert.ok(Object.isFrozen(group.indices));
});

test("history comparison retains exact signed differences", () => {
  const history = createPortfolioHistory();
  history.merge([snapshot("1", { nativeBalanceBaseUnits: MAX }), snapshot("2", { nativeBalanceBaseUnits: "0" })]);
  const result = history.compare(0, 1, 1);
  assert.equal(result.native.deltaBaseUnits, "-" + MAX);
  assert.equal(result.canAuthorizeTransaction, false);
  assert.equal(result.provesProfit, false);
});

for (const index of [-1, 2, 0.5, NaN, "0", null]) {
  test("invalid selection cannot remove or compare " + String(index), () => {
    const history = createPortfolioHistory();
    history.add(snapshot());
    code(() => history.remove(index, 1), "INVALID_SELECTION");
    code(() => history.compare(index, 0, 1), "INVALID_SELECTION");
    assert.equal(history.state().size, 1);
  });
}

test("stale deletion cannot target a shifted index", () => {
  const history = createPortfolioHistory();
  history.merge([snapshot(), snapshot("43")]);
  history.remove(0, 1);
  code(() => history.remove(0, 1), "STALE_HISTORY");
  assert.equal(history.state().snapshots[0].blockNumber, "43");
});

test("clear and comparison require current revision", () => {
  const history = createPortfolioHistory();
  history.add(snapshot());
  code(() => history.clear(0), "STALE_HISTORY");
  code(() => history.compare(0, 0, 0), "STALE_HISTORY");
  history.clear(1);
  assert.equal(history.state().revision, 2);
  history.clear(2);
  assert.equal(history.state().revision, 2);
});

test("preview leaves destination unchanged and apply commits once", () => {
  const history = createPortfolioHistory();
  const controller = createHistoryImportController(history);
  const text = document([snapshot()]);
  const preview = controller.preview(text);
  assert.equal(preview.resultingSize, 1);
  assert.equal(preview.previousSize, 0);
  assert.equal(history.state().size, 0);
  assert.equal(controller.state().pending, true);
  controller.apply(preview.previewId, text);
  assert.equal(history.state().size, 1);
  assert.equal(controller.state().pending, false);
  code(() => controller.apply(preview.previewId, text), "MISSING_PREVIEW");
});

test("changed preview text cannot be applied and consumes the review", () => {
  const history = createPortfolioHistory();
  const controller = createHistoryImportController(history);
  const text = document([snapshot()]);
  const preview = controller.preview(text);
  code(() => controller.apply(preview.previewId, text + " "), "CHANGED_IMPORT");
  assert.equal(history.state().size, 0);
  code(() => controller.apply(preview.previewId, text), "MISSING_PREVIEW");
});

test("a new record after preview invalidates apply", () => {
  const history = createPortfolioHistory();
  const controller = createHistoryImportController(history);
  const text = document([snapshot()]);
  const preview = controller.preview(text);
  history.add(snapshot("99"));
  code(() => controller.apply(preview.previewId, text), "STALE_HISTORY");
  assert.equal(history.state().snapshots[0].blockNumber, "99");
});

test("a newer preview invalidates older preview identifiers", () => {
  const history = createPortfolioHistory();
  const controller = createHistoryImportController(history);
  const text = document([snapshot()]);
  const old = controller.preview(text);
  controller.preview(text);
  code(() => controller.apply(old.previewId, text), "MISSING_PREVIEW");
  assert.equal(history.state().size, 0);
});

test("failed new preview removes an older valid proposal", () => {
  const history = createPortfolioHistory();
  const controller = createHistoryImportController(history);
  const text = document([snapshot()]);
  const preview = controller.preview(text);
  assert.throws(() => controller.preview("broken"));
  assert.equal(controller.state().pending, false);
  code(() => controller.apply(preview.previewId, text), "MISSING_PREVIEW");
});

test("replacement preview lists resulting size without discarding records", () => {
  const history = createPortfolioHistory();
  history.merge([snapshot("1"), snapshot("2")]);
  const controller = createHistoryImportController(history);
  const text = document([snapshot("3")]);
  const preview = controller.preview(text, { replace: true });
  assert.equal(preview.mode, "replace");
  assert.equal(preview.previousSize, 2);
  assert.equal(preview.resultingSize, 1);
  assert.equal(history.state().size, 2);
  controller.apply(preview.previewId, text);
  assert.equal(history.state().size, 1);
  assert.equal(history.state().snapshots[0].blockNumber, "3");
});

test("cancel is idempotent and retains original records", () => {
  const history = createPortfolioHistory();
  const controller = createHistoryImportController(history);
  controller.preview(document([snapshot()]));
  assert.equal(controller.cancel(), true);
  assert.equal(controller.cancel(), false);
  assert.equal(history.state().size, 0);
});

test("comparison rejects reversed historical order", () => {
  const history = createPortfolioHistory();
  history.merge([snapshot("10"), snapshot("9")]);
  assert.throws(() => history.compare(0, 1, 1), error => error.code === "REVERSED_BLOCKS");
});

test("unknown balances remain unknown through history export and comparison", () => {
  const history = createPortfolioHistory();
  const missing = [{ address: TOKEN, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }];
  history.merge([snapshot("1", { holdings: missing }), snapshot("2")]);
  const restored = createPortfolioHistory();
  restored.importText(history.exportText());
  const result = restored.compare(0, 1, 1);
  assert.equal(result.holdings[0].deltaBaseUnits, null);
  assert.equal(result.holdings[0].direction, "unknown");
});

for (const replace of [1, "true", null]) {
  test("direct batch replacement also requires boolean " + String(replace), () => {
    const history = createPortfolioHistory();
    history.add(snapshot());
    code(() => history.merge([], replace), "INVALID_HISTORY");
    assert.equal(history.state().size, 1);
  });
}

test("preview capacity failure preserves both records and destination revision", () => {
  const history = createPortfolioHistory({ capacity: 1 });
  history.add(snapshot());
  const controller = createHistoryImportController(history);
  unchanged(history, () => controller.preview(document([snapshot("43")])));
  assert.equal(controller.state().pending, false);
});

test("duplicate additions after preview do not invalidate an unchanged collection", () => {
  const history = createPortfolioHistory();
  history.add(snapshot());
  const controller = createHistoryImportController(history);
  const text = document([snapshot("43")]);
  const preview = controller.preview(text);
  history.add(snapshot());
  controller.apply(preview.previewId, text);
  assert.equal(history.state().size, 2);
});

test("grouped timelines retain different token coverage at different heights", () => {
  const history = createPortfolioHistory();
  const holdings = [{ address: SECOND, hasCode: true, balanceBaseUnits: "7", notice: null }];
  history.merge([snapshot("1"), snapshot("2", { holdings })]);
  const comparison = history.compare(0, 1, 1);
  assert.equal(comparison.holdings.length, 2);
  assert.equal(comparison.holdings[0].availability, "not_observed_after");
  assert.equal(comparison.holdings[1].availability, "not_observed_before");
  assert.ok(comparison.holdings.every(row => row.deltaBaseUnits === null));
});
