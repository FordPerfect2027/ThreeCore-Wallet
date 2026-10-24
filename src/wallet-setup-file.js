import { readSecurityFileBytes } from "./security-file.js";
import { decodeWalletSetup, encodeWalletSetup, WALLET_SETUP_LIMIT, WalletSetupError } from "./wallet-setup.js";

export const WALLET_SETUP_FILE_LIMIT = WALLET_SETUP_LIMIT * 4;
const fail = code => { throw new WalletSetupError(code); };

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
  function abortRead() { readAbort?.abort(); readAbort = null; }
  let disposed = false;
  let state = Object.freeze({ phase: "idle", text: null, errorCode: null });
  function publish(phase, text = null, errorCode = null) {
    state = Object.freeze({ phase, text, errorCode });
    onChange(state);
  }
  return Object.freeze({
    state: () => state,
    async load(file) {
      if (disposed) return false;
      const id = ++generation;
      abortRead();
      const activeRead = new AbortController();
      readAbort = activeRead;
      publish("reading");
      try {
        if (disposed || id !== generation) return false;
        if (!file || typeof file.name !== "string" || file.name.length > 240 ||
            !/\.json$/i.test(file.name) || /[\\/\u0000-\u001f\u007f]/.test(file.name)) fail("SETUP_FILENAME");
        const size = file.size;
        if (!Number.isSafeInteger(size) || size < 1 || size > WALLET_SETUP_FILE_LIMIT) fail("SETUP_SIZE");
        const bytes = await readBytes(file, { maxBytes: WALLET_SETUP_FILE_LIMIT, signal: activeRead.signal });
        if (disposed || id !== generation) return false;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) fail("SETUP_SIZE");
        const text = decodeWalletSetupBytes(bytes);
        publish("ready", text);
        return true;
      } catch (error) {
        if (disposed || id !== generation) return false;
        publish("error", null, error instanceof WalletSetupError ? error.code : "SETUP_FILE");
        return false;
      }
    },
    cancel() { if (!disposed) { generation++; abortRead(); publish("idle"); } },
    dispose() { generation++; abortRead(); disposed = true; },
  });
}
