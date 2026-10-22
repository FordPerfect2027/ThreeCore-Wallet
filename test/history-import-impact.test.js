import test from "node:test";
import assert from "node:assert/strict";
import { reviewHistoryImport, describeHistoryImport } from "../src/history-review.js";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { observation, archive, ACCOUNT, OTHER, MAX } from "./helpers/history-fixtures.js";

const otherHash = "0x" + "cd".repeat(32);

test("merge impact lists new observations without altering the source", () => {
  const current = archive([observation("1")]);
  const incoming = archive([observation("2")]);
  const result = reviewHistoryImport(current, incoming);
  assert.equal(result.previousCount, 1);
  assert.equal(result.incomingCount, 1);
  assert.equal(result.resultingCount, 2);
  assert.equal(result.mode, "merge");
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].blockNumber, "2");
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
  assert.equal(JSON.parse(current).reports.length, 1);
  assert.equal(result.destinationChanged, true);
});

test("duplicate merge has no invented additions or changes", () => {
  const result = reviewHistoryImport(archive(), archive());
  assert.equal(result.resultingCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.changed, []);
  assert.equal(result.destinationChanged, false);
});

test("replace impact explicitly lists excluded old observations", () => {
  const result = reviewHistoryImport(
    archive([observation("1"), observation("2")]),
    archive([observation("2"), observation("3")]),
    { replace: true },
  );
  assert.equal(result.mode, "replace");
  assert.equal(result.resultingCount, 2);
  assert.deepEqual(result.added.map(row => row.blockNumber), ["3"]);
  assert.deepEqual(result.removed.map(row => row.blockNumber), ["1"]);
  assert.deepEqual(result.changed, []);
});

test("empty merge changes nothing", () => {
  const result = reviewHistoryImport(archive(), archive([]));
  assert.equal(result.resultingCount, 1);
  assert.equal(result.destinationChanged, false);
  assert.deepEqual(result.removed, []);
});

test("empty replacement exposes complete removal", () => {
  const result = reviewHistoryImport(archive([observation("1"), observation("2")]), archive([]), { replace: true });
  assert.equal(result.resultingCount, 0);
  assert.equal(result.removed.length, 2);
  assert.deepEqual(result.review.warnings, ["EMPTY_HISTORY"]);
});

for (const changes of [
  { blockHash: otherHash },
  { nativeBalanceBaseUnits: "99" },
  { connectionEpoch: 900 },
  { holdings: [{ address: "0x" + "33".repeat(20), hasCode: true, balanceBaseUnits: "77", notice: null }] },
]) {
  test("replacement surfaces modified same-position record " + JSON.stringify(changes), () => {
    const result = reviewHistoryImport(archive(), archive([observation("42", changes)]), { replace: true });
    assert.equal(result.added.length, 0);
    assert.equal(result.removed.length, 0);
    assert.equal(result.changed.length, 1);
    assert.equal(result.changed[0].before.blockNumber, "42");
    assert.equal(result.changed[0].after.blockNumber, "42");
  });
}

for (const changes of [
  { blockHash: otherHash },
  { nativeBalanceBaseUnits: "99" },
  { holdings: [{ address: "0x" + "33".repeat(20), hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }] },
]) {
  test("merge conflicts are refused before returning an impact " + JSON.stringify(changes), () => {
    assert.throws(() => reviewHistoryImport(archive(), archive([observation("42", changes)])),
      error => error.code === "OBSERVATION_CONFLICT");
  });
}

test("connection epoch difference is a duplicate in merge mode", () => {
  const result = reviewHistoryImport(archive(), archive([observation("42", { connectionEpoch: 900 })]));
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.destinationChanged, false);
});

for (const changes of [
  { account: OTHER },
  { chainId: 8453 },
  { siteOrigin: "http://localhost:4185" },
  { agent: "EMA" },
]) {
  test("same height under another identity is an addition " + JSON.stringify(changes), () => {
    const result = reviewHistoryImport(archive(), archive([observation("42", changes)]));
    assert.equal(result.added.length, 1);
    assert.equal(result.changed.length, 0);
    assert.equal(result.review.identityCount, 2);
  });
}

test("capacity overflow cannot silently truncate the resulting history", () => {
  const full = archive(Array.from({ length: 64 }, (_, index) => observation(String(index))));
  assert.throws(() => reviewHistoryImport(full, archive([observation("100")])),
    error => error.code === "HISTORY_CAPACITY");
});

test("replacement with smaller archive avoids merge-capacity limits explicitly", () => {
  const full = archive(Array.from({ length: 64 }, (_, index) => observation(String(index))));
  const result = reviewHistoryImport(full, archive([observation("100")]), { replace: true });
  assert.equal(result.resultingCount, 1);
  assert.equal(result.removed.length, 64);
  assert.equal(result.added.length, 1);
});

for (const replace of [1, 0, "true", null, {}, []]) {
  test("impact replacement requires a boolean " + String(replace), () => {
    assert.throws(() => reviewHistoryImport(archive(), archive(), { replace }), TypeError);
  });
}

for (const malformed of ["", "[]", "{}", "null", "broken"]) {
  test("invalid source or candidate prevents impact computation " + malformed, () => {
    assert.throws(() => reviewHistoryImport(malformed, archive()));
    assert.throws(() => reviewHistoryImport(archive(), malformed));
    assert.throws(() => describeHistoryImport(archive(), malformed));
  });
}

