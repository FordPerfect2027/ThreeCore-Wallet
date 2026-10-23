import { validatePeriodReportInput } from "./period-report-model.js";
import { analyzePeriodReport } from "./period-report-engine.js";
import { periodContextKey } from "./period-plan.js";

const STATUS = Object.freeze({
  continuous: "期間の境界と保存した証拠がつながっています",
  missing: "どちらかにトークンの記録がありません",
  "different-context": "チェーン・トークン・アドレスが異なります",
  "same-period": "同じ期間の報告です",
  reversed: "期間が逆順です",
  overlap: "取得期間が重複しています",
  gap: "取得期間の間に空白があります",
  "boundary-conflict": "境界のブロックハッシュまたは残高が一致しません",
  "incomplete-evidence": "期間は隣接していますが、証拠の確認が完了していません",
});
const ISSUE = Object.freeze({
  MISSING_BOUNDARY: "境界の残高記録がありません。",
  BOUNDARY_HASH: "同じ境界ブロックのハッシュが異なります。",
  BOUNDARY_BALANCE: "同じ境界の保存残高が異なります。",
  UNKNOWN_BALANCE: "境界の残高を比較できません。",
  RESTRICTED: "再取得が必要という印が付いた控えが含まれます。",
  BEFORE_NOT_RECONCILED: "比較元の期間で残高と履歴の照合が完了していません。",
  AFTER_NOT_RECONCILED: "比較先の期間で残高と履歴の照合が完了していません。",
});

/** Compare captured periods without adding token amounts, merging events, or making RPC calls. */
export function inspectReportContinuity(beforeValue, afterValue) {
  const before = validatePeriodReportInput(beforeValue);
  const after = validatePeriodReportInput(afterValue);
  const leftReport = analyzePeriodReport(before);
  const rightReport = analyzePeriodReport(after);
  const slots = before.slots.map(({ agent, entry: left }, index) => {
    const right = after.slots[index].entry;
    const common = { agent, beforeId: left?.id ?? null, afterId: right?.id ?? null,
      beforeStart: left?.draft.plan.earlierBlock ?? null, beforeEnd: left?.draft.plan.laterBlock ?? null,
      afterStart: right?.draft.plan.earlierBlock ?? null, afterEnd: right?.draft.plan.laterBlock ?? null,
      boundaryBlock: null, gapBlocks: null, overlapBlocks: null, issues: Object.freeze([]),
      sameContext: false, adjacent: false, continuousEvidence: false,
      beforeBoundaryBalance: null, afterBoundaryBalance: null, boundaryBalanceDifference: null };
    function finish(status, fields = {}) { return Object.freeze({ ...common, status, ...fields }); }
    if (!left || !right) return finish("missing");
    const a = left.draft.plan, b = right.draft.plan;
    if (periodContextKey(a.context) !== periodContextKey(b.context)) return finish("different-context");
    common.sameContext = true;
    const aStart = BigInt(a.earlierBlock), aEnd = BigInt(a.laterBlock);
    const bStart = BigInt(b.earlierBlock), bEnd = BigInt(b.laterBlock);
    if (aStart === bStart && aEnd === bEnd) return finish("same-period");
    if (bStart < aStart || bEnd <= aStart) return finish("reversed");
    if (bStart < aEnd) {
      const overlapEnd = bEnd < aEnd ? bEnd : aEnd;
      return finish("overlap", { overlapBlocks: (overlapEnd - bStart).toString() });
    }
    if (bStart > aEnd) return finish("gap", { gapBlocks: (bStart - aEnd).toString() });
    const issues = [];
    const leftBoundary = left.draft.later, rightBoundary = right.draft.earlier;
    let delta = null;
    if (!leftBoundary || !rightBoundary) issues.push("MISSING_BOUNDARY");
    else {
      if (leftBoundary.blockHash !== rightBoundary.blockHash) issues.push("BOUNDARY_HASH");
      const aBalance = leftBoundary.balanceBaseUnits, bBalance = rightBoundary.balanceBaseUnits;
      if (aBalance === null || bBalance === null) issues.push("UNKNOWN_BALANCE");
      else {
        delta = (BigInt(bBalance) - BigInt(aBalance)).toString();
        if (delta !== "0") issues.push("BOUNDARY_BALANCE");
      }
    }
    if (left.requiresNewPlan || right.requiresNewPlan) issues.push("RESTRICTED");
    if (leftReport.slots[index].status !== "arithmetic-agreement") issues.push("BEFORE_NOT_RECONCILED");
    if (rightReport.slots[index].status !== "arithmetic-agreement") issues.push("AFTER_NOT_RECONCILED");
    const status = issues.some(value => ["BOUNDARY_HASH", "BOUNDARY_BALANCE"].includes(value)) ? "boundary-conflict" :
      issues.length ? "incomplete-evidence" : "continuous";
    return finish(status, { adjacent: true, boundaryBlock: a.laterBlock, gapBlocks: "0", overlapBlocks: "0",
      issues: Object.freeze(issues), continuousEvidence: status === "continuous",
      beforeBoundaryBalance: leftBoundary?.balanceBaseUnits ?? null,
      afterBoundaryBalance: rightBoundary?.balanceBaseUnits ?? null,
      // A changed block hash cannot support an arithmetic delta across the two observations.
      boundaryBalanceDifference: issues.includes("BOUNDARY_HASH") ? null : delta });
  });
  return Object.freeze({ beforeTitle: before.title, afterTitle: after.title, slots: Object.freeze(slots),
    allContinuous: leftReport.allArithmeticAgreement && rightReport.allArithmeticAgreement && slots.every(slot => slot.continuousEvidence),
    eventCountsMerged: false, tokenAmountsSummed: false, liveChainRechecked: false, independentlyVerified: false,
    beforeReportStatus: leftReport.status, afterReportStatus: rightReport.status });
}

export function reportContinuityText(result) {
  if (!result) return "";
  const lines = ["期間のつながり", result.beforeTitle + " → " + result.afterTitle,
    result.allContinuous ? "3トークンの保存期間は境界で一致しています。" : "3トークンすべての連続した証拠とは確認できていません。"];
  for (const row of result.slots) {
    lines.push(row.agent + ": " + STATUS[row.status]);
    if (row.beforeStart !== null) lines.push("  比較元: " + row.beforeStart + " → " + row.beforeEnd);
    if (row.afterStart !== null) lines.push("  比較先: " + row.afterStart + " → " + row.afterEnd);
    if (row.status === "gap") lines.push("  空白: " + row.gapBlocks + "ブロック");
    if (row.status === "overlap") lines.push("  重複: " + row.overlapBlocks + "ブロック");
    if (row.adjacent) lines.push("  境界ブロック: " + row.boundaryBlock);
    for (const code of row.issues) lines.push("  " + ISSUE[code]);
    if (row.boundaryBalanceDifference !== null && row.boundaryBalanceDifference !== "0") {
      lines.push("  同一境界の残高差（最小単位）: " + row.boundaryBalanceDifference);
    }
  }
  lines.push("取得区間は開始ブロックの翌ブロックから終了ブロックまでです。作成日時の順序だけでは判定しません。");
  lines.push("保存された証拠の照合であり、現在のチェーン状態や利益の証明ではありません。履歴や数量を合算しません。");
  return lines.join("\n");
}
