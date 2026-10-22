import test from "node:test";
import assert from "node:assert/strict";
import { reviewPortfolioHistory, reviewHistoryImport } from "../src/history-review.js";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { createHistoryImportController } from "../src/history-import-controller.js";
import { decodeHistoryFileBytes, prepareHistoryDownload } from "../src/history-file.js";
import { observation, archive, bytes, ACCOUNT, OTHER, MAX } from "./helpers/history-fixtures.js";

function contract(index) {
  return "0x" + BigInt(index + 1).toString(16).padStart(40, "0");
}
function holdings(count, missingIndices = []) {
  return Array.from({ length: count }, (_, index) => missingIndices.includes(index)
    ? { address: contract(index), hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }
    : { address: contract(index), hasCode: true, balanceBaseUnits: (BigInt(MAX) - BigInt(index)).toString(), notice: null });
}

for (const count of [0, 1, 2, 16, 64]) {
  test("review and restored archive agree on observation count " + count, () => {
    const source = archive(Array.from({ length: count }, (_, index) => observation(String(index))));
    const checked = reviewPortfolioHistory(source);
    const prepared = prepareHistoryDownload(source, "DAT", 1);
    const restored = createPortfolioHistory();
    restored.importText(decodeHistoryFileBytes(bytes(prepared.text), "DAT").text);
    assert.equal(checked.observationCount, restored.state().size);
    assert.equal(checked.knownTokenObservations, count);
    assert.equal(checked.unknownTokenObservations, 0);
    assert.equal(checked.groups.length, count === 0 ? 0 : 1);
  });
}

for (const count of [1, 2, 16, 32]) {
  for (const mode of ["known", "unknown", "alternating"]) {
    test("token coverage arithmetic is exact at contract limit " + count + "/" + mode, () => {
      const absent = Array.from({ length: count }, (_, index) => index)
        .filter(index => mode === "unknown" || (mode === "alternating" && index % 2 === 0));
      const rows = holdings(count, absent);
      const result = reviewPortfolioHistory(archive([
        observation("1", { holdings: rows }), observation("2", { holdings: rows }),
      ]));
      assert.equal(result.distinctChainContracts, count);
      assert.equal(result.unknownTokenObservations, absent.length * 2);
      assert.equal(result.knownTokenObservations, (count - absent.length) * 2);
      assert.equal(result.groups[0].missingCodeObservations, absent.length * 2);
      assert.equal(result.groups[0].coverageChanges.length, 0);
      assert.equal(result.warnings.includes("UNKNOWN_TOKEN_BALANCES"), absent.length > 0);
    });
  }
}

test("maximum bounded archive never creates a monetary aggregate", () => {
  const source = archive(Array.from({ length: 64 }, (_, index) => observation(String(index), {
    nativeBalanceBaseUnits: MAX,
    holdings: holdings(32, [0, 31]),
  })));
  const result = reviewPortfolioHistory(source);
  assert.equal(result.observationCount, 64);
  assert.equal(result.knownTokenObservations, 64 * 30);
  assert.equal(result.unknownTokenObservations, 128);
  assert.equal(result.distinctChainContracts, 32);
  assert.equal(result.groups[0].observationGaps.length, 0);
  assert.equal(JSON.stringify(result).includes('"totalBalance"'), false);
});

for (const chainId of [8453, 84532]) {
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    test("identity bookkeeping remains consistent " + agent + "/" + chainId, () => {
      const source = archive([
        observation("1", { chainId, agent, account: ACCOUNT }),
        observation("2", { chainId, agent, account: OTHER }),
      ]);
      const result = reviewPortfolioHistory(source);
      assert.equal(result.identityCount, 2);
      assert.equal(result.distinctChainContracts, 1);
      assert.ok(result.groups.every(group => group.chainId === chainId && group.agent === agent));
    });
  }
}

