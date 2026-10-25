import { workspaceFromDraft, workspaceDraftKey, decodeWorkspace } from "./workspace-format.js";
import { readSecurityFileText } from "./security-file.js";
import { encryptWorkspaceBackup, decryptWorkspaceBackup } from "./secure-backup-crypto.js";
import { secureBackupRunner } from "./secure-backup-runner.js";
import { createSecureDeadline } from "./secure-deadline.js";
import { inspectEncryptedBackup, backupPassphraseBytes, SECURE_BACKUP_LIMIT,
  SECURE_BACKUP_FILENAME, secureFail, secureErrorCode } from "./secure-backup-format.js";

// Backend objects must not retain mutable metadata or invoke accessors on use.
function resultText(value) {
  if (!value || typeof value !== "object") secureFail("SECURE_CONTENT");
  const field = Object.getOwnPropertyDescriptor(value, "text");
  if (!field || !("value" in field) || typeof field.value !== "string") secureFail("SECURE_CONTENT");
  return field.value;
}
function preparedResult(value) {
  const text = resultText(value);
  const inspected = inspectEncryptedBackup(text);
  return Object.freeze({ text, byteLength: inspected.byteLength,
    filename: SECURE_BACKUP_FILENAME, mimeType: "application/json;charset=utf-8" });
}
function observe(value) {
  // A rejected async UI callback must not become an unhandled rejection.
  try { Promise.resolve(value).catch(() => {}); } catch {}
}

