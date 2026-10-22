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
  let disposed = false;
  let current = Object.freeze({ phase: "idle", result: null, errorCode: null });
  function publish(phase, result = null, errorCode = null) {
    current = Object.freeze({ phase, result, errorCode });
    try { onChange(current); } catch { /* Observers cannot authorize a read or corrupt state. */ }
    return current;
  }
  function validFile(file) {
    if (!file || typeof file.name !== "string" || file.name.length > 255 ||
        !/\.json$/i.test(file.name) || /[\x00-\x1f\x7f]/.test(file.name)) {
      throw new HistoryFileError("FILE_NAME", "Choose a JSON file");
    }
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > HISTORY_FILE_LIMIT) {
      throw new HistoryFileError("FILE_SIZE", "File is empty or exceeds the size limit");
    }
    return { size: file.size };
  }
  async function load(file) {
    if (disposed) return current;
    const ticket = ++generation;
    publish("reading");
    try {
      const { size } = validFile(file);
      const bytes = await readBytes(file);
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
    generation++;
    return publish("cancelled");
  }
  function reset() {
    if (disposed) return current;
    generation++;
    return publish("idle");
  }
  function dispose() {
    if (disposed) return;
    generation++;
    disposed = true;
    current = Object.freeze({ phase: "disposed", result: null, errorCode: null });
  }
  return Object.freeze({ load, cancel, reset, dispose, state: () => current });
}
