import { validatePeriodReportInput } from "./period-report-model.js";
import { analyzePeriodReport } from "./period-report-engine.js";
import { compareLibraryDrafts } from "./period-library-model.js";
import { periodDraftKey } from "./period-draft.js";
import { periodContextKey } from "./period-plan.js";
import { transferEventKey } from "./transfer-codec.js";

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

function difference(before, after) {
  return before === null || before === undefined || after === null || after === undefined
    ? null : (BigInt(after) - BigInt(before)).toString();
}

function anchors(entry) {
  const values = new Map();
  function put(number, hash) {
    if (!values.has(number)) values.set(number, new Set());
    values.get(number).add(hash);
  }
  if (!entry) return values;
  for (const value of [entry.draft.earlier, entry.draft.later]) if (value) put(value.blockNumber, value.blockHash);
  for (const row of entry.draft.records) {
    put(row.range.fromBlock, row.fromBlockHash); put(row.range.toBlock, row.toBlockHash);
    for (const event of row.events) put(event.blockNumber, event.blockHash);
  }
  return values;
}

/** Detect a changed observation of the same block, even when acquisition window sizes changed. */
function anchorChanges(before, after) {
  const previous = anchors(before), next = anchors(after), changes = [];
  for (const [number, hashes] of previous) {
    if (!next.has(number)) continue;
    const beforeHashes = [...hashes].sort(), afterHashes = [...next.get(number)].sort();
    if (JSON.stringify(beforeHashes) !== JSON.stringify(afterHashes)) changes.push({ number, beforeHashes, afterHashes });
  }
  return changes.sort((a, b) => BigInt(a.number) < BigInt(b.number) ? -1 : 1);
}

function eventChanges(before, after) {
  const rows = entry => new Map(entry.draft.records.flatMap(row => row.events)
    .map(event => [transferEventKey(event), JSON.stringify(event)]));
  const previous = rows(before), next = rows(after);
  let added = 0, removed = 0, changed = 0, unchanged = 0;
  for (const [key, value] of previous) {
    if (!next.has(key)) removed++;
    else if (next.get(key) === value) unchanged++;
    else changed++;
  }
  for (const key of next.keys()) if (!previous.has(key)) added++;
  return { added, removed, changed, unchanged, before: previous.size, after: next.size,
    denotesSavedEvidenceOnly: true };
}

function endpointChanges(before, after) {
  return ["earlier", "later"].map(part => {
    const left = before.draft[part], right = after.draft[part];
    return { part, kind: !left && !right ? "missing" : !left ? "added" : !right ? "removed" : "present",
      fields: !left || !right ? [] : Object.keys(left).filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key])) };
  });
}

function compareSlot(beforeSlot, afterSlot, beforeResult, afterResult) {
  const before = beforeSlot.entry, after = afterSlot.entry;
  const result = {
    agent: beforeSlot.agent, kind: "unchanged", sameContext: false, samePeriod: false,
    comparableAmounts: false, metadataChanges: [], evidenceChanged: false,
    beforeStatus: beforeResult.status, afterStatus: afterResult.status,
    beforeSteps: beforeResult.progress?.completed ?? null, afterSteps: afterResult.progress?.completed ?? null,
    beforeEvents: beforeResult.arithmetic.totals?.eventCount ?? null,
    afterEvents: afterResult.arithmetic.totals?.eventCount ?? null,
    earlierBalanceChangeBaseUnits: null, laterBalanceChangeBaseUnits: null,
    unexplainedChangeBaseUnits: null, anchorChanges: [],
    eventChanges: null, endpointChanges: [],
    restrictionChange: "unchanged", archiveChange: "unchanged", attention: false,
  };
  if (!before && !after) return result;
  if (!before) return { ...result, kind: "added", evidenceChanged: true };
  if (!after) return { ...result, kind: "removed", evidenceChanged: true, attention: true };
  for (const field of ["id", "label", "createdAt", "updatedAt"]) {
    if (before[field] !== after[field]) result.metadataChanges.push(field);
  }
  if (before.requiresNewPlan !== after.requiresNewPlan) {
    result.restrictionChange = after.requiresNewPlan ? "introduced" : "removed";
  }
  if (before.archived !== after.archived) result.archiveChange = after.archived ? "archived" : "restored";
  result.sameContext = periodContextKey(before.draft.plan.context) === periodContextKey(after.draft.plan.context);
  if (!result.sameContext) return { ...result, kind: "different-context", evidenceChanged: true, attention: true };
  result.samePeriod = before.draft.plan.earlierBlock === after.draft.plan.earlierBlock &&
    before.draft.plan.laterBlock === after.draft.plan.laterBlock;
  if (!result.samePeriod) return { ...result, kind: "different-period", evidenceChanged: true, attention: true };
  result.eventChanges = eventChanges(before, after);
  result.endpointChanges = endpointChanges(before, after);
  result.anchorChanges = anchorChanges(before, after);
  const sameEvidence = periodDraftKey(before.draft) === periodDraftKey(after.draft);
  result.evidenceChanged = !sameEvidence;
  if (sameEvidence) {
    result.kind = result.metadataChanges.length || result.restrictionChange !== "unchanged" || result.archiveChange !== "unchanged"
      ? "metadata-only" : "unchanged";
  } else {
    const comparison = compareLibraryDrafts(before.draft, after.draft);
    result.kind = { extension: "continued", shorter: "regressed", "changed-evidence": "changed-evidence",
      "different-plan": "recollected" }[comparison.kind] ?? "changed-evidence";
  }
  // A hash disagreement means the observations do not describe the same chain history.
  result.comparableAmounts = result.anchorChanges.length === 0 && !before.requiresNewPlan && !after.requiresNewPlan &&
    ![beforeResult.status, afterResult.status].includes("anchor-conflict");
  if (result.comparableAmounts) {
    result.earlierBalanceChangeBaseUnits = difference(beforeResult.arithmetic.earlierBalanceBaseUnits, afterResult.arithmetic.earlierBalanceBaseUnits);
    result.laterBalanceChangeBaseUnits = difference(beforeResult.arithmetic.laterBalanceBaseUnits, afterResult.arithmetic.laterBalanceBaseUnits);
    result.unexplainedChangeBaseUnits = difference(beforeResult.arithmetic.totals?.residualBaseUnits, afterResult.arithmetic.totals?.residualBaseUnits);
  }
  result.attention = ["regressed", "changed-evidence", "recollected"].includes(result.kind) ||
    result.restrictionChange !== "unchanged" || result.anchorChanges.length > 0;
  return result;
}

