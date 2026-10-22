import test from "node:test";
import assert from "node:assert/strict";
import { reviewPortfolioHistory, reviewHistoryImport, describeHistoryReview, describeHistoryImport } from "../src/history-review.js";
import { HISTORY_TEXT_LIMIT, createPortfolioHistory } from "../src/portfolio-history.js";
import { createHistoryImportController } from "../src/history-import-controller.js";
import { observation, archive, MAX } from "./helpers/history-fixtures.js";

for (const mutate of [
  document => { document.extra = "ignored?"; },
  document => { document.schema = "threecore-history-review-v1"; },
  document => { document.historicalObservation = false; },
  document => { document.reports = null; },
  document => { document.reports[0].schema = "unknown"; },
  document => { document.reports[0].canAuthorizeConnection = true; },
  document => { document.reports[0].snapshot.agent = "BTC"; },
  document => { document.reports[0].snapshot.account = "0x123"; },
  document => { document.reports[0].snapshot.chainId = "8453"; },
  document => { document.reports[0].snapshot.chainId = 0; },
  document => { document.reports[0].snapshot.blockNumber = "01"; },
  document => { document.reports[0].snapshot.blockHash = "0x"; },
  document => { document.reports[0].snapshot.connectionEpoch = -1; },
  document => { document.reports[0].snapshot.siteOrigin = "javascript:alert(1)"; },
  document => { document.reports[0].snapshot.nativeBalanceBaseUnits = MAX + "0"; },
  document => { document.reports[0].snapshot.holdings = []; },
  document => { document.reports[0].snapshot.holdings[0].hasCode = "true"; },
  document => { document.reports[0].snapshot.holdings[0].notice = "<script>"; },
]) {
  test("untrusted archive shape rejected by both report paths " + mutate.toString(), () => {
    const document = JSON.parse(archive());
    mutate(document);
    const invalid = JSON.stringify(document);
    assert.throws(() => reviewPortfolioHistory(invalid));
    assert.throws(() => describeHistoryReview(invalid));
    assert.throws(() => reviewHistoryImport(archive(), invalid));
    assert.throws(() => describeHistoryImport(archive(), invalid));
  });
}

test("oversized archive is rejected before either review is generated", () => {
  const invalid = " ".repeat(HISTORY_TEXT_LIMIT + 1);
  assert.throws(() => reviewPortfolioHistory(invalid));
  assert.throws(() => reviewHistoryImport(archive(), invalid));
  assert.throws(() => reviewHistoryImport(invalid, archive()));
});

for (const name of ["__proto__", "constructor", "prototype"]) {
  test("prototype-like report fields are never copied into a review " + name, () => {
    const document = JSON.parse(archive());
    Object.defineProperty(document.reports[0].snapshot, name, { value: { polluted: true }, enumerable: true });
    assert.throws(() => reviewPortfolioHistory(JSON.stringify(document)));
    assert.equal({}.polluted, undefined);
  });
}

test("repeated review does not consume an import controller's pending approval", () => {
  const history = createPortfolioHistory();
  history.add(observation("1"));
  const text = archive([observation("2")]);
  const importer = createHistoryImportController(history);
  const preview = importer.preview(text);
  const before = history.state();
  reviewPortfolioHistory(history.exportText());
  reviewHistoryImport(history.exportText(), text);
  assert.equal(history.state().revision, before.revision);
  importer.apply(preview.previewId, text);
  assert.equal(history.state().size, 2);
});

test("failed review does not destroy the destination's records", () => {
  const history = createPortfolioHistory();
  history.add(observation("1"));
  const before = history.exportText();
  assert.throws(() => reviewHistoryImport(before, "broken"));
  assert.equal(history.exportText(), before);
  assert.equal(history.state().revision, 1);
});

test("report calculations do not silently trim duplicates from the destination", () => {
  const text = archive([observation("1"), observation("2")]);
  const report = reviewHistoryImport(text, text);
  assert.equal(report.duplicateCount, 2);
  assert.equal(report.resultingCount, 2);
  assert.deepEqual(report.removed, []);
});

test("changing code metadata and native balance reports separate fields", () => {
  const offered = observation("42", {
    nativeBalanceBaseUnits: "0",
    holdings: [{ address: "0x" + "33".repeat(20), hasCode: false,
      balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }],
  });
  const report = reviewHistoryImport(archive(), archive([offered]), { replace: true });
  const changed = report.changed[0];
  assert.deepEqual(changed.changedFields, ["nativeBalanceBaseUnits", "holdings"]);
  assert.equal(changed.previousNativeBalanceBaseUnits, "16");
  assert.equal(changed.subsequentNativeBalanceBaseUnits, "0");
  assert.equal(changed.tokenChanges[0].subsequentBalanceBaseUnits, null);
});

test("same balance under a new block hash is still a replacement change", () => {
  const report = reviewHistoryImport(archive(), archive([observation("42", {
    blockHash: "0x" + "cd".repeat(32),
  })]), { replace: true });
  assert.deepEqual(report.changed[0].changedFields, ["blockHash"]);
  assert.equal(report.changed[0].previousNativeBalanceBaseUnits, report.changed[0].subsequentNativeBalanceBaseUnits);
});

test("single-observation reports never estimate elapsed time or freshness", () => {
  const report = reviewPortfolioHistory(archive());
  assert.equal(Object.hasOwn(report, "ageSeconds"), false);
  assert.equal(Object.hasOwn(report, "fresh"), false);
  assert.equal(Object.hasOwn(report.groups[0], "timestamp"), false);
  assert.equal(report.provesCurrentBalance, false);
});

test("gap count is not a statement about missing transactions", () => {
  const report = reviewPortfolioHistory(archive([observation("1"), observation("100")]));
  const gap = report.groups[0].observationGaps[0];
  assert.equal(gap.unobservedHeightsBetween, "98");
  assert.equal(Object.hasOwn(gap, "missingTransfers"), false);
  assert.equal(report.provesTransfers, false);
});

test("token coverage exclusions never calculate a negative token balance", () => {
  const first = observation("1");
  const last = observation("2", { holdings: [{ address: "0x" + "44".repeat(20), hasCode: true,
    balanceBaseUnits: "0", notice: null }] });
  const report = reviewPortfolioHistory(archive([first, last]));
  const change = report.groups[0].coverageChanges[0];
  assert.equal(change.noLongerObservedContracts.length, 1);
  assert.equal(Object.hasOwn(change, "balanceDelta"), false);
});

test("references with maximal block height can be displayed without exponent notation", () => {
  const text = describeHistoryImport(archive([]), archive([observation(MAX)]));
  assert.ok(text.includes(MAX));
  assert.ok(!text.includes("e+"));
});
