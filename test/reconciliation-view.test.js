import test from "node:test";
import assert from "node:assert/strict";
import {
  RECONCILIATION_STATUS, RECONCILIATION_NOTICE, RECONCILIATION_STORAGE_NOTICE,
  reconciliationReason, reconciliationErrorMessage, reconciliationPartText, reconciliationReviewText,
  reconciliationTokenText, reconciliationText, reconciliationCsvCell, reconciliationSummaryCsv, reconciliationEventsCsv,
} from "../src/reconciliation-view.js";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { reviewReconciliationReplacement, emptyReconciliationWorkspace } from "../src/reconciliation-model.js";
import { workspace, scenario, previewWorkspace, UNIT, record, archive, event, ACCOUNT, OTHER } from "./helpers/reconciliation-fixtures.js";

test("Japanese report distinguishes agreement, unexplained difference and missing history", () => {
  const text = reconciliationText(previewWorkspace());
  assert.match(text, /DAT: 保存した記録の計算が一致/);
  assert.match(text, /EMA: 説明できない差額があります/);
  assert.match(text, /CAWELON: 履歴の期間が不足しています/);
  assert.match(text, /説明できない差額: 2 EMA/);
  assert.match(text, /未取得: 37 ～ 39/);
  assert.match(text, /作成者やチェーン上の事実を保証しません/);
  assert.match(text, /前のブロックを含まず/);
});

test("notice separates historical calculation from live funds, profit and safety", () => {
  assert.match(RECONCILIATION_NOTICE, /現在の残高、全履歴、利益、資産の安全性を証明するものではありません/);
  assert.match(RECONCILIATION_STORAGE_NOTICE, /閉じる前/);
  assert.match(RECONCILIATION_STORAGE_NOTICE, /JSON/);
});

test("every calculation status has a distinct Japanese explanation", () => {
  assert.equal(Object.keys(RECONCILIATION_STATUS).length, 6);
  assert.equal(new Set(Object.values(RECONCILIATION_STATUS)).size, 6);
  assert.ok(Object.values(RECONCILIATION_STATUS).every(value => value.length > 5));
});

test("smallest-unit residual remains visible instead of rounding to zero", () => {
  const slot = scenario();
  slot.later.balanceBaseUnits = (107n * UNIT + 1n).toString();
  const text = reconciliationText(workspace([slot]));
  assert.match(text, /説明できない差額: 0\.000000000000000001 DAT/);
});

test("missing and unusable metadata do not produce a labeled zero token amount", () => {
  const slot = scenario();
  slot.earlier.hasCode = false;
  slot.earlier.metadata = null;
  slot.earlier.balanceBaseUnits = null;
  const row = reconcileWorkspace(workspace([slot])).slots[0];
  const text = reconciliationTokenText(row);
  assert.match(text, /条件が合わず比較できません/);
  assert.doesNotMatch(text, /比較前の残高: 0 DAT/);
  assert.match(text, /登録した仕様と合いません/);
});

test("part text exposes exact account, chain, block and acquisition origin", () => {
  const slot = scenario();
  const text = reconciliationPartText("earlier", slot.earlier);
  assert.ok(text.includes(slot.earlier.account));
  assert.match(text, /chain 8453/);
  assert.match(text, /block 30/);
  assert.ok(text.includes(slot.earlier.siteOrigin));
  assert.equal(reconciliationPartText("earlier", null), "未登録");
  assert.match(reconciliationPartText("archive", slot.archive), /1期間 \/ block 30 ～ 42/);
});

test("review names replacement and deletion with before and after contexts", () => {
  const before = workspace();
  const review = reviewReconciliationReplacement(before, emptyReconciliationWorkspace());
  const text = reconciliationReviewText(review);
  assert.match(text, /DAT・比較前: 削除/);
  assert.match(text, /変更後: 未登録/);
  assert.ok(text.includes(ACCOUNT));
  assert.match(reconciliationReviewText(null), /ありません/);
  assert.match(reconciliationReviewText(reviewReconciliationReplacement(before, before)), /同じ内容/);
});

