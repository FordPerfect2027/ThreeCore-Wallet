import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { createHistoryImportController } from "../src/history-import-controller.js";
import { prepareHistoryDownload, decodeHistoryFileBytes } from "../src/history-file.js";
import { createHistoryFileReader } from "../src/history-file-reader.js";
import { exportFilteredHistory } from "../src/history-query.js";
import { observation, archive, bytes, file, deferred, ACCOUNT, OTHER, MAX } from "./helpers/history-fixtures.js";

/** End-to-end data workflow with injected file IO and no network or wallet. */
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test("download bytes can be reviewed and restored for " + agent, async () => {
    const source = createPortfolioHistory();
    source.merge([observation("1", { agent }), observation("2", { agent, nativeBalanceBaseUnits: MAX })]);
    const prepared = prepareHistoryDownload(source.exportText(), agent, source.state().revision);
    const reader = createHistoryFileReader({ agent, readBytes: async () => bytes(prepared.text) });
    const candidate = await reader.load(file(prepared.text, { name: prepared.filename }));
    const destination = createPortfolioHistory();
    const controller = createHistoryImportController(destination);
    const review = controller.preview(candidate.result.text);
    assert.equal(destination.state().size, 0);
    assert.equal(review.resultingSize, 2);
    controller.apply(review.previewId, candidate.result.text);
    assert.equal(destination.exportText(), source.exportText());
    assert.equal(destination.compare(0, 1, 1).native.deltaBaseUnits, (BigInt(MAX) - 16n).toString());
    assert.equal(candidate.result.canAuthorizeTransaction, false);
  });
}

test("reviewed archive cannot be replayed after newer record arrival", async () => {
  const sourceText = archive([observation("1")]);
  const candidate = decodeHistoryFileBytes(bytes(sourceText), "DAT");
  const destination = createPortfolioHistory();
  const importer = createHistoryImportController(destination);
  const review = importer.preview(candidate.text, { replace: true });
  destination.add(observation("99"));
  assert.throws(() => importer.apply(review.previewId, candidate.text), error => error.code === "STALE_HISTORY");
  assert.equal(destination.state().snapshots[0].blockNumber, "99");
});

test("edited text after file read requires a new review", () => {
  const candidate = decodeHistoryFileBytes(bytes(), "DAT");
  const destination = createPortfolioHistory();
  const importer = createHistoryImportController(destination);
  const review = importer.preview(candidate.text);
  const changed = archive([observation("43")]);
  assert.throws(() => importer.apply(review.previewId, changed), error => error.code === "CHANGED_IMPORT");
  assert.equal(destination.state().size, 0);
});

test("conflicting file cannot partially merge into a destination", () => {
  const destination = createPortfolioHistory();
  destination.add(observation("42"));
  const before = destination.exportText();
  const candidateText = archive([observation("43"), observation("42", { nativeBalanceBaseUnits: "17" })]);
  const importer = createHistoryImportController(destination);
  assert.throws(() => importer.preview(candidateText), error => error.code === "OBSERVATION_CONFLICT");
  assert.equal(destination.exportText(), before);
});

test("capacity conflict during file preview never evicts destination records", () => {
  const destination = createPortfolioHistory({ capacity: 1 });
  destination.add(observation("42"));
  const candidate = decodeHistoryFileBytes(bytes(archive([observation("43")])), "DAT");
  const importer = createHistoryImportController(destination);
  assert.throws(() => importer.preview(candidate.text), error => error.code === "HISTORY_CAPACITY");
  assert.equal(destination.state().snapshots[0].blockNumber, "42");
});

test("explicit replacement may fit even if merge would exceed capacity", () => {
  const destination = createPortfolioHistory({ capacity: 1 });
  destination.add(observation("42"));
  const candidate = decodeHistoryFileBytes(bytes(archive([observation("43")])), "DAT");
  const importer = createHistoryImportController(destination);
  const review = importer.preview(candidate.text, { replace: true });
  assert.equal(destination.state().snapshots[0].blockNumber, "42");
  importer.apply(review.previewId, candidate.text);
  assert.equal(destination.state().snapshots[0].blockNumber, "43");
});

