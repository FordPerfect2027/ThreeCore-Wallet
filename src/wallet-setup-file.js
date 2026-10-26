import { readSecurityFileBytes } from "./security-file.js";
import { createStateNotifier } from "./state-notifier.js";
import { readOwnErrorCode } from "./provider-error.js";
import { decodeWalletSetup, encodeWalletSetup, WALLET_SETUP_LIMIT, WalletSetupError } from "./wallet-setup.js";

export const WALLET_SETUP_FILE_LIMIT = WALLET_SETUP_LIMIT * 4;
const fail = code => { throw new WalletSetupError(code); };
const FILE_ERRORS = new Set(["SETUP_FILENAME", "SETUP_SIZE", "SETUP_ENCODING", "SETUP_FILE",
  "SETUP_JSON", "SETUP_SCHEMA", "SETUP_SHAPE", "SETUP_ROWS", "SETUP_AGENT", "SETUP_ADDRESS",
  "SETUP_CHAIN", "SETUP_DUPLICATE"]);

export function prepareWalletSetupFile(plan) {
  const text = encodeWalletSetup(plan);
  return Object.freeze({ text, byteLength: new TextEncoder().encode(text).byteLength,
    filename: "ThreeCore-wallet-settings.json", mimeType: "application/json;charset=utf-8" });
}

export function decodeWalletSetupBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > WALLET_SETUP_FILE_LIMIT) fail("SETUP_SIZE");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("SETUP_ENCODING"); }
  return encodeWalletSetup(decodeWalletSetup(text));
}

/** Cancel superseded file reads; no filesystem paths or wallet access here. */
export function createWalletSetupFileReader({ readBytes = readSecurityFileBytes,
  onChange = () => {} } = {}) {
  let generation = 0;
  let readAbort = null;
  let aborting = false;
  let stopping = false;
  function abortRead() {
    const previous = readAbort;
    readAbort = null;
    if (!previous) return;
    aborting = true;
    try { previous.abort(); } finally { aborting = false; }
  }
  let disposed = false;
  const current = id => !disposed && id === generation;
  let state = Object.freeze({ phase: "idle", text: null, errorCode: null });
  // Deduplication sees only status and revision, never imported account data.
  const notifications = createStateNotifier({
    observers: new Set([() => {
      if (disposed) return;
      const previous = stopping;
      stopping ||= state.phase === "idle";
      try { return onChange(state); } finally { stopping = previous; }
    }]),
    read: () => ({ generation, phase: state.phase }),
  });
  function publish(phase, text = null, errorCode = null) {
    state = Object.freeze({ phase, text, errorCode });
    notifications.notify();
  }
  return Object.freeze({
    state: () => state,
    async load(file) {
      if (disposed || aborting || stopping) return false;
      const id = ++generation;
      state = Object.freeze({ phase: "reading", text: null, errorCode: null });
      abortRead();
      if (!current(id)) return false;
      const activeRead = new AbortController();
      readAbort = activeRead;
      publish("reading");
      try {
        if (disposed || id !== generation) return false;
        const name = file?.name;
        if (!current(id)) return false;
        if (typeof name !== "string" || name.length > 240 ||
            !/\.json$/i.test(name) || /[\\/\u0000-\u001f\u007f]/.test(name)) fail("SETUP_FILENAME");
        const size = file.size;
        if (!Number.isSafeInteger(size) || size < 1 || size > WALLET_SETUP_FILE_LIMIT) fail("SETUP_SIZE");
        if (!current(id)) return false;
        const bytes = await readBytes(file, { maxBytes: WALLET_SETUP_FILE_LIMIT, signal: activeRead.signal });
        if (disposed || id !== generation) return false;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) fail("SETUP_SIZE");
        const text = decodeWalletSetupBytes(bytes);
        publish("ready", text);
        return current(id);
      } catch (error) {
        if (disposed || id !== generation) return false;
        const code = readOwnErrorCode(error);
        if (!current(id)) return false;
        publish("error", null, FILE_ERRORS.has(code) ? code : "SETUP_FILE");
        return false;
      }
    },
    cancel() {
      if (disposed || stopping) return;
      stopping = true;
      const id = ++generation;
      state = Object.freeze({ phase: "idle", text: null, errorCode: null });
      try {
        abortRead();
        if (current(id)) notifications.notify();
      } finally { stopping = false; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      state = Object.freeze({ phase: "disposed", text: null, errorCode: null });
      abortRead();
    },
  });
}