/** Compare versions of saved evidence; these deltas are never trading profit or live balance movement. */
export function comparePeriodReports(beforeValue, afterValue) {
  const before = validatePeriodReportInput(beforeValue), after = validatePeriodReportInput(afterValue);
  const beforeReport = analyzePeriodReport(before), afterReport = analyzePeriodReport(after);
  const slots = before.slots.map((slot, index) => compareSlot(slot, after.slots[index],
    beforeReport.slots[index], afterReport.slots[index]));
  return freeze({ schema: "threecore.period-report-comparison.v1", beforeTitle: before.title, afterTitle: after.title,
    beforeCreatedAt: before.createdAt, afterCreatedAt: after.createdAt,
    titleChanged: before.title !== after.title, timestampChanged: before.createdAt !== after.createdAt,
    beforeStatus: beforeReport.status, afterStatus: afterReport.status,
    slots, changedTokens: slots.filter(slot => slot.kind !== "unchanged").length,
    needsAttention: slots.some(slot => slot.attention), automaticMerge: false,
    provesProfit: false, liveChainRechecked: false, independentlyVerified: false });
}

export const REPORT_CHANGE_TEXT = Object.freeze({
  unchanged: "同じ記録", added: "新たに追加", removed: "選択から外れます",
  "metadata-only": "名前・保管情報などの変更", "different-context": "アドレスまたはチェーンが異なります",
  "different-period": "対象期間が異なります", continued: "取得工程が進んでいます",
  regressed: "取得工程が少ない控えに戻ります", "changed-evidence": "取得済みの証拠が変わっています",
  recollected: "取得する範囲の区切りが変わっています",
});

export function periodReportComparisonText(comparison) {
  if (!comparison) return "";
  const rows = ["現在表示中の報告との差", comparison.beforeTitle + " → " + comparison.afterTitle,
    "記録の変更: " + comparison.changedTokens + "/3トークン"];
  for (const slot of comparison.slots) {
    rows.push(slot.agent + ": " + (Object.hasOwn(REPORT_CHANGE_TEXT, slot.kind) ? REPORT_CHANGE_TEXT[slot.kind] : "未確認"));
    if (slot.beforeSteps !== null && slot.afterSteps !== null) rows.push("  取得工程: " + slot.beforeSteps + " → " + slot.afterSteps);
    if (slot.restrictionChange === "introduced") rows.push("  再取得が必要な状態になります。");
    if (slot.restrictionChange === "removed") rows.push("  再取得が必要という印が外れています。この比較では妥当性を認証していません。");
    if (slot.archiveChange !== "unchanged") rows.push("  保管状態: " + (slot.archiveChange === "archived" ? "非表示保管へ" : "通常保管へ"));
    if (slot.anchorChanges.length) rows.push("  同じブロックのハッシュ変更: " + slot.anchorChanges.map(row => row.number).join(", "));
    if (slot.eventChanges) rows.push("  保存した履歴: 追加 " + slot.eventChanges.added + " / 除外 " + slot.eventChanges.removed +
      " / 内容変更 " + slot.eventChanges.changed + " / 同一 " + slot.eventChanges.unchanged);
    if (slot.comparableAmounts && slot.laterBalanceChangeBaseUnits !== null) {
      rows.push("  記録間の終了残高差（最小単位）: " + slot.laterBalanceChangeBaseUnits);
    } else if (slot.sameContext || slot.kind === "different-context") rows.push("  数量差は比較しません。");
  }
  rows.push("過去の控え同士の比較です。利益や現在の残高変化ではなく、自動統合も行いません。");
  return rows.join("\n");
}
