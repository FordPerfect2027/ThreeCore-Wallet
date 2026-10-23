import { transferContextKey, transferFail } from "./transfer-codec.js";
import { addTransferArchiveRecord, removeTransferArchiveRecord, validateTransferArchive } from "./transfer-archive.js";
import { prepareTransferArchive, readTransferArchive } from "./transfer-archive-file.js";

/** Small in-memory shelf. Persistence always requires an explicit file download. */
export function createTransferArchiveController({ getContext, onChange = () => {}, subtle }) {
  if (typeof getContext !== "function" || typeof onChange !== "function") transferFail("TRANSFER_CONTROLLER_OPTIONS");
  let revision = 0;
  let contextKey = null;
  let disposed = false;
  let state = Object.freeze({ phase: "empty", archive: null, preview: null, error: null });
  function publish(patch) {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    try { Promise.resolve(onChange(state)).catch(() => {}); } catch { /* View observers do not authorize persistence. */ }
  }
  function invalidate() {
    if (disposed) return;
    revision++;
    contextKey = null;
    publish({ phase: "empty", archive: null, preview: null, error: null });
  }
  function context() {
    const key = transferContextKey(getContext());
    if (contextKey !== null && contextKey !== key) invalidate();
    contextKey = key;
    return key;
  }
  function current(id, key) {
    if (disposed || revision !== id) return false;
    try { return context() === key && revision === id; }
    catch { invalidate(); return false; }
  }
  function fail(error) {
    if (disposed) return false;
    let code;
    try { code = error?.code; } catch { code = null; }
    publish({ phase: state.archive ? "ready" : "empty", preview: null,
      error: typeof code === "string" && /^TRANSFER_[A-Z_]+$/.test(code) ? code : "TRANSFER_OPERATION_FAILED" });
    return false;
  }
  function assertContext(archive, key) {
    if (transferContextKey(archive.records[0].context) !== key) transferFail("TRANSFER_ARCHIVE_CONTEXT");
  }
  function add(record) {
    if (disposed) return false;
    revision++;
    try {
      const key = context();
      const archive = addTransferArchiveRecord(state.archive, record);
      assertContext(archive, key);
      publish({ phase: "ready", archive, preview: null, error: null });
      return true;
    } catch (error) { return fail(error); }
  }
  function remove(index) {
    if (disposed) return false;
    revision++;
    try {
      context();
      const archive = removeTransferArchiveRecord(state.archive, index);
      publish({ phase: archive ? "ready" : "empty", archive, preview: null, error: null });
      return true;
    } catch (error) { return fail(error); }
  }
  function select(index) {
    if (disposed) return null;
    try {
      context();
      if (!state.archive || !Number.isInteger(index) || index < 0 || index >= state.archive.records.length) {
        transferFail("TRANSFER_ARCHIVE_INDEX");
      }
      return state.archive.records[index];
    } catch (error) { fail(error); return null; }
  }
  async function stage(file) {
    if (disposed) return false;
    let id, key;
    try {
      key = context();
      id = ++revision;
      publish({ phase: "loading", preview: null, error: null });
      const { archive, digest } = await readTransferArchive(file, { subtle });
      if (!current(id, key)) return false;
      assertContext(archive, key);
      publish({ phase: "preview", preview: Object.freeze({ id, archive, digest, authenticated: false }) });
      return true;
    } catch (error) {
      if (!disposed && (id === undefined || current(id, key))) return fail(error);
      return false;
    }
  }
  function apply(id) {
    if (disposed) return false;
    try {
      const key = context();
      if (!state.preview || state.preview.id !== id || revision !== id) transferFail("TRANSFER_REVIEW_REQUIRED");
      const archive = validateTransferArchive(state.preview.archive);
      assertContext(archive, key);
      revision++;
      publish({ phase: "ready", archive, preview: null, error: null });
      return true;
    } catch (error) { return fail(error); }
  }
  async function prepare() {
    if (disposed) return null;
    let id, key;
    try {
      key = context();
      if (!state.archive) transferFail("TRANSFER_ARCHIVE_REQUIRED");
      id = ++revision;
      publish({ phase: "preparing", preview: null, error: null });
      const download = await prepareTransferArchive(state.archive, { subtle });
      if (!current(id, key)) return null;
      publish({ phase: "ready" });
      return current(id, key) ? download : null;
    } catch (error) {
      if (id === undefined || current(id, key)) fail(error);
      return null;
    }
  }
  function capture() {
    if (disposed) return null;
    if (!state.archive) return null;
    context();
    return state.archive;
  }
  function reviewArchive(input) {
    if (disposed) return false;
    revision++;
    try {
      const key = context();
      const archive = validateTransferArchive(input);
      assertContext(archive, key);
      publish({ phase: "preview", preview: Object.freeze({ id: revision, archive, digest: null, authenticated: false }), error: null });
      return true;
    } catch (error) { return fail(error); }
  }
  function cancel() {
    if (disposed) return;
    revision++;
    publish({ phase: state.archive ? "ready" : "empty", preview: null, error: null });
  }
  function dispose() {
    invalidate();
    disposed = true;
    state = Object.freeze({ ...state, phase: "disposed" });
  }
  return Object.freeze({ get state() { return state; }, add, remove, select, stage, apply, prepare, capture, reviewArchive, cancel, invalidate, dispose });
}