test("impact and all reference objects are immutable", () => {
  const result = reviewHistoryImport(archive([observation("1")]), archive([observation("2")]), { replace: true });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.added));
  assert.ok(Object.isFrozen(result.added[0]));
  assert.ok(Object.isFrozen(result.removed));
  assert.ok(Object.isFrozen(result.removed[0]));
  assert.ok(Object.isFrozen(result.review));
});

test("changed references are frozen and carry before/after block hashes", () => {
  const result = reviewHistoryImport(archive(), archive([observation("42", { blockHash: otherHash })]), { replace: true });
  const row = result.changed[0];
  assert.ok(Object.isFrozen(row));
  assert.ok(Object.isFrozen(row.before));
  assert.ok(Object.isFrozen(row.after));
  assert.notEqual(row.before.blockHash, row.after.blockHash);
});

test("impact contains no authority or security-audit assertion", () => {
  const result = reviewHistoryImport(archive(), archive([observation("43")]));
  assert.equal(result.canAuthorizeConnection, false);
  assert.equal(result.canAuthorizeTransaction, false);
  assert.equal(result.securityAudit, false);
  assert.equal(result.provesOwnership, false);
  assert.equal(result.provesProfit, false);
});

test("rendered impact explains removed and added records before applying", () => {
  const result = describeHistoryImport(archive([observation("1")]), archive([observation("2")]), { replace: true });
  assert.match(result, /まだ適用していません/);
  assert.match(result, /除外予定: DAT/);
  assert.match(result, /追加予定: DAT/);
  assert.match(result, /別のプレビューと適用ボタン/);
});

test("rendered impact labels replacement changes instead of hiding them", () => {
  const result = describeHistoryImport(archive(), archive([observation("42", { nativeBalanceBaseUnits: MAX })]), { replace: true });
  assert.match(result, /同じ位置の変更 1件/);
  assert.match(result, /変更予定: DAT/);
});

test("impact output cannot be mistaken for a restorable history archive", () => {
  const report = reviewHistoryImport(archive(), archive([observation("43")]));
  const history = createPortfolioHistory();
  assert.throws(() => history.importText(JSON.stringify(report)));
});

test("repeated computation is deterministic and does not mutate either archive", () => {
  const first = archive([observation("1")]);
  const last = archive([observation("2")]);
  assert.deepEqual(reviewHistoryImport(first, last), reviewHistoryImport(first, last));
  assert.equal(JSON.parse(first).reports[0].snapshot.blockNumber, "1");
  assert.equal(JSON.parse(last).reports[0].snapshot.blockNumber, "2");
});

test("impact reference labels preserve chain and origin", () => {
  const result = reviewHistoryImport(archive([]), archive());
  const row = result.added[0];
  assert.equal(row.account, ACCOUNT);
  assert.equal(row.chainId, 84532);
  assert.equal(row.siteOrigin, "http://localhost:4184");
});

test("replacement impact names changed fields and exact native values", () => {
  const report = reviewHistoryImport(archive(), archive([observation("42", { nativeBalanceBaseUnits: MAX })]), { replace: true });
  const row = report.changed[0];
  assert.deepEqual(row.changedFields, ["nativeBalanceBaseUnits"]);
  assert.equal(row.previousNativeBalanceBaseUnits, "16");
  assert.equal(row.subsequentNativeBalanceBaseUnits, MAX);
  assert.deepEqual(row.tokenChanges, []);
  assert.ok(Object.isFrozen(row.changedFields));
});

test("reordered holdings are not a semantic replacement change", () => {
  const holdings = [
    { address: "0x" + "33".repeat(20), hasCode: true, balanceBaseUnits: "1", notice: null },
    { address: "0x" + "44".repeat(20), hasCode: true, balanceBaseUnits: "2", notice: null },
  ];
  const report = reviewHistoryImport(
    archive([observation("42", { holdings })]),
    archive([observation("42", { holdings: [...holdings].reverse() })]),
    { replace: true },
  );
  assert.deepEqual(report.changed, []);
});

test("same-position token balance replacement shows values without profit claims", () => {
  const holdings = [{ address: "0x" + "33".repeat(20), hasCode: true, balanceBaseUnits: MAX, notice: null }];
  const report = reviewHistoryImport(archive(), archive([observation("42", { holdings })]), { replace: true });
  const row = report.changed[0];
  assert.deepEqual(row.changedFields, ["holdings"]);
  assert.equal(row.tokenChanges[0].previousBalanceBaseUnits, "42");
  assert.equal(row.tokenChanges[0].subsequentBalanceBaseUnits, MAX);
  assert.equal(report.provesProfit, false);
  assert.ok(Object.isFrozen(row.tokenChanges));
  assert.ok(Object.isFrozen(row.tokenChanges[0]));
});

test("unknown and absent tokens remain distinct in replacement details", () => {
  const holdings = [{ address: "0x" + "44".repeat(20), hasCode: false,
    balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }];
  const report = reviewHistoryImport(archive(), archive([observation("42", { holdings })]), { replace: true });
  const changes = report.changed[0].tokenChanges;
  assert.equal(changes[0].previouslyObserved, true);
  assert.equal(changes[0].subsequentlyObserved, false);
  assert.equal(changes[0].subsequentHasCode, null);
  assert.equal(changes[1].previouslyObserved, false);
  assert.equal(changes[1].subsequentlyObserved, true);
  assert.equal(changes[1].subsequentHasCode, false);
  assert.equal(changes[1].subsequentBalanceBaseUnits, null);
});

test("changed block hash is visible in replacement text", () => {
  const result = describeHistoryImport(archive(), archive([observation("42", { blockHash: otherHash })]), { replace: true });
  assert.match(result, /変更項目: blockHash/);
  assert.ok(result.includes(otherHash));
});