test("all known reasons are human-readable and unknown codes are not echoed", () => {
  for (const code of ["EARLIER_MISSING", "LATER_MISSING", "OBSERVATION_CONTEXT_CONFLICT", "BLOCK_ORDER_CONFLICT",
    "EARLIER_METADATA_UNUSABLE", "LATER_METADATA_UNUSABLE", "SAME_BLOCK_HASH_CONFLICT", "SAME_BLOCK_STATE_CONFLICT",
    "ARCHIVE_CONTEXT_CONFLICT", "ARCHIVE_ANCHOR_CONFLICT", "DIFFERENT_OBSERVATION_ORIGINS", "DIFFERENT_CONNECTION_EPOCHS",
    "ARCHIVE_MISSING", "ENDPOINT_HASH_UNCHECKED", "HISTORY_GAPS", "NEGATIVE_IMPLIED_BALANCE"]) {
    assert.notEqual(reconciliationReason(code), "記録を確認してください。");
  }
  assert.equal(reconciliationReason("<script>"), "記録を確認してください。");
});

test("unexpected errors cannot leak filenames, URLs or attacker markup", () => {
  for (const value of [Error("private/path"), { code: "<img src=evil>" }, { code: "https://private.example/secret" }, null]) {
    const text = reconciliationErrorMessage(value);
    assert.doesNotMatch(text, /private|evil|secret|https/);
  }
  assert.match(reconciliationErrorMessage({ code: "TRANSFER_ARCHIVE_CONTEXT" }), /TRANSFER_ARCHIVE_CONTEXT/);
  assert.match(reconciliationErrorMessage({ code: "RECONCILIATION_CHECKSUM" }), /検査値が一致しません/);
});

test("CSV summary includes missing rows and raw exact amounts", () => {
  const csv = reconciliationSummaryCsv(workspace());
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /"observed_delta_base_units"/);
  assert.match(csv, /"7000000000000000000"/);
  assert.match(csv, /"EMA".*"missing-input"/);
  assert.match(csv, /"false"/);
  assert.doesNotMatch(csv, /NaN|undefined/);
});

test("CSV event report contains all tokens including incomplete comparisons", () => {
  const csv = reconciliationEventsCsv(previewWorkspace());
  assert.equal(csv.trim().split("\r\n").length, 7);
  assert.match(csv, /"DAT"/);
  assert.match(csv, /"EMA"/);
  assert.match(csv, /"CAWELON"/);
  assert.match(csv, /"incomplete-history"/);
  assert.match(csv, /"'-3000000000000000000"/);
});

test("CSV faithfully quotes literal values, delimiters and embedded quotes", () => {
  assert.equal(reconciliationCsvCell('a,"b"'), '"a,""b"""');
  assert.equal(reconciliationCsvCell(null), '""');
  assert.equal(reconciliationCsvCell(false), '"false"');
  assert.equal(reconciliationCsvCell("0x123"), '"0x123"');
  assert.equal(reconciliationCsvCell("1\n2"), '"1\n2"');
});

for (const value of ["=HYPERLINK(\"x\")", "+1", "-1", "@SUM(A1)", "  =1", "\t=1", "\r-1"]) {
  test("CSV neutralizes formula prefix " + JSON.stringify(value), () => {
    assert.ok(reconciliationCsvCell(value).startsWith('"\''));
  });
}

test("negative intermediate balances remain explicit in text and event exports", () => {
  const slot = scenario();
  slot.earlier.balanceBaseUnits = "0";
  slot.later.balanceBaseUnits = "0";
  slot.archive = archive([record(30, 42, [
    event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "1" }, 0),
    event({ from: OTHER, to: ACCOUNT, amountBaseUnits: "1" }, 1),
  ])]);
  assert.match(reconciliationText(workspace([slot])), /途中残高がマイナス/);
  assert.match(reconciliationEventsCsv(workspace([slot])), /"'-1"/);
});