test("filtered archive is independently restorable without excluded accounts", () => {
  const source = createPortfolioHistory();
  source.merge([observation("1"), observation("2", { account: OTHER })]);
  const subset = exportFilteredHistory(source.exportText(), { account: ACCOUNT });
  const prepared = prepareHistoryDownload(subset.text, "DAT", source.state().revision);
  const destination = createPortfolioHistory();
  destination.importText(decodeHistoryFileBytes(bytes(prepared.text), "DAT").text);
  assert.equal(destination.state().size, 1);
  assert.equal(destination.state().snapshots[0].account, ACCOUNT);
  assert.equal(source.state().size, 2);
});

test("two archives from different origins remain separate comparison groups", () => {
  const destination = createPortfolioHistory();
  destination.importText(archive([observation("1")]));
  destination.importText(archive([observation("2", { siteOrigin: "http://localhost:4185" })]));
  assert.equal(destination.groups().length, 2);
  assert.throws(() => destination.compare(0, 1, destination.state().revision), error => error.code === "IDENTITY_MISMATCH");
});

test("invalid late file cannot overwrite a previously read candidate", async () => {
  const old = deferred();
  const latest = archive([observation("100")]);
  const reader = createHistoryFileReader({ agent: "DAT", readBytes: selected =>
    selected.name === "old.json" ? old.promise : Promise.resolve(bytes(latest)) });
  const first = reader.load(file(archive(), { name: "old.json" }));
  await reader.load(file(latest));
  old.resolve(bytes("not valid"));
  await first;
  assert.equal(reader.state().phase, "ready");
  assert.equal(JSON.parse(reader.state().result.text).reports[0].snapshot.blockNumber, "100");
});

for (const count of [0, 1, 2, 16, 32, 64]) {
  test("bounded archive round trip covers " + count + " observations", () => {
    const source = createPortfolioHistory();
    source.merge(Array.from({ length: count }, (_, index) => observation(String(index), {
      nativeBalanceBaseUnits: (BigInt(MAX) - BigInt(index)).toString(),
    })));
    const prepared = prepareHistoryDownload(source.exportText(), "DAT", source.state().revision);
    const restored = createPortfolioHistory();
    restored.importText(decodeHistoryFileBytes(bytes(prepared.text), "DAT").text);
    assert.equal(restored.state().size, count);
    assert.equal(restored.exportText(), source.exportText());
    assert.equal(prepared.observationCount, count);
  });
}

for (const [minimumBlock, maximumBlock] of [
  ["0", "0"],
  ["0", "63"],
  ["10", "20"],
  ["63", "63"],
  ["64", MAX],
]) {
  test("filtered file round trip has exact inclusive range " + minimumBlock + ".." + maximumBlock, () => {
    const source = createPortfolioHistory();
    source.merge(Array.from({ length: 64 }, (_, index) => observation(String(index))));
    const subset = exportFilteredHistory(source.exportText(), { minimumBlock, maximumBlock });
    const prepared = prepareHistoryDownload(subset.text, "DAT", 1);
    const restored = createPortfolioHistory();
    restored.importText(decodeHistoryFileBytes(bytes(prepared.text), "DAT").text);
    for (const row of restored.state().snapshots) {
      assert.ok(BigInt(row.blockNumber) >= BigInt(minimumBlock));
      assert.ok(BigInt(row.blockNumber) <= BigInt(maximumBlock));
    }
    const expected = Array.from({ length: 64 }, (_, index) => BigInt(index))
      .filter(block => block >= BigInt(minimumBlock) && block <= BigInt(maximumBlock)).length;
    assert.equal(restored.state().size, expected);
  });
}

for (const mutate of [
  value => { value.reports[0].snapshot.nativeBalanceBaseUnits = "-1"; },
  value => { value.reports[0].snapshot.nativeBalanceBaseUnits = "01"; },
  value => { value.reports[0].snapshot.blockHash = "0x123"; },
  value => { value.reports[0].snapshot.readOnly = false; },
  value => { value.reports[0].snapshot.securityAudit = true; },
  value => { value.reports[0].snapshot.holdings[0].balanceBaseUnits = MAX + "0"; },
  value => { value.reports[0].snapshot.privateKey = "forbidden"; },
]) {
  test("corrupted downloaded JSON cannot reach apply " + mutate.toString(), async () => {
    const value = JSON.parse(archive());
    mutate(value);
    const text = JSON.stringify(value);
    const reader = createHistoryFileReader({ agent: "DAT", readBytes: async () => bytes(text) });
    const candidate = await reader.load(file(text));
    assert.equal(candidate.phase, "error");
    assert.equal(candidate.result, null);
  });
}
