import { workspaceFromDraft, workspaceDraftKey, decodeWorkspace } from "./workspace-format.js";
import { readSecurityFileText } from "./security-file.js";
import { encryptWorkspaceBackup, decryptWorkspaceBackup } from "./secure-backup-crypto.js";
import { secureBackupRunner } from "./secure-backup-runner.js";
import { inspectEncryptedBackup, backupPassphraseBytes, SECURE_BACKUP_LIMIT,
  secureFail, secureErrorCode } from "./secure-backup-format.js";

/** Stages a validated restore; has no writeDraft, provider or storage capability. */
export function createSecureBackupController({ readDraft, onStage, onChange = () => {},
  crypto = globalThis.crypto, runner = secureBackupRunner,
  readText = readSecurityFileText,
  encrypt = encryptWorkspaceBackup, decrypt = decryptWorkspaceBackup,
} = {}) {
  if (typeof readDraft !== "function" || typeof onStage !== "function") secureFail("SECURE_INTERNAL");
  let disposed = false;
  let generation = 0;
  let abort = null;
  let phase = "idle";
  let errorCode = null;
  let encryptedInput = null;
  let prepared = null;
  let restoredText = null;
  let sourceKey = null;
  let targetKey = null;
  let summary = null;
  let offered = false;
  let size = 0;

  function state() {
    return Object.freeze({ phase, errorCode, encryptedBytes: size,
      canDownload: phase === "encrypted" && !!prepared,
      canDecrypt: phase === "selected" && !!encryptedInput,
      canStage: phase === "decrypted" && !!restoredText,
      downloadOffered: offered, diskSaved: false,
      summary: summary ? Object.freeze({ ...summary }) : null });
  }
  function emit() { try { onChange(state()); } catch { /* Observers cannot alter the workflow. */ } }
  function clear() {
    encryptedInput = prepared = restoredText = sourceKey = targetKey = summary = null;
    offered = false;
    size = 0;
  }
  function stop(next = "idle") {
    generation++;
    abort?.abort();
    abort = null;
    clear();
    phase = next;
    errorCode = null;
    emit();
  }
  function begin(next) {
    if (disposed) secureFail("SECURE_DISPOSED");
    stop(next);
    abort = new AbortController();
    return { id: generation, signal: abort.signal };
  }
  const current = id => !disposed && generation === id;
  function failed(id, error, fallback) {
    if (!current(id)) return false;
    clear();
    phase = "error";
    errorCode = secureErrorCode(error, fallback);
    emit();
    return false;
  }
  function currentKey() {
    try { return workspaceDraftKey(readDraft()); }
    catch { secureFail("SECURE_CONTENT"); }
  }
  function summarize(workspace) {
    // Counts only: no accounts, balances, tokens, filenames or passwords in state.
    const text = JSON.stringify(workspace);
    return { cards: 3, plaintextBytes: new TextEncoder().encode(text).length };
  }
  async function seal(passphrase, confirmation) {
    const operation = begin("encrypting");
    try {
      if (passphrase !== confirmation) secureFail("SECURE_MISMATCH");
      backupPassphraseBytes(passphrase).fill(0);
      const draft = readDraft();
      const capturedKey = workspaceDraftKey(draft);
      const workspace = workspaceFromDraft(draft);
      const result = await runner.run(guard => encrypt(workspace, passphrase, { crypto, guard }), operation);
      if (!current(operation.id)) return false;
      if (currentKey() !== capturedKey) secureFail("SECURE_STALE");
      inspectEncryptedBackup(result.text);
      prepared = result;
      sourceKey = capturedKey;
      size = result.byteLength;
      phase = "encrypted";
      emit();
      return true;
    } catch (error) { return failed(operation.id, error, "SECURE_CONTENT"); }
    finally { passphrase = confirmation = undefined; }
  }
  async function select(file) {
    const operation = begin("reading");
    try {
      const text = await readText(file, { maxBytes: SECURE_BACKUP_LIMIT, signal: operation.signal });
      if (!current(operation.id)) return false;
      const result = inspectEncryptedBackup(text);
      encryptedInput = text;
      size = result.byteLength;
      phase = "selected";
      emit();
      return true;
    } catch (error) { return failed(operation.id, error, "SECURE_READ"); }
  }
  async function unlock(passphrase) {
    if (disposed) return false;
    if (phase !== "selected" || !encryptedInput) {
      errorCode = "SECURE_NOT_READY";
      emit();
      return false;
    }
    const text = encryptedInput;
    const operation = begin("decrypting");
    try {
      backupPassphraseBytes(passphrase).fill(0);
      const capturedKey = currentKey();
      const result = await runner.run(guard => decrypt(text, passphrase, { crypto, guard }), operation);
      if (!current(operation.id)) return false;
      if (currentKey() !== capturedKey) secureFail("SECURE_STALE");
      const workspace = decodeWorkspace(result.text);
      restoredText = result.text;
      targetKey = capturedKey;
      summary = summarize(workspace);
      phase = "decrypted";
      emit();
      return true;
    } catch (error) { return failed(operation.id, error, "SECURE_CONTENT"); }
    finally { passphrase = undefined; }
  }
  function offer(download) {
    if (disposed) return false;
    const id = generation;
    try {
      if (phase !== "encrypted" || !prepared) secureFail("SECURE_NOT_READY");
      if (currentKey() !== sourceKey) secureFail("SECURE_STALE");
      if (typeof download !== "function") secureFail("SECURE_DOWNLOAD");
      const result = download(prepared);
      if (result && typeof result.then === "function") {
        // Downloads must synchronously start in the explicit user click handler.
        Promise.resolve(result).catch(() => {});
        secureFail("SECURE_DOWNLOAD");
      }
      if (!current(id)) return false;
      offered = true;
      emit();
      return true;
    } catch (error) { return failed(generation, error, "SECURE_DOWNLOAD"); }
  }
  function stage() {
    if (disposed) return false;
    if (phase === "staging") return false;
    const id = generation;
    try {
      if (phase !== "decrypted" || !restoredText) secureFail("SECURE_NOT_READY");
      if (currentKey() !== targetKey) secureFail("SECURE_STALE");
      const text = restoredText;
      // Consume first, so a reentrant observer cannot stage a second time.
      clear();
      phase = "staging";
      if (onStage(text) !== true) secureFail("SECURE_STAGE");
      if (!current(id)) return false;
      phase = "staged";
      emit();
      return true;
    } catch (error) { return failed(generation, error, "SECURE_STAGE"); }
  }
  function encryptedText() {
    if (disposed || phase !== "encrypted" || !prepared) secureFail("SECURE_NOT_READY");
    if (currentKey() !== sourceKey) secureFail("SECURE_STALE");
    return prepared.text;
  }
  function selectText(text) {
    if (disposed) return false;
    const id = generation + 1;
    stop("reading");
    if (!current(id)) return false;
    try {
      const result = inspectEncryptedBackup(text);
      if (!current(id)) return false;
      encryptedInput = text;
      size = result.byteLength;
      phase = "selected";
      emit();
      return true;
    } catch (error) { return failed(id, error, "SECURE_READ"); }
  }
  return Object.freeze({ state, seal, select, selectText, encryptedText, unlock, offer, stage,
    cancel() { if (!disposed) stop("cancelled"); },
    invalidate() { if (!disposed) stop("idle"); },
    dispose() { if (!disposed) { disposed = true; stop("disposed"); } },
  });
}