for (const replace of [false, true]) {
  for (const [beforeBlocks, incomingBlocks] of [
    [[], []],
    [["1"], []],
    [[], ["1"]],
    [["1"], ["1"]],
    [["1", "2"], ["2", "3"]],
    [["1", "2", "3"], ["1", "3"]],
    [["1", "2"], ["4", "5"]],
  ]) {
    test("reported impact matches actual reviewed application " + replace + "/" + beforeBlocks + "/" + incomingBlocks, () => {
      const current = archive(beforeBlocks.map(block => observation(block)));
      const incoming = archive(incomingBlocks.map(block => observation(block)));
      const predicted = reviewHistoryImport(current, incoming, { replace });
      const destination = createPortfolioHistory();
      destination.importText(current);
      const importer = createHistoryImportController(destination);
      const preview = importer.preview(incoming, { replace });
      importer.apply(preview.previewId, incoming);
      const applied = destination.state();
      assert.equal(predicted.resultingCount, applied.size);
      assert.equal(predicted.review.observationCount, applied.size);
      assert.equal(predicted.previousCount, beforeBlocks.length);
      assert.equal(predicted.incomingCount, incomingBlocks.length);
      const expected = replace ? incomingBlocks : [...new Set([...beforeBlocks, ...incomingBlocks])];
      assert.deepEqual(applied.snapshots.map(row => row.blockNumber), expected);
    });
  }
}

test("different holdings sets at a shared height show token replacement impact", () => {
  const current = archive([observation("1", { holdings: holdings(2) })]);
  const offered = archive([observation("1", { holdings: holdings(3) })]);
  const report = reviewHistoryImport(current, offered, { replace: true });
  const token = report.changed[0].tokenChanges[0];
  assert.equal(token.address, contract(2));
  assert.equal(token.previouslyObserved, false);
  assert.equal(token.subsequentlyObserved, true);
  assert.equal(token.previousBalanceBaseUnits, null);
  assert.equal(token.subsequentBalanceBaseUnits, (BigInt(MAX) - 2n).toString());
});

test("changing only code presence cannot be confused with a zero balance", () => {
  const current = archive([observation("1", { holdings: holdings(1) })]);
  const incoming = archive([observation("1", { holdings: holdings(1, [0]) })]);
  const report = reviewHistoryImport(current, incoming, { replace: true });
  const token = report.changed[0].tokenChanges[0];
  assert.equal(token.previousHasCode, true);
  assert.equal(token.subsequentHasCode, false);
  assert.equal(token.subsequentBalanceBaseUnits, null);
  assert.ok(report.review.warnings.includes("UNKNOWN_TOKEN_BALANCES"));
});

test("content report itself is refused by both file restore and history restore", () => {
  const report = JSON.stringify(reviewPortfolioHistory(archive()));
  const destination = createPortfolioHistory();
  assert.throws(() => destination.importText(report));
  assert.throws(() => decodeHistoryFileBytes(bytes(report), "DAT"));
  assert.equal(destination.state().size, 0);
});

test("import impact report cannot be restored as wallet history", () => {
  const report = JSON.stringify(reviewHistoryImport(archive(), archive([observation("43")])));
  assert.throws(() => decodeHistoryFileBytes(bytes(report), "DAT"));
});

test("report references do not include keys, raw provider errors or arbitrary metadata", () => {
  const report = reviewHistoryImport(archive([]), archive());
  const row = report.added[0];
  assert.deepEqual(Object.keys(row).sort(), ["account", "agent", "blockHash", "blockNumber", "chainId", "siteOrigin"].sort());
  assert.equal(Object.hasOwn(row, "privateKey"), false);
  assert.equal(Object.hasOwn(row, "provider"), false);
});

test("known and unknown coverage warnings can coexist with identity separation", () => {
  const result = reviewPortfolioHistory(archive([
    observation("1", { holdings: holdings(2, [0]) }),
    observation("2", { account: OTHER, holdings: holdings(2) }),
  ]));
  assert.ok(result.warnings.includes("UNKNOWN_TOKEN_BALANCES"));
  assert.ok(result.warnings.includes("SEPARATE_IDENTITIES"));
  assert.equal(result.warnings.includes("SAMPLED_BLOCKS"), false);
});

test("zero-height observations do not disappear from report ranges", () => {
  const result = reviewPortfolioHistory(archive([observation("0"), observation("1")]));
  assert.equal(result.groups[0].earliestBlockNumber, "0");
  assert.equal(result.groups[0].latestBlockNumber, "1");
  assert.equal(result.groups[0].observationCount, 2);
});

test("large reference heights remain decimal strings in report JSON", () => {
  const report = reviewHistoryImport(archive([]), archive([observation(MAX)]));
  const decoded = JSON.parse(JSON.stringify(report));
  assert.equal(typeof decoded.added[0].blockNumber, "string");
  assert.equal(decoded.added[0].blockNumber, MAX);
});
