import { createCheckpointStorage } from "/src/checkpoint-storage.js";
import { createEncryptedLibraryStorage } from "/src/encrypted-library-storage.js";
import { createPeriodLibraryStorage } from "/src/period-library-storage.js";
import { createReportHistoryStorage } from "/src/report-history-storage.js";
import { createVaultStorage } from "/src/transfer-vault-storage.js";
import { createStorageGuard } from "/src/storage-guard.js";
import { emptyEncryptedLibrary, prepareLibraryEntry } from "/src/encrypted-library-model.js";
import { backupHeader, prepareEncryptedEnvelope } from "/src/secure-backup-format.js";
import { saveOperation as periodSave, checkpoint } from "/test/helpers/period-library-fixtures.js";
import { saveHistory } from "/test/helpers/report-history-fixtures.js";
import { saveOperation as vaultSave } from "/test/helpers/vault-fixtures.js";

export const assert = (condition, message = "assertion failed") => { if (!condition) throw Error(message); };
export const same = (a, b, message = "values differ") => assert(JSON.stringify(a) === JSON.stringify(b), message);
export const copy = value => structuredClone(value);
export const outcome = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, code: error?.code }));
export const pause = () => new Promise(resolve => setTimeout(resolve, 0));
export const id = number => "10000000-0000-4000-8000-" + String(number).padStart(12, "0");
export const save = (number = 1, label = "DAT / EMA / CAWELON — synthetic") => ({
  kind: "save", id: id(number), label, time: "2026-10-25T00:00:00.000Z", fileText: "{}",
});

export async function waitFor(check, message = "native storage did not settle") {
  const started = performance.now();
  while (!check()) {
    if (performance.now() - started > 10000) throw Error(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** Synthetic documents only. The encrypted fixture is format data, not a claim
 * that a fabricated ciphertext can be decrypted into a wallet backup. */
export const formats = [
  { key: "workspace", create: createCheckpointStorage, operation: number => save(number), expected: document => document.revision },
  { key: "encrypted", create: createEncryptedLibraryStorage, async operation(number = 1) {
    const envelope = prepareEncryptedEnvelope(backupHeader(new Uint8Array(16).fill(number),
      new Uint8Array(12).fill(number)), new Uint8Array(32).fill(number));
    return { kind: "add", entry: await prepareLibraryEntry(envelope.text) };
  }, expected: document => document, empty: emptyEncryptedLibrary },
  { key: "period", create: createPeriodLibraryStorage, operation: number => periodSave(number, checkpoint(number + 1)), expected: document => document.revision },
  { key: "report", create: createReportHistoryStorage, operation: number => saveHistory(number), expected: document => document.revision },
  { key: "vault", create: createVaultStorage, operation: number => vaultSave(undefined, number), expected: document => document.revision },
];
export function translated(format, code) {
  if (format.key !== "encrypted") return code;
  return ({ CHECKPOINT_CANCELLED: "LIBRARY_CANCELLED", CHECKPOINT_TIMEOUT: "LIBRARY_TIMEOUT",
    CHECKPOINT_STALE: "LIBRARY_STALE", CHECKPOINT_BUSY: "LIBRARY_BUSY", CHECKPOINT_CLOSED: "LIBRARY_CLOSED",
    CHECKPOINT_ADAPTER: "LIBRARY_FORMAT", CHECKPOINT_SCHEMA: "LIBRARY_FORMAT" })[code] ?? code;
}

const PREFIX = "threecore-storage-guard-test-";
const owned = new Set();

function assertOwned(name) {
  assert(typeof name === "string" && name.startsWith(PREFIX) && owned.has(name), "test database not owned");
}

export function deleteOwnedDatabase(name) {
  assertOwned(name);
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => { owned.delete(name); resolve(); };
    request.onerror = () => reject(Error("test database cleanup failed"));
    request.onblocked = () => reject(Error("test database cleanup blocked"));
  });
}

/** Direct reads/seed writes only ever target names created by this fixture.
 * No production database enumeration, localStorage inspection or account use. */
export async function rawDocument(name, change) {
  assertOwned(name);
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("checkpoints");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("checkpoints", change ? "readwrite" : "readonly");
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? Error("fixture transaction aborted"));
      const store = tx.objectStore("checkpoints");
      const get = store.get("current");
      get.onsuccess = () => {
        result = get.result;
        if (change) { result = change(result); store.put(result, "current"); }
      };
    });
  } finally { db.close(); }
}

export function createNativeFixture() {
  const guard = createStorageGuard();
  const names = new Set();
  const adapters = new Set();
  const disposers = [];
  let disposed = false;
  function name() {
    assert(!disposed, "fixture disposed");
    const value = PREFIX + crypto.randomUUID();
    owned.add(value);
    names.add(value);
    return value;
  }
  function storage(format = formats[0], options = {}) {
    const selected = options.name ?? name();
    assertOwned(selected);
    const value = format.create({ guard, ...options, name: selected });
    adapters.add(value);
    return { name: selected, value, format };
  }
  return { guard, name, storage, cleanup(work) { disposers.push(work); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const work of disposers.reverse()) await work();
      for (const adapter of adapters) adapter.close();
      guard.dispose();
      await waitFor(() => guard.state().active === 0);
      for (const value of names) await deleteOwnedDatabase(value);
    },
  };
}

export async function nativeFixture(action) {
  const f = createNativeFixture();
  try { return await action(f); }
  finally { await f.dispose(); }
}

export function virtualDeadline(start = 100) {
  let now = start;
  let next = 0;
  const timers = new Map();
  return {
    options: {
      now: () => now,
      schedule: (callback, delay) => { const key = ++next; timers.set(key, { callback, at: now + delay }); return key; },
      unschedule: key => timers.delete(key),
    },
    advance: value => { now += value; },
    set: value => { now = value; },
    flush() {
      for (const [key, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(key); timer.callback(); }
      }
    },
    pending: () => timers.size,
  };
}

/** A gate delays delivery of an actual IDB open event, not the transaction.
 * It lets tests cancel while native work is already underway. */
export function openGate() {
  const pending = [];
  let opens = 0;
  const factory = { open(name, version) {
    assertOwned(name);
    opens++;
    const native = indexedDB.open(name, version);
    const facade = { result: null, error: null, transaction: null };
    native.onupgradeneeded = () => {
      facade.result = native.result;
      facade.transaction = native.transaction;
      facade.onupgradeneeded?.();
    };
    native.onblocked = () => facade.onblocked?.();
    native.onerror = () => { facade.error = native.error; facade.onerror?.(); };
    native.onsuccess = () => {
      facade.result = native.result;
      pending.push(() => facade.onsuccess?.());
    };
    return facade;
  } };
  return { factory, get opens() { return opens; }, get ready() { return pending.length; },
    release() { for (const deliver of pending.splice(0)) deliver(); } };
}
