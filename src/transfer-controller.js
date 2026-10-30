import {
  transferContextKey, transferFail, validateTransferContext,
  validateTransferRequest, validateTransferSnapshot,
} from "./transfer-codec.js";
import { prepareTransferDownload, readTransferFile } from "./transfer-file.js";
import { compareTransferSnapshots } from "./transfer-view.js";
import { readOwnErrorCode } from "./provider-error.js";
import { captureDataRecord } from "./security-data.js";
import { createStateNotifier } from "./state-notifier.js";

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
  let revision = 0;
  const observers = new Set([() => onChange(state)]);
  const notifier = createStateNotifier({ observers, read: () => Object.freeze({ revision }) });
  const owns = operation => !disposed && operation.id === generation;
  function publish(patch) {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    revision++;
    notifier.notify();
  }
  function interrupt(operation) {
    const id = ++generation;
    if (operation) operation.id = id;
    const previous = aborter;
    aborter = null;
    previous?.abort();
    return id;
  }
  function reset(phase = "idle") {
    if (disposed) return;
    const id = interrupt();
    if (disposed || generation !== id) return;
    contextKey = null;
    publish({ phase, snapshot: null, baseline: null, preview: null, comparison: null,
      provenance: null, progress: null, error: null });
  }
  function context(operation, acceptChange = false) {
    if (!owns(operation)) return null;
    const value = validateTransferContext(getContext());
    if (!owns(operation)) return null;
    const key = transferContextKey(value);
    if (contextKey !== null && contextKey !== key) {
      if (!acceptChange) { reset(); return null; }
      // begin() will publish this cleared context with its new phase once.
      state = Object.freeze({ phase: "idle", snapshot: null, baseline: null, preview: null, comparison: null,
        provenance: null, progress: null, error: null });
    }
    contextKey = key;
    return value;
  }
  function begin(operation, phase, patch = {}) {
    if (disposed) transferFail("TRANSFER_DISPOSED");
    interrupt(operation);
    if (!owns(operation)) return false;
    const selected = context(operation, true);
    if (!selected || !owns(operation)) return false;
    const key = transferContextKey(selected);
    Object.assign(operation, { key, selected });
    publish({ phase, error: null, progress: null, preview: null, ...patch });
    return owns(operation);
  }
  function current(operation) {
    if (!owns(operation)) return false;
    let key;
    try { key = transferContextKey(getContext()); } catch {}
    if (!owns(operation)) return false;
    if (key !== operation.key) { reset(); return false; }
    return true;
  }
  function assertContext(snapshot, selected) {
    if (transferContextKey(snapshot.context) !== transferContextKey(selected)) transferFail("TRANSFER_IMPORT_CONTEXT");
  }
  function errorCode(error) {
    // Do not show raw provider/file messages, which can contain untrusted markup
    // or sensitive server details. Every displayed error has a local explanation.
    const code = readOwnErrorCode(error);
    return typeof code === "string" && /^TRANSFER_[A-Z_]+$/.test(code) ? code : "TRANSFER_OPERATION_FAILED";
  }
  function fail(operation, error) {
    if (operation && (!owns(operation) || (operation.key !== null && !current(operation)))) return false;
    if (disposed) return false;
    const previous = generation;
    const code = errorCode(error);
    if (disposed || generation !== previous) return false;
    const id = interrupt(operation);
    if (disposed || generation !== id) return false;
    publish({ phase: "error", error: code, progress: null, preview: null });
    return false;
  }
  async function inspect(input) {
    const operation = { id: generation, key: null };
    try {
      const request = validateTransferRequest(input);
      if (!owns(operation)) return false;
      if (!begin(operation, "reading", { snapshot: null, provenance: null, comparison: null })) return false;
      if (!current(operation)) return false;
      const localAborter = new AbortController();
      aborter = localAborter;
      const result = await read(request, {
        signal: localAborter.signal,
        onProgress(value) {
          if (!current(operation)) return;
          try { value = captureDataRecord(value, ["stage", "completed", "total"]); } catch { return; }
          if (!owns(operation) || state.phase !== "reading") return;
          if (!value || !["range", "token", "incoming", "outgoing", "blocks", "canonical", "complete"].includes(value.stage) ||
              !Number.isInteger(value.completed) || !Number.isInteger(value.total) || value.completed < 0 ||
              value.total < value.completed || value.total > 100) return;
          publish({ progress: Object.freeze({ stage: value.stage, completed: value.completed, total: value.total }) });
        },
      });
      if (!current(operation)) return false;
      const snapshot = validateTransferSnapshot(result);
      assertContext(snapshot, operation.selected);
      if (!current(operation)) return false;
      aborter = null;
      publish({ phase: "ready", snapshot, provenance: "live", progress: null });
      return owns(operation);
    } catch (error) { return fail(operation, error); }
  }
  async function stageFile(file, target = "snapshot") {
    const operation = { id: generation, key: null };
    try {
      if (!["snapshot", "baseline"].includes(target)) transferFail("TRANSFER_IMPORT_TARGET");
      if (!begin(operation, "loading") || !current(operation)) return false;
      const decoded = await readTransferFile(file, { subtle });
      if (!current(operation)) return false;
      assertContext(decoded.snapshot, operation.selected);
      const preview = Object.freeze({ id: operation.id, target, snapshot: decoded.snapshot,
        digest: decoded.digest, authenticated: false });
      publish({ phase: "preview", preview });
      return owns(operation);
    } catch (error) { return fail(operation, error); }
  }
  function applyImport(id) {
    if (disposed) return false;
    const operation = { id: generation, key: null };
    try {
      const preview = state.preview;
      if (!preview || preview.id !== id || generation !== id) transferFail("TRANSFER_REVIEW_REQUIRED");
      const selected = context(operation);
      if (!selected || !owns(operation) || state.preview !== preview) return false;
      assertContext(preview.snapshot, selected);
      interrupt(operation);
      if (!owns(operation)) return false;
      if (preview.target === "baseline") {
        publish({ phase: state.snapshot ? "ready" : "idle", baseline: preview.snapshot, preview: null, comparison: null, error: null });
      } else {
        publish({ phase: "ready", snapshot: preview.snapshot, provenance: "imported", preview: null, comparison: null, error: null });
      }
      return owns(operation);
    } catch (error) { return fail(operation, error); }
  }
  function cancel() {
    if (disposed) return;
    const id = interrupt();
    if (disposed || generation !== id) return;
    publish({ phase: state.snapshot ? "ready" : "cancelled", preview: null, progress: null, error: null });
  }
  function keepBaseline() {
    if (disposed) return false;
    const operation = { id: generation, key: null };
    try {
      if (!context(operation)) return false;
      if (!state.snapshot || state.phase !== "ready") transferFail("TRANSFER_SNAPSHOT_REQUIRED");
      publish({ baseline: state.snapshot, comparison: null, error: null });
      return owns(operation);
    } catch (error) { return fail(operation, error); }
  }
  function compare() {
    if (disposed) return false;
    const operation = { id: generation, key: null };
    try {
      if (!context(operation)) return false;
      if (!state.snapshot || !state.baseline || state.phase !== "ready") transferFail("TRANSFER_BASELINE_REQUIRED");
      const comparison = compareTransferSnapshots(state.baseline, state.snapshot);
      publish({ comparison, error: null });
      return owns(operation);
    } catch (error) { return fail(operation, error); }
  }
  async function prepare(kind = "json") {
    const operation = { id: generation, key: null };
    try {
      if (!context(operation)) return null;
      if (!state.snapshot || state.phase !== "ready") transferFail("TRANSFER_SNAPSHOT_REQUIRED");
      const snapshot = state.snapshot;
      if (!begin(operation, "preparing") || !current(operation)) return null;
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
    disposed = true;
    observers.clear();
    generation++;
    const previous = aborter;
    aborter = null;
    contextKey = null;
    state = Object.freeze({ phase: "disposed", snapshot: null, baseline: null, preview: null, comparison: null,
      provenance: null, progress: null, error: null });
    previous?.abort();
  }
  return Object.freeze({
    get state() { return state; },
    inspect, stageFile, applyImport, cancel, keepBaseline, compare, prepare,
    invalidate: () => { if (!disposed) reset(); },
    dispose,
  });
}
