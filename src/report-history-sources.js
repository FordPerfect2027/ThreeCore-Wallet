import { validatePeriodReportInput } from "./period-report-model.js";
import { validatePeriodLibrary, compareLibraryDrafts, libraryTime } from "./period-library-model.js";
import { periodDraftKey } from "./period-draft.js";

const TEXT = Object.freeze({
  unselected: "このトークンは報告に含まれていません",
  exact: "保存一覧に同じ控えがあります",
  metadata: "控えの名前・保管情報が変わっています",
  restricted: "現在の控えには再取得が必要という印があります",
  "restriction-removed": "現在の控えでは再取得の印が外れています",
  changed: "現在の控えの証拠が、保存した報告と異なります",
  missing: "元の保存番号の控えが見つかりません",
  "equivalent-copy": "別の保存番号に同じ証拠の控えがあります",
  "multiple-copies": "別の保存番号に同じ証拠の控えが複数あります",
});
const CHANGE_TEXT = Object.freeze({
  "different-plan": "対象または期間が異なります", identical: "同じ証拠です",
  "changed-evidence": "取得済みの証拠が変わっています", extension: "取得工程が増えています", shorter: "取得工程が減っています",
});

/** Read-only cross-reference. A missing source does not erase a portable historical report. */
export function inspectReportSources(reportInput, libraryInput, checkedAt) {
  const report = validatePeriodReportInput(reportInput);
  const library = validatePeriodLibrary(libraryInput);
  libraryTime(checkedAt);
  const slots = report.slots.map(({ agent, entry }) => {
    if (!entry) return Object.freeze({ agent, status: "unselected", sourceId: null,
      currentId: null, candidates: Object.freeze([]), evidenceChange: null, warning: false });
    const sourceKey = periodDraftKey(entry.draft);
    const current = library.entries.find(row => row.id === entry.id);
    const equivalent = library.entries.filter(row => row.id !== entry.id && row.requiresNewPlan === entry.requiresNewPlan &&
      periodDraftKey(row.draft) === sourceKey);
    let status, change = null;
    if (!current) {
      status = equivalent.length === 1 ? "equivalent-copy" : equivalent.length > 1 ? "multiple-copies" : "missing";
    } else if (current.requiresNewPlan && !entry.requiresNewPlan) status = "restricted";
    else if (!current.requiresNewPlan && entry.requiresNewPlan) status = "restriction-removed";
    else if (periodDraftKey(current.draft) !== sourceKey) status = "changed";
    else if (JSON.stringify(current) === JSON.stringify(entry)) status = "exact";
    else status = "metadata";
    if (current && periodDraftKey(current.draft) !== sourceKey) change = compareLibraryDrafts(entry.draft, current.draft);
    return Object.freeze({ agent, status, sourceId: entry.id, currentId: current?.id ?? null,
      sourceLabel: entry.label, currentLabel: current?.label ?? null,
      sourceArchived: entry.archived, currentArchived: current?.archived ?? null,
      sourceRestricted: entry.requiresNewPlan, currentRestricted: current?.requiresNewPlan ?? null,
      candidates: Object.freeze(equivalent.map(row => Object.freeze({ id: row.id, label: row.label, archived: row.archived }))),
      evidenceChange: change, warning: !["exact", "metadata"].includes(status) });
  });
  return Object.freeze({ checkedAt, libraryRevision: library.revision, slots: Object.freeze(slots),
    matched: slots.filter(row => row.status === "exact").length,
    warnings: slots.filter(row => row.warning).length, historicalReportUnchanged: true,
    automaticallyReplaced: false, liveChainRechecked: false, independentlyVerified: false });
}

export function reportSourcesText(inspection) {
  if (!inspection) return "";
  const lines = ["元の期間の控えとの照合", "照合日時: " + inspection.checkedAt,
    "読んだ保存一覧の版: " + inspection.libraryRevision];
  for (const slot of inspection.slots) {
    lines.push(slot.agent + ": " + (Object.hasOwn(TEXT, slot.status) ? TEXT[slot.status] : "未確認"));
    if (slot.sourceId) lines.push("  報告に含まれる保存番号: " + slot.sourceId);
    if (slot.currentLabel) lines.push("  現在の保存名: " + slot.currentLabel + (slot.currentArchived ? "（非表示保管）" : ""));
    if (slot.evidenceChange) {
      lines.push("  証拠の変化: " + (CHANGE_TEXT[slot.evidenceChange.kind] ?? "再確認が必要です") +
        " / 取得工程 " + slot.evidenceChange.before.completed + " → " + slot.evidenceChange.after.completed);
    }
    for (const row of slot.candidates) lines.push("  別番号の候補: " + row.label + " / " + row.id + (row.archived ? "（非表示保管）" : ""));
  }
  lines.push("PC内の保存一覧との比較です。ブロックチェーンへの再照会ではありません。報告の元データや計算結果は変更しません。");
  lines.push("別番号の候補へ自動的に置き換えません。再取得の印が外れていても、安全性や正確さを認証しません。");
  return lines.join("\n");
}
