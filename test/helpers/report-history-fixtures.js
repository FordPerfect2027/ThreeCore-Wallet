import { emptyReportHistory, validateReportHistory, validateHistoryEntry, mutateReportHistory } from "../../src/report-history-model.js";
import { periodFail } from "../../src/period-plan.js";
import { reportInput, reportLibrary, id, TIME, LATER, clone, code, fileFrom, deferred, tick,
  changedSlot, forkedInput, manyEventsInput, waitUntil, walk, selection, memoryStorage as libraryMemory } from "./period-report-fixtures.js";
export { reportInput, reportLibrary, id, TIME, LATER, clone, code, fileFrom, deferred, tick,
  changedSlot, forkedInput, manyEventsInput, waitUntil, walk, selection, libraryMemory };
export const AFTER = "2026-10-24T03:00:00.000Z";

export function historyRecord(number = 1, changes = {}) {
  return validateHistoryEntry({ id: id(100 + number), label: "報告 " + number, note: "確認用メモ " + number,
    tags: ["daily"], savedAt: TIME, updatedAt: TIME, archived: false,
    report: reportInput({ title: "期間確認 " + number }), ...changes });
}

export function historyDocument(entries = [], revision = 0) {
  return validateReportHistory({ ...emptyReportHistory(), revision, entries });
}

export function sampleHistory() {
  return historyDocument([
    historyRecord(1),
    historyRecord(2, { label: "EMA 確認中", tags: ["review"], report: forkedInput() }),
    historyRecord(3, { label: "取得途中", tags: ["partial"], report: reportInput({ counts: [2, 5, 5] }) }),
    historyRecord(4, { label: "以前の確認", archived: true, note: "担当メモ", tags: ["old"] }),
  ], 4);
}

export function historyMemory(initial = emptyReportHistory(), hooks = {}) {
  let document = validateReportHistory(initial), closed = false;
  const calls = [];
  return {
    calls,
    get document() { return document; },
    get closed() { return closed; },
    replace(value) { document = validateReportHistory(value); },
    external(operation) { document = mutateReportHistory(document, document.revision, operation); },
    storage: {
      async read() {
        calls.push(["read"]); await hooks.beforeRead?.();
        if (closed) periodFail("CHECKPOINT_CLOSED");
        return clone(document);
      },
      async change(revision, operation, config = {}) {
        calls.push(["change", revision, clone(operation)]);
        await hooks.beforeChange?.();
        if (closed || config.signal?.aborted || config.canCommit?.() === false) periodFail("CHECKPOINT_CANCELLED");
        document = mutateReportHistory(document, revision, operation);
        await hooks.afterChange?.();
        return clone(document);
      },
      close() { closed = true; calls.push(["close"]); },
    },
  };
}

export const saveHistory = (number = 1, changes = {}) => ({ kind: "save", entry: historyRecord(number, changes) });
export function annotateHistory(number = 1, changes = {}) {
  return { kind: "annotate", id: id(100 + number), label: "変更後", note: "メモ", tags: ["review"], time: LATER, ...changes };
}
