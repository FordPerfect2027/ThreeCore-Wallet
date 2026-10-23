import { reconciliationLedgerCsv, reconciliationWindowsCsv } from "./reconciliation-ledger.js";
import {
  emptyReconciliationWorkspace, validateReconciliationWorkspace, reconciliationKey,
  reconciliationAgent, reconciliationPart, reconciliationFail, replaceReconciliationPart,
  clearReconciliationSlot, reviewReconciliationReplacement,
} from "./reconciliation-model.js";
import { reconcileWorkspace } from "./reconciliation-engine.js";
import { prepareReconciliationFile, readReconciliationInput } from "./reconciliation-file.js";
import {
  reconciliationErrorMessage, reconciliationText, reconciliationSummaryCsv, reconciliationEventsCsv,
} from "./reconciliation-view.js";

export const RECONCILIATION_UNDO_LIMIT = 8;
export const RECONCILIATION_UNDO_BYTES = 32 * 1024 * 1024;

/** No provider, wallet, RPC, storage or transaction methods belong in this controller. */
export function createReconciliationController({
  initial = emptyReconciliationWorkspace(),
  onStateChange = () => {},
  readObservation = () => null,
  readArchive = () => null,
  readFile = readReconciliationInput,
  prepareFile = prepareReconciliationFile,
} = {}) {
  let workspace = validateReconciliationWorkspace(initial);
  let agent = "DAT";
  let revision = 0;
  let sourceEpoch = 0;
  let operation = 0;
  let busy = false;
  let disposed = false;
  let review = null;
  let report = null;
  let message = "記録を入れて照合してください。";
  let error = null;
  let savedKey = null;
  let undo = [];
  let redo = [];

  function state() {
    return Object.freeze({
      workspace, agent, revision, review, report, busy, disposed, message, error,
      canUndo: undo.length > 0,
      canRedo: redo.length > 0,
      undoDepth: undo.length,
      redoDepth: redo.length,
      exportedCurrent: savedKey === reconciliationKey(workspace),
    });
  }

  function emit() {
    if (!disposed) {
      try { onStateChange(state()); }
      catch { /* A presentation callback cannot alter operation ownership or evidence. */ }
    }
  }

  function fail(errorValue) {
    error = reconciliationErrorMessage(errorValue);
    message = error;
    emit();
    return false;
  }

  function available() {
    if (disposed) return false;
    if (busy) reconciliationFail("RECONCILIATION_BUSY");
    return true;
  }

  function retain(stack, value) {
    const candidates = [...stack, value].slice(-RECONCILIATION_UNDO_LIMIT);
    let bytes = 0;
    const kept = [];
    for (let index = candidates.length - 1; index >= 0; index--) {
      bytes += new TextEncoder().encode(JSON.stringify(candidates[index])).byteLength;
      if (bytes > RECONCILIATION_UNDO_BYTES) break;
      kept.unshift(candidates[index]);
    }
    return kept;
  }

  function changed(next, nextMessage) {
    workspace = validateReconciliationWorkspace(next);
    revision++;
    operation++;
    busy = false;
    review = null;
    report = null;
    error = null;
    message = nextMessage;
    emit();
  }

  function stage(next, source = "memory") {
    const replacement = reviewReconciliationReplacement(workspace, next);
    review = Object.freeze({ ...replacement, revision, sourceEpoch, source });
    message = replacement.changes.length ? "変更内容を確認してから適用してください。" : "現在と同じ内容です。";
    error = null;
    emit();
    return true;
  }

  function selectAgent(next) {
    try {
      if (disposed) return false;
      reconciliationAgent(next);
      if (next === agent) return true;
      agent = next;
      operation++;
      busy = false;
      review = null;
      error = null;
      message = next + "を選びました。";
      emit();
      return true;
    } catch (value) { return fail(value); }
  }

  function capture(part) {
    try {
      if (!available()) return false;
      review = null;
      reconciliationPart(part);
      const value = part === "archive" ? readArchive(agent) : readObservation(agent);
      if (value === null || value === undefined) reconciliationFail("RECONCILIATION_NO_SOURCE");
      return stage(replaceReconciliationPart(workspace, agent, part, value), "card");
    } catch (value) { return fail(value); }
  }

  function propose(next) {
    try {
      if (!available()) return false;
      review = null;
      return stage(next);
    } catch (value) { return fail(value); }
  }

  function remove(part = "all") {
    try {
      if (!available()) return false;
      review = null;
      return stage(part === "all" ? clearReconciliationSlot(workspace, agent)
        : replaceReconciliationPart(workspace, agent, part, null));
    } catch (value) { return fail(value); }
  }

  async function importFile(file, kind) {
    try {
      if (!available()) return false;
      const current = ++operation;
      const before = workspace;
      const selected = agent;
      busy = true;
      review = null;
      error = null;
      message = "ファイルを検査しています。";
      emit();
      let next;
      try { next = await readFile(file, kind, selected, before); }
      catch (value) {
        if (disposed || current !== operation) return false;
        busy = false;
        return fail(value);
      }
      if (disposed || current !== operation) return false;
      busy = false;
      if (workspace !== before || agent !== selected) reconciliationFail("RECONCILIATION_STALE");
      return stage(next, "file");
    } catch (value) { return fail(value); }
  }

  function apply(acknowledged = false) {
    try {
      if (!available()) return false;
      if (!review) reconciliationFail("RECONCILIATION_NO_REVIEW");
      if (review.revision !== revision || review.beforeKey !== reconciliationKey(workspace) ||
          (review.source === "card" && review.sourceEpoch !== sourceEpoch)) reconciliationFail("RECONCILIATION_STALE");
      if (review.requiresReplacementAcknowledgement && acknowledged !== true) reconciliationFail("RECONCILIATION_ACK");
      if (!review.changes.length) {
        review = null;
        message = "変更はありません。";
        emit();
        return true;
      }
      undo = retain(undo, workspace);
      redo = [];
      changed(review.after, "画面内に適用しました。照合してから、必要に応じてJSONを保存してください。");
      return true;
    } catch (value) { return fail(value); }
  }

  function cancel() {
    if (disposed) return false;
    operation++;
    busy = false;
    review = null;
    error = null;
    message = "確認中の操作を取り消しました。現在の記録は維持しています。";
    emit();
    return true;
  }

  function invalidateSources() {
    if (disposed) return;
    sourceEpoch++;
    if (review?.source === "card") {
      review = null;
      message = "カードの記録が変わりました。もう一度取り込んでください。";
      emit();
    }
  }

  function calculate() {
    try {
      if (!available()) return false;
      report = reconcileWorkspace(workspace);
      error = null;
      message = "保存した記録を照合しました。各トークンの結果を確認してください。";
      emit();
      return true;
    } catch (value) { return fail(value); }
  }

  function travel(direction) {
    try {
      if (!available()) return false;
      if (!["undo", "redo"].includes(direction)) reconciliationFail("RECONCILIATION_DIRECTION");
      const source = direction === "undo" ? undo : redo;
      if (!source.length) return false;
      const next = source.at(-1);
      if (direction === "undo") {
        undo = undo.slice(0, -1);
        redo = retain(redo, workspace);
      } else {
        redo = redo.slice(0, -1);
        undo = retain(undo, workspace);
      }
      changed(next, "画面内の記録を" + (direction === "undo" ? "元に戻しました。" : "やり直しました。"));
      return true;
    } catch (value) { return fail(value); }
  }

  async function exportFile(kind, deliver) {
    try {
      if (!available()) return false;
      if (!["json", "summary", "events", "text", "ledger", "windows"].includes(kind) || typeof deliver !== "function") {
        reconciliationFail("RECONCILIATION_FILE_KIND");
      }
      if (kind !== "json" && !report) reconciliationFail("RECONCILIATION_NO_REPORT");
      const current = ++operation;
      const before = workspace;
      busy = true;
      error = null;
      message = "保存ファイルを準備しています。";
      emit();
      try {
        const file = kind === "json" ? await prepareFile(before) : Object.freeze({
          text: kind === "ledger" ? reconciliationLedgerCsv(before) : kind === "windows" ? reconciliationWindowsCsv(before) :
            kind === "text" ? reconciliationText(before) : kind === "summary"
            ? reconciliationSummaryCsv(before) : reconciliationEventsCsv(before),
          filename: "ThreeCore-reconciliation-" + kind + (kind === "text" ? ".txt" : ".csv"),
          mimeType: kind === "text" ? "text/plain;charset=utf-8" : "text/csv;charset=utf-8",
        });
        if (disposed || current !== operation) return false;
        // Delivery must be synchronous: a cancelled operation cannot launch a later download.
        const result = deliver(file);
        if (result && typeof result.then === "function") reconciliationFail("RECONCILIATION_ASYNC_DELIVERY");
        if (kind === "json") savedKey = reconciliationKey(before);
        busy = false;
        message = "保存を開始しました。ブラウザーのダウンロード先でファイルを確認してください。";
        emit();
        return true;
      } catch (value) {
        if (disposed || current !== operation) return false;
        busy = false;
        return fail(value);
      }
    } catch (value) { return fail(value); }
  }

  return Object.freeze({
    get state() { return state(); },
    selectAgent, capture, propose, remove, importFile, apply, cancel, invalidateSources,
    calculate, travel, exportFile,
    dispose() {
      if (disposed) return;
      disposed = true;
      operation++;
      busy = false;
      review = null;
      undo = [];
      redo = [];
    },
  });
}
