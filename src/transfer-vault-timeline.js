import { transferFail } from "./transfer-codec.js";
import { validateVaultBundle, vaultKey } from "./transfer-vault-model.js";

export const VAULT_UNDO_LIMIT = 5;
export const VAULT_UNDO_BYTES = 24 * 1024 * 1024;
const sources = ["cards", "file", "legacy", "stored"];
const encoder = new TextEncoder();

/** Volatile undo history for the offline copy, never a storage rollback. */
export function createVaultTimeline({ maxEntries = VAULT_UNDO_LIMIT, maxBytes = VAULT_UNDO_BYTES } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > VAULT_UNDO_LIMIT ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > VAULT_UNDO_BYTES) {
    transferFail("TRANSFER_VAULT_UNDO_OPTIONS");
  }
  let undo = [], redo = [], truncated = false;
  const bytes = () => [...undo, ...redo].reduce((sum, entry) => sum + entry.bytes, 0);
  function describe() {
    return Object.freeze({ undoCount: undo.length, redoCount: redo.length, bytes: bytes(),
      truncated, nextUndoSource: undo.at(-1)?.source ?? null, nextRedoSource: redo.at(-1)?.source ?? null });
  }
  function record(beforeInput, afterInput, source) {
    if (!sources.includes(source)) transferFail("TRANSFER_VAULT_UNDO_SOURCE");
    const before = validateVaultBundle(beforeInput), after = validateVaultBundle(afterInput);
    const beforeKey = vaultKey(before), afterKey = vaultKey(after);
    if (beforeKey === afterKey) return describe();
    if (undo.length && undo.at(-1).afterKey !== beforeKey) transferFail("TRANSFER_VAULT_UNDO_STALE");
    if (redo.length && redo.at(-1).beforeKey !== beforeKey) transferFail("TRANSFER_VAULT_UNDO_STALE");
    const entry = Object.freeze({ before, after, beforeKey, afterKey, source,
      bytes: encoder.encode(beforeKey).byteLength + encoder.encode(afterKey).byteLength });
    redo = [];
    if (entry.bytes > maxBytes) {
      undo = [];
      truncated = true;
      return describe();
    }
    undo.push(entry);
    while (undo.length > maxEntries || bytes() > maxBytes) { undo.shift(); truncated = true; }
    return describe();
  }
  function back(current) {
    const key = vaultKey(current), entry = undo.at(-1);
    if (!entry) transferFail("TRANSFER_VAULT_UNDO_EMPTY");
    if (key !== entry.afterKey) transferFail("TRANSFER_VAULT_UNDO_STALE");
    undo.pop();
    redo.push(entry);
    return entry.before;
  }
  function forward(current) {
    const key = vaultKey(current), entry = redo.at(-1);
    if (!entry) transferFail("TRANSFER_VAULT_UNDO_EMPTY");
    if (key !== entry.beforeKey) transferFail("TRANSFER_VAULT_UNDO_STALE");
    redo.pop();
    undo.push(entry);
    return entry.after;
  }
  function clear() {
    undo = [];
    redo = [];
    truncated = false;
  }
  return Object.freeze({ describe, record, back, forward, clear });
}
