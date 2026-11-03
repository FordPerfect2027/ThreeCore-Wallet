import { transferContextKey, transferFail } from "./transfer-codec.js";
import { addTransferArchiveRecord, removeTransferArchiveRecord, validateTransferArchive } from "./transfer-archive.js";
import { prepareTransferArchive, readTransferArchive } from "./transfer-archive-file.js";
import { readOwnErrorCode } from "./provider-error.js";
import { createStateNotifier } from "./state-notifier.js";

/** Small in-memory shelf. Persistence always requires an explicit file download. */
export function createTransferArchiveController({ getContext, onChange = () => {}, subtle }) {
  if (typeof getContext !== "function" || typeof onChange !== "function") transferFail("TRANSFER_CONTROLLER_OPTIONS");
  let revision = 0;
  let contextKey = null;
  let disposed = false;
  let aborter = null;
  let state = Object.freeze({ phase: "empty", archive: null, preview: null, error: null });
  let notification = 0;
  const observers = new Set([() => onChange(state)]);
  const notifier = createStateNotifier({ observers, read: () => Object.freeze({ notification }) });
  const owns = id => !disposed && id === revision;
  function publish(patch) {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    notification++;
    notifier.notify();
  }
  function invalidate() {
    if (disposed) return;
    const id = interrupt();
    if (!owns(id)) return;
    contextKey = null;
    publish({ phase: "empty", archive: null, preview: null, error: null });
  }
  // Stop active work without discarding records the operator already accepted.
  function suspend() {
    if (disposed) return;
    const id = interrupt();
    if (!owns(id)) return;
    contextKey = null;
    publish({ phase: state.archive ? "ready" : "empty", preview: null, error: null });
  }
  function interrupt() {
    const id = ++revision, previous = aborter;
    aborter = null;
    previous?.abort();
    return id;
  }
  function context(id, acceptChange = false) {
    if (!owns(id)) return null;
    const key = transferContextKey(getContext());
    if (!owns(id)) return null;
    if (contextKey !== null && contextKey !== key) {
      if (!acceptChange) { suspend(); return null; }
      state = Object.freeze({ ...state, phase: state.archive ? "ready" : "empty", preview: null, error: null });
    }
    contextKey = key;
    return key;
  }
  function current(id, key) {
    if (!owns(id)) return false;
    try { return context(id) === key && owns(id); }
    catch { if (owns(id)) suspend(); return false; }
  }
  function fail(id, error) {
    if (!owns(id)) return false;
    const code = readOwnErrorCode(error);
    if (!owns(id)) return false;
    publish({ phase: state.archive ? "ready" : "empty", preview: null,
      error: typeof code === "string" && /^TRANSFER_[A-Z_]+$/.test(code) ? code : "TRANSFER_OPERATION_FAILED" });
    return false;
  }
  function assertContext(archive, key) {
    if (transferContextKey(archive.records[0].context) !== key) transferFail("TRANSFER_ARCHIVE_CONTEXT");
  }
  function add(record) {
    if (disposed) return false;
    const id = interrupt();
    try {
      const key = context(id, true);
      if (!owns(id)) return false;
      const archive = addTransferArchiveRecord(state.archive, record);
      if (!current(id, key)) return false;
      assertContext(archive, key);
      publish({ phase: "ready", archive, preview: null, error: null });
      return owns(id);
    } catch (error) { return fail(id, error); }
  }
  function remove(index) {
    if (disposed) return false;
    const id = interrupt();
    try {
      const key = context(id, true);
      if (!owns(id)) return false;
      if (state.archive) assertContext(state.archive, key);
      const archive = removeTransferArchiveRecord(state.archive, index);
      if (!current(id, key)) return false;
      publish({ phase: archive ? "ready" : "empty", archive, preview: null, error: null });
      return owns(id);
    } catch (error) { return fail(id, error); }
  }
  function select(index) {
    if (disposed) return null;
    const id = revision;
    try {
      const key = context(id);
      if (!owns(id)) return null;
      if (!state.archive || !Number.isInteger(index) || index < 0 || index >= state.archive.records.length) {
        transferFail("TRANSFER_ARCHIVE_INDEX");
      }
      assertContext(state.archive, key);
      return state.archive.records[index];
    } catch (error) { fail(id, error); return null; }
  }
  async function stage(file) {
    if (disposed) return false;
    const id = interrupt();
    let key, localAborter;
    try {
      key = context(id, true);
      if (!owns(id)) return false;
      publish({ phase: "loading", preview: null, error: null });
      if (!current(id, key)) return false;
      localAborter = new AbortController();
      aborter = localAborter;
      const { archive, digest } = await readTransferArchive(file, { subtle, signal: localAborter.signal });
      if (!current(id, key)) return false;
      assertContext(archive, key);
      publish({ phase: "preview", preview: Object.freeze({ id, archive, digest, authenticated: false }) });
      return owns(id);
    } catch (error) {
      if (owns(id) && (key === undefined || current(id, key))) return fail(id, error);
      return false;
    }
    finally { if (localAborter && aborter === localAborter) aborter = null; }
  }
  function apply(reviewId) {
    if (disposed) return false;
    const id = revision, pending = state.preview;
    try {
      const key = context(id);
      if (!owns(id)) return false;
      if (!pending || pending !== state.preview || pending.id !== reviewId || id !== reviewId) transferFail("TRANSFER_REVIEW_REQUIRED");
      const archive = validateTransferArchive(pending.archive);
      if (!current(id, key) || pending !== state.preview) return false;
      assertContext(archive, key);
      const applied = interrupt();
      if (!owns(applied)) return false;
      publish({ phase: "ready", archive, preview: null, error: null });
      return owns(applied);
    } catch (error) { return fail(id, error); }
  }
  async function prepare() {
    if (disposed) return null;
    const id = interrupt();
    let localAborter;
    try {
      if (!owns(id)) return null;
      const archive = state.archive;
      if (!archive) transferFail("TRANSFER_ARCHIVE_REQUIRED");
      publish({ phase: "preparing", preview: null, error: null });
      if (!owns(id) || state.archive !== archive) return null;
      localAborter = new AbortController(); aborter = localAborter;
      const download = await prepareTransferArchive(archive, { subtle, signal: localAborter.signal });
      if (!owns(id) || state.archive !== archive) return null;
      publish({ phase: "ready" });
      return owns(id) && state.archive === archive ? download : null;
    } catch (error) {
      if (owns(id)) fail(id, error);
      return null;
    }
    finally { if (localAborter && aborter === localAborter) aborter = null; }
  }
  function capture() {
    if (disposed || !state.archive) return null;
    const id = revision;
    const key = context(id);
    if (!owns(id)) return null;
    assertContext(state.archive, key);
    return state.archive;
  }
  function reviewArchive(input) {
    if (disposed) return false;
    const id = interrupt();
    try {
      const key = context(id, true);
      if (!owns(id)) return false;
      const archive = validateTransferArchive(input);
      if (!current(id, key)) return false;
      assertContext(archive, key);
      publish({ phase: "preview", preview: Object.freeze({ id, archive, digest: null, authenticated: false }), error: null });
      return owns(id);
    } catch (error) { return fail(id, error); }
  }
  function cancel() {
    if (disposed) return;
    const id = interrupt();
    if (!owns(id)) return;
    publish({ phase: state.archive ? "ready" : "empty", preview: null, error: null });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    interrupt();
    contextKey = null;
    observers.clear();
    state = Object.freeze({ phase: "disposed", archive: null, preview: null, error: null });
  }
  return Object.freeze({ get state() { return state; }, add, remove, select, stage, apply, prepare, capture, reviewArchive, cancel, suspend, invalidate, dispose });
}
