import { decodeHistoryFileBytes, HistoryFileError, HISTORY_FILE_LIMIT } from "./history-file.js";

/**
 * File reading is asynchronous and never mutates a history collection.
 * A generation ticket prevents an old read from replacing newer input.
 * Readers are injected for browser use and deterministic tests.
 */
export function createHistoryFileReader({ agent, readBytes, onChange = () => {} }) {
  if (typeof readBytes !== "function" || typeof onChange !== "function") {
    throw new TypeError("Explicit reader and callback functions are required");
  }
  let generation = 0;
  let readAbort = null;
  let aborting = false;
  function abortRead() {
    const previous = readAbort;
    readAbort = null;
    if (!previous) return;
    aborting = true;
    try { previous.abort(); } finally { aborting = false; }
  }
  let disposed = false;
  let current = Object.freeze({ phase: "idle", result: null, errorCode: null });
  function publish(phase, result = null, errorCode = null) {
    current = Object.freeze({ phase, result, errorCode });
    try { onChange(current); } catch { /* Observers cannot authorize a read or corrupt state. */ }
    return current;
  }
  function validFile(file) {
    const name = file?.name;
    if (typeof name !== "string" || name.length > 255 ||
        !/\.json$/i.test(name) || /[\x00-\x1f\x7f]/.test(name)) {
      throw new HistoryFileError("FILE_NAME", "Choose a JSON file");
    }
    const size = file.size;
    if (!Number.isSafeInteger(size) || size < 1 || size > HISTORY_FILE_LIMIT) {
      throw new HistoryFileError("FILE_SIZE", "File is empty or exceeds the size limit");
    }
    return { size };
  }
  async function load(file) {
    if (disposed || aborting) return current;
    const ticket = ++generation;
    abortRead();
    if (disposed || ticket !== generation) return current;
    const activeRead = new AbortController();
    readAbort = activeRead;
    publish("reading");
    try {
      if (disposed || ticket !== generation) return current;
      const { size } = validFile(file);
      if (disposed || ticket !== generation) return current;
      const bytes = await readBytes(file, { maxBytes: HISTORY_FILE_LIMIT, signal: activeRead.signal });
      if (disposed || ticket !== generation) return current;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) {
        throw new HistoryFileError("FILE_SIZE", "The file length changed during reading");
      }
      const result = decodeHistoryFileBytes(bytes, agent);
      if (disposed || ticket !== generation) return current;
      return publish("ready", result);
    } catch (error) {
      if (disposed || ticket !== generation) return current;
      const known = ["FILE_NAME", "FILE_SIZE", "FILE_ENCODING", "AGENT_MISMATCH", "INVALID_AGENT"];
      return publish("error", null, known.includes(error?.code) ? error.code : "INVALID_FILE");
    }
  }
  function cancel() {
    if (disposed) return current;
    const ticket = ++generation;
    abortRead();
    return disposed || ticket !== generation ? current : publish("cancelled");
  }
  function reset() {
    if (disposed) return current;
    const ticket = ++generation;
    abortRead();
    return disposed || ticket !== generation ? current : publish("idle");
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    current = Object.freeze({ phase: "disposed", result: null, errorCode: null });
    abortRead();
  }
  return Object.freeze({ load, cancel, reset, dispose, state: () => current });
}