/** Stages a validated restore; has no provider, writeDraft or storage capability. */
export function createSecureBackupController({ readDraft, onStage, onChange = () => {},
  crypto = globalThis.crypto, runner = secureBackupRunner, readText = readSecurityFileText,
  encrypt = encryptWorkspaceBackup, decrypt = decryptWorkspaceBackup,
  resultLifetimeMs = 120_000, lifetimeOptions = {},
} = {}) {
  if (![readDraft, onStage, onChange, readText, encrypt, decrypt].every(fn => typeof fn === "function") ||
      typeof runner?.run !== "function") secureFail("SECURE_INTERNAL");
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
  let offering = false;
  let size = 0;
  let emitting = false;
  const lifetime = createSecureDeadline({ ...lifetimeOptions, timeoutMs: resultLifetimeMs,
    timeoutCode: "SECURE_EXPIRED", onExpire(code) {
      if (disposed) return;
      const id = generation;
      failed(id, { code }, code);
    } });
  const current = id => !disposed && generation === id;
  const readyPhase = () => ["encrypted", "selected", "decrypted"].includes(phase);
  function validLifetime() { return !readyPhase() || lifetime.check(); }
  function snapshot() {
    return Object.freeze({ phase, errorCode, encryptedBytes: size,
      canDownload: phase === "encrypted" && !!prepared && !offering,
      canDecrypt: phase === "selected" && !!encryptedInput,
      canStage: phase === "decrypted" && !!restoredText,
      downloadOffered: offered, diskSaved: false,
      summary: summary ? Object.freeze({ ...summary }) : null });
  }
  function state() { validLifetime(); return snapshot(); }
  function emit() {
    if (emitting) return;
    emitting = true;
    try { observe(onChange(snapshot())); } catch {}
    finally { emitting = false; }
  }
  function clear() {
    encryptedInput = prepared = restoredText = sourceKey = targetKey = summary = null;
    offered = false;
    offering = false;
    size = 0;
    // Remove candidate access before calling the timer adapter. Reentrant
    // actions must never retrieve the old candidate during cleanup.
    lifetime.clear();
  }
  function transition(next, createAbort = false) {
    const id = ++generation;
    const old = abort;
    abort = createAbort ? new AbortController() : null;
    const signal = abort?.signal;
    phase = next;
    errorCode = null;
    clear();
    old?.abort();
    if (generation === id) emit();
    return { id, signal };
  }
  function begin(next) {
    if (disposed) secureFail("SECURE_DISPOSED");
    return transition(next, true);
  }
  function failed(id, error, fallback) {
    if (!current(id)) return false;
    const code = secureErrorCode(error, fallback);
    if (!current(id)) return false;
    phase = "error";
    errorCode = code;
    clear();
    if (current(id)) emit();
    return false;
  }
  function currentKey() {
    try { return workspaceDraftKey(readDraft()); }
    catch { secureFail("SECURE_CONTENT"); }
  }
  function requireCurrent(id) {
    if (!current(id)) secureFail("SECURE_CANCELLED");
  }
  function requireReady(id) {
    requireCurrent(id);
    if (!validLifetime()) secureFail(errorCode ?? "SECURE_EXPIRED");
    requireCurrent(id);
  }
  function publishReady(id, next) {
    requireCurrent(id);
    phase = next;
    if (!lifetime.arm()) return failed(id, null, lifetime.state().fault ?? "SECURE_EXPIRED");
    if (!current(id) || phase !== next) return false;
    emit();
    return current(id) && phase === next && validLifetime();
  }
  async function seal(passphrase, confirmation) {
    const operation = begin("encrypting");
    try {
      requireCurrent(operation.id);
      if (passphrase !== confirmation) secureFail("SECURE_MISMATCH");
      backupPassphraseBytes(passphrase).fill(0);
      const draft = readDraft();
      requireCurrent(operation.id);
      const capturedKey = workspaceDraftKey(draft);
      const workspace = workspaceFromDraft(draft);
      requireCurrent(operation.id);
      const result = await runner.run(guard => {
        requireCurrent(operation.id);
        return encrypt(workspace, passphrase, { crypto, guard });
      }, operation);
      requireCurrent(operation.id);
      const key = currentKey();
      requireCurrent(operation.id);
      if (key !== capturedKey) secureFail("SECURE_STALE");
      const candidate = preparedResult(result);
      requireCurrent(operation.id);
      prepared = candidate;
      sourceKey = capturedKey;
      size = candidate.byteLength;
      return publishReady(operation.id, "encrypted");
    } catch (error) { return failed(operation.id, error, "SECURE_CONTENT"); }
    finally { passphrase = confirmation = undefined; }
  }
  async function select(file) {
    const operation = begin("reading");
    try {
      requireCurrent(operation.id);
      const text = await readText(file, { maxBytes: SECURE_BACKUP_LIMIT, signal: operation.signal });
      requireCurrent(operation.id);
      const result = inspectEncryptedBackup(text);
      encryptedInput = text;
      size = result.byteLength;
      return publishReady(operation.id, "selected");
    } catch (error) { return failed(operation.id, error, "SECURE_READ"); }
  }
  async function unlock(passphrase) {
    if (disposed) return false;
    if (!validLifetime()) return false;
    if (phase !== "selected" || !encryptedInput) {
      errorCode = "SECURE_NOT_READY";
      emit();
      return false;
    }
    const text = encryptedInput;
    const operation = begin("decrypting");
    try {
      requireCurrent(operation.id);
      backupPassphraseBytes(passphrase).fill(0);
      const capturedKey = currentKey();
      requireCurrent(operation.id);
      const result = await runner.run(guard => {
        requireCurrent(operation.id);
        return decrypt(text, passphrase, { crypto, guard });
      }, operation);
      requireCurrent(operation.id);
      const key = currentKey();
      requireCurrent(operation.id);
      if (key !== capturedKey) secureFail("SECURE_STALE");
      const candidate = resultText(result);
      const workspace = decodeWorkspace(candidate);
      requireCurrent(operation.id);
      restoredText = candidate;
      targetKey = capturedKey;
      summary = { cards: 3, plaintextBytes: new TextEncoder().encode(JSON.stringify(workspace)).length };
      return publishReady(operation.id, "decrypted");
    } catch (error) { return failed(operation.id, error, "SECURE_CONTENT"); }
    finally { passphrase = undefined; }
  }
  function offer(download) {
    if (disposed || offering) return false;
    const id = generation;
    try {
      requireReady(id);
      if (phase !== "encrypted" || !prepared) secureFail("SECURE_NOT_READY");
      const key = currentKey();
      requireReady(id);
      if (key !== sourceKey) secureFail("SECURE_STALE");
      if (typeof download !== "function") secureFail("SECURE_DOWNLOAD");
      offering = true;
      const result = download(prepared);
      if (result && typeof result.then === "function") {
        observe(result);
        secureFail("SECURE_DOWNLOAD");
      }
      if (result === false) secureFail("SECURE_DOWNLOAD");
      requireReady(id);
      offering = false;
      offered = true;
      emit();
      return current(id) && phase === "encrypted";
    } catch (error) { return failed(id, error, "SECURE_DOWNLOAD"); }
    finally { if (current(id)) offering = false; }
  }
  function stage() {
    if (disposed || phase === "staging") return false;
    const id = generation;
    try {
      requireReady(id);
      if (phase !== "decrypted" || !restoredText) secureFail("SECURE_NOT_READY");
      const key = currentKey();
      requireReady(id);
      if (key !== targetKey) secureFail("SECURE_STALE");
      const text = restoredText;
      phase = "staging";
      clear();
      requireCurrent(id);
      const result = onStage(text);
      if (result !== true) { observe(result); secureFail("SECURE_STAGE"); }
      requireCurrent(id);
      phase = "staged";
      emit();
      return current(id) && phase === "staged";
    } catch (error) { return failed(id, error, "SECURE_STAGE"); }
  }
  function encryptedText() {
    if (disposed) secureFail("SECURE_NOT_READY");
    const id = generation;
    requireReady(id);
    if (phase !== "encrypted" || !prepared) secureFail("SECURE_NOT_READY");
    const key = currentKey();
    requireReady(id);
    if (key !== sourceKey) secureFail("SECURE_STALE");
    return prepared.text;
  }
  function selectText(text) {
    if (disposed) return false;
    const operation = begin("reading");
    try {
      requireCurrent(operation.id);
      const result = inspectEncryptedBackup(text);
      requireCurrent(operation.id);
      encryptedInput = text;
      size = result.byteLength;
      return publishReady(operation.id, "selected");
    } catch (error) { return failed(operation.id, error, "SECURE_READ"); }
  }
  return Object.freeze({ state, seal, select, selectText, encryptedText, unlock, offer, stage,
    cancel() { if (!disposed) transition("cancelled"); },
    invalidate() { if (!disposed) transition("idle"); },
    dispose() { if (!disposed) { disposed = true; transition("disposed"); lifetime.dispose(); } },
  });
}
