import {
  transferContextKey, transferFail, validateTransferContext,
  validateTransferRequest, validateTransferSnapshot,
} from "./transfer-codec.js";
import { prepareTransferDownload, readTransferFile } from "./transfer-file.js";
import { compareTransferSnapshots } from "./transfer-view.js";

/** All reads, imports and downloads start with a caller action. Nothing auto-saves. */
export function createTransferController({ getContext, read, onChange = () => {}, subtle }) {
  if (typeof getContext !== "function" || typeof read !== "function" || typeof onChange !== "function") {
    transferFail("TRANSFER_CONTROLLER_OPTIONS");
  }
  let generation = 0;
  let disposed = false;
  let aborter = null;
  let contextKey = null;
  let state = Object.freeze({
    phase: "idle", snapshot: null, baseline: null, preview: null, comparison: null,
    provenance: null, progress: null, error: null,
  });
  function publish(patch) {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    try { Promise.resolve(onChange(state)).catch(() => {}); } catch { /* A view failure cannot approve an operation. */ }
  }
  function interrupt() {
    generation++;
    aborter?.abort();
    aborter = null;
  }
  function reset(phase = "idle") {
    interrupt();
    contextKey = null;
    publish({ phase, snapshot: null, baseline: null, preview: null, comparison: null,
      provenance: null, progress: null, error: null });
  }
  function context() {
    const value = validateTransferContext(getContext());
    const key = transferContextKey(value);
    if (contextKey !== null && contextKey !== key) reset();
    contextKey = key;
    return value;
  }
  function begin(phase, patch = {}) {
    if (disposed) transferFail("TRANSFER_DISPOSED");
    const selected = context();
    interrupt();
    const id = generation;
    const key = transferContextKey(selected);
    publish({ phase, error: null, progress: null, preview: null, ...patch });
    return { id, key, selected };
  }
  function current(operation) {
    if (disposed || generation !== operation.id) return false;
    try {
      if (transferContextKey(getContext()) !== operation.key) {
        reset();
        return false;
      }
    } catch {
      reset();
      return false;
    }
    return true;
  }
  function assertContext(snapshot, selected) {
    if (transferContextKey(snapshot.context) !== transferContextKey(selected)) transferFail("TRANSFER_IMPORT_CONTEXT");
  }
  function errorCode(error) {
    // Do not show raw provider/file messages, which can contain untrusted markup
    // or sensitive server details. Every displayed error has a local explanation.
    try {
      return typeof error?.code === "string" && /^TRANSFER_[A-Z_]+$/.test(error.code)
        ? error.code : "TRANSFER_OPERATION_FAILED";
    } catch { return "TRANSFER_OPERATION_FAILED"; }
  }
  function fail(operation, error) {
    if (operation && !current(operation)) return false;
    if (disposed) return false;
    if (!operation) interrupt();
    publish({ phase: "error", error: errorCode(error), progress: null, preview: null });
    return false;
  }
  async function inspect(input) {
    let operation;
    try {
      const request = validateTransferRequest(input);
      operation = begin("reading", { snapshot: null, provenance: null, comparison: null });
      if (!current(operation)) return false;
      const localAborter = new AbortController();
      aborter = localAborter;
      const result = await read(request, {
        signal: localAborter.signal,
        onProgress(value) {
          if (!current(operation)) return;
          if (!value || !["range", "token", "incoming", "outgoing", "blocks", "canonical", "complete"].includes(value.stage) ||
              !Number.isInteger(value.completed) || !Number.isInteger(value.total) || value.completed < 0 ||
              value.total < value.completed || value.total > 100) return;
          publish({ progress: Object.freeze({ stage: value.stage, completed: value.completed, total: value.total }) });
        },
      });
      if (!current(operation)) return false;
      const snapshot = validateTransferSnapshot(result);
      assertContext(snapshot, operation.selected);
      aborter = null;
      publish({ phase: "ready", snapshot, provenance: "live", progress: null });
      return true;
    } catch (error) { return fail(operation, error); }
  }
  async function stageFile(file, target = "snapshot") {
    let operation;
    try {
      if (!["snapshot", "baseline"].includes(target)) transferFail("TRANSFER_IMPORT_TARGET");
      operation = begin("loading");
      const decoded = await readTransferFile(file, { subtle });
      if (!current(operation)) return false;
      assertContext(decoded.snapshot, operation.selected);
      const preview = Object.freeze({ id: operation.id, target, snapshot: decoded.snapshot,
        digest: decoded.digest, authenticated: false });
      publish({ phase: "preview", preview });
      return true;
    } catch (error) { return fail(operation, error); }
  }
  function applyImport(id) {
    if (disposed) return false;
    try {
      const selected = context();
      const preview = state.preview;
      if (!preview || preview.id !== id || generation !== id) transferFail("TRANSFER_REVIEW_REQUIRED");
      assertContext(preview.snapshot, selected);
      interrupt();
      if (preview.target === "baseline") {
        publish({ phase: state.snapshot ? "ready" : "idle", baseline: preview.snapshot, preview: null, comparison: null, error: null });
      } else {
        publish({ phase: "ready", snapshot: preview.snapshot, provenance: "imported", preview: null, comparison: null, error: null });
      }
      return true;
    } catch (error) { return fail(null, error); }
  }
  function cancel() {
    if (disposed) return;
    interrupt();
    publish({ phase: state.snapshot ? "ready" : "cancelled", preview: null, progress: null, error: null });
  }
  function keepBaseline() {
    if (disposed) return false;
    try {
      context();
      if (!state.snapshot || state.phase !== "ready") transferFail("TRANSFER_SNAPSHOT_REQUIRED");
      publish({ baseline: state.snapshot, comparison: null, error: null });
      return true;
    } catch (error) { return fail(null, error); }
  }
  function compare() {
    if (disposed) return false;
    try {
      context();
      if (!state.snapshot || !state.baseline || state.phase !== "ready") transferFail("TRANSFER_BASELINE_REQUIRED");
      const comparison = compareTransferSnapshots(state.baseline, state.snapshot);
      publish({ comparison, error: null });
      return true;
    } catch (error) { return fail(null, error); }
  }
  async function prepare(kind = "json") {
    let operation;
    try {
      context();
      if (!state.snapshot || state.phase !== "ready") transferFail("TRANSFER_SNAPSHOT_REQUIRED");
      const snapshot = state.snapshot;
      operation = begin("preparing");
      const download = await prepareTransferDownload(snapshot, kind, { subtle });
      if (!current(operation)) return null;
      publish({ phase: "ready" });
      return current(operation) ? download : null;
    } catch (error) {
      fail(operation, error);
      return null;
    }
  }
  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    state = Object.freeze({ ...state, phase: "disposed" });
  }
  return Object.freeze({
    get state() { return state; },
    inspect, stageFile, applyImport, cancel, keepBaseline, compare, prepare,
    invalidate: () => { if (!disposed) reset(); },
    dispose,
  });
}
