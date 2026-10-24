import { EncryptedLibraryError, libraryFail, libraryErrorCode, libraryId,
  prepareLibraryEntry, verifyEncryptedLibrary, sameEncryptedLibrary,
  encryptedLibrarySummary, mutateEncryptedLibrary } from "./encrypted-library-model.js";
import { createEncryptedLibraryStorage, encryptedLibraryStorageError } from "./encrypted-library-storage.js";
import { SECURE_BACKUP_FILENAME } from "./secure-backup-format.js";
import { readSecurityFileText } from "./security-file.js";
import { decodeEncryptedArchive, prepareEncryptedArchive, describeLibraryMerge,
  ENCRYPTED_ARCHIVE_LIMIT } from "./encrypted-library-archive.js";

/** Ciphertext-only workflow. It has no password, decrypt, wallet or network capability. */
export function createEncryptedLibraryController({
  storage = createEncryptedLibraryStorage(), crypto = globalThis.crypto,
  now = Date.now, onChange = () => {}, onOpen = () => false,
  deadlineMs = 30000, reviewLifetimeMs = 60000, readText = readSecurityFileText,
} = {}) {
  if (!storage || ![storage.read, storage.change, storage.close, now, onChange, onOpen, readText]
    .every(value => typeof value === "function") ||
    !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000 ||
    !Number.isSafeInteger(reviewLifetimeMs) || reviewLifetimeMs < 1 || reviewLifetimeMs > 60000) {
    libraryFail("LIBRARY_INTERNAL");
  }
  let document = null, summary = null, review = null, selected = null, exported = null;
  let disposed = false, phase = "idle", errorCode = null, generation = 0, sequence = 0;
  let operation = null, expiry = null, result = null;
  const busyPhases = ["loading", "preparing", "committing", "opening", "exporting"];

  function state() {
    return Object.freeze({ phase, errorCode, selected, result,
      busy: busyPhases.includes(phase), loaded: document !== null,
      summary, review: review ? Object.freeze({ ticket: review.ticket, kind: review.kind,
        id: review.id, bytes: review.entry?.bytes ?? review.bytes,
        expiresAt: review.expiresAt, duplicate: review.duplicate ?? false,
        merge: review.merge ?? null }) : null,
      canExport: !!exported, disposed });
  }
  function emit() { try { onChange(state()); } catch {} }
  function clearReview() {
    clearTimeout(expiry);
    expiry = null;
    review = exported = null;
  }
  function clearDocument() { document = summary = null; selected = null; }
  function remember(value) {
    document = value;
    summary = encryptedLibrarySummary(value);
    if (!document.entries.some(entry => entry.id === selected)) selected = null;
  }
  const current = id => !disposed && generation === id;
  function clock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 1) libraryFail("LIBRARY_REVIEW");
    return value;
  }
  function cancel() {
    if (disposed) return;
    generation++;
    const prior = operation;
    operation = null;
    prior?.abort.abort();
    clearReview();
    clearDocument();
    errorCode = null;
    result = null;
    phase = "cancelled";
    emit();
  }
  async function run(next, work) {
    if (disposed || operation) return false;
    clearReview();
    errorCode = result = null;
    phase = next;
    const id = ++generation;
    const abort = new AbortController();
    const active = { id, abort };
    operation = active;
    let timer;
    let removeAbort;
    // A synchronous observer can cancel before a storage/crypto request starts.
    emit();
    const valid = () => current(id) && !abort.signal.aborted;
    try {
      if (!valid()) return false;
      const interrupted = new Promise((resolve, reject) => {
        const onAbort = () => reject(new EncryptedLibraryError("LIBRARY_CANCELLED"));
        abort.signal.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => abort.signal.removeEventListener("abort", onAbort);
        timer = setTimeout(() => {
          reject(new EncryptedLibraryError("LIBRARY_TIMEOUT"));
          abort.abort();
        }, deadlineMs);
      });
      await Promise.race([work({ valid, signal: abort.signal }), interrupted]);
      if (!valid()) return false;
      return true;
    } catch (error) {
      if (!current(id)) return false;
      clearReview();
      clearDocument();
      phase = "error";
      errorCode = libraryErrorCode(error instanceof EncryptedLibraryError
        ? error : encryptedLibraryStorageError(error));
      return false;
    } finally {
      clearTimeout(timer);
      removeAbort?.();
      if (operation === active) operation = null;
      if (current(id)) emit();
    }
  }
  async function read(valid) {
    const value = await storage.read({ signal: operation?.abort.signal });
    if (!valid()) libraryFail("LIBRARY_CANCELLED");
    return verifyEncryptedLibrary(value, { crypto, guard: valid });
  }
  function setReview(value) {
    const createdAt = clock();
    review = Object.freeze({ ...value, ticket: ++sequence, createdAt,
      expiresAt: createdAt + reviewLifetimeMs });
    phase = "review";
    const ticket = review.ticket;
    expiry = setTimeout(() => {
      if (!disposed && review?.ticket === ticket) {
        clearReview();
        phase = "ready";
        errorCode = "LIBRARY_REVIEW";
        emit();
      }
    }, reviewLifetimeMs);
  }
  function load() {
    return run("loading", async ({ valid }) => {
      const value = await read(valid);
      if (!valid()) return;
      remember(value);
      phase = "ready";
    });
  }
  function select(id) {
    if (disposed || operation) return false;
    clearReview();
    errorCode = result = null;
    try {
      libraryId(id);
      if (!document?.entries.some(entry => entry.id === id)) libraryFail("LIBRARY_SELECTION");
      selected = id;
      phase = "ready";
      emit();
      return true;
    } catch (error) {
      selected = null;
      errorCode = libraryErrorCode(error);
      emit();
      return false;
    }
  }
  function prepareSave(text) {
    return run("preparing", async ({ valid }) => {
      const entry = await prepareLibraryEntry(text, { now, crypto });
      if (!valid()) return;
      const value = await read(valid);
      if (!valid()) return;
      remember(value);
      const duplicate = value.entries.some(row => row.id === entry.id);
      mutateEncryptedLibrary(value, value, { kind: "add", entry });
      setReview({ kind: "add", id: entry.id, entry, expected: value, duplicate });
    });
  }
  function prepareRemove() {
    const id = selected, expected = document;
    return run("preparing", async ({ valid }) => {
      if (!expected || !id) libraryFail("LIBRARY_SELECTION");
      const value = await read(valid);
      if (!sameEncryptedLibrary(value, expected)) libraryFail("LIBRARY_CONFLICT");
      if (!valid()) return;
      const entry = value.entries.find(row => row.id === id);
      if (!entry) libraryFail("LIBRARY_SELECTION");
      remember(value);
      setReview({ kind: "remove", id, bytes: entry.bytes, expected: value });
    });
  }
  function confirm(ticket, acknowledged) {
    if (disposed || operation) return Promise.resolve(false);
    let captured;
    try {
      captured = review;
      const time = clock();
      if (!captured || captured.ticket !== ticket || time < captured.createdAt ||
          time >= captured.expiresAt) libraryFail("LIBRARY_REVIEW");
      if (acknowledged !== true) libraryFail("LIBRARY_CONFIRM");
    } catch (error) {
      clearReview();
      errorCode = libraryErrorCode(error);
      phase = document ? "ready" : "idle";
      emit();
      return Promise.resolve(false);
    }
    return run("committing", async ({ valid, signal }) => {
      const change = captured.kind === "add" ? { kind: "add", entry: captured.entry }
        : captured.kind === "merge" ? { kind: "merge", entries: captured.entries }
        : { kind: "remove", id: captured.id };
      const value = await storage.change(captured.expected, change, { signal,
        canCommit: () => {
          const time = clock();
          return valid() && time >= captured.createdAt && time < captured.expiresAt;
        } });
      if (!valid()) return;
      remember(await verifyEncryptedLibrary(value, { crypto, guard: valid }));
      if (!valid()) return;
      selected = captured.kind === "add" ? captured.id : null;
      result = captured.kind === "merge" ? "merged" : captured.kind === "remove" ? "removed"
        : captured.duplicate ? "duplicate" : "saved";
      phase = "ready";
    });
  }
  function useSelected(mode) {
    const id = selected, expected = document;
    return run(mode === "open" ? "opening" : "exporting", async ({ valid }) => {
      if (!expected || !id) libraryFail("LIBRARY_SELECTION");
      const value = await read(valid);
      if (!sameEncryptedLibrary(value, expected)) libraryFail("LIBRARY_CONFLICT");
      if (!valid()) return;
      const entry = value.entries.find(row => row.id === id);
      if (!entry) libraryFail("LIBRARY_SELECTION");
      if (mode === "open") {
        const accepted = onOpen(entry.text);
        if (accepted && typeof accepted.then === "function") {
          Promise.resolve(accepted).catch(() => {});
          libraryFail("LIBRARY_STAGE");
        }
        if (accepted !== true) libraryFail("LIBRARY_STAGE");
        if (!valid()) return;
        result = "opened";
      } else {
        exported = Object.freeze({ text: entry.text, byteLength: entry.bytes,
          filename: SECURE_BACKUP_FILENAME, mimeType: "application/json;charset=utf-8" });
        result = "export-ready";
      }
      phase = "ready";
    });
  }
  function prepareImport(file) {
    return run("preparing", async ({ valid, signal }) => {
      const text = await readText(file, { maxBytes: ENCRYPTED_ARCHIVE_LIMIT, signal });
      if (!valid()) return;
      const incoming = await decodeEncryptedArchive(text, { crypto, guard: valid });
      if (!valid()) return;
      const value = await read(valid);
      if (!valid()) return;
      const merge = describeLibraryMerge(value, incoming);
      mutateEncryptedLibrary(value, value, { kind: "merge", entries: incoming.entries });
      remember(value);
      setReview({ kind: "merge", id: null, bytes: merge.addedBytes, merge,
        expected: value, entries: incoming.entries });
    });
  }
  function prepareArchive() {
    return run("exporting", async ({ valid }) => {
      const value = await read(valid);
      if (!valid()) return;
      const prepared = await prepareEncryptedArchive(value, { crypto, guard: valid });
      if (!valid()) return;
      remember(value);
      exported = prepared;
      result = "archive-ready";
      phase = "ready";
    });
  }
  function offer(download) {
    if (disposed || operation) return false;
    const prepared = exported;
    const id = generation;
    exported = null; // One user action consumes the offer, including reentrant callbacks.
    try {
      if (!prepared || typeof download !== "function") libraryFail("LIBRARY_EXPORT");
      const outcome = download(prepared);
      if (outcome && typeof outcome.then === "function") {
        Promise.resolve(outcome).catch(() => {});
        libraryFail("LIBRARY_EXPORT");
      }
      if (!current(id)) return false;
      result = "export-offered";
      emit();
      return true;
    } catch {
      if (!current(id)) return false;
      errorCode = "LIBRARY_EXPORT";
      emit();
      return false;
    }
  }
  return Object.freeze({ state, load, select, prepareSave, prepareRemove, prepareImport, prepareArchive, confirm,
    open: () => useSelected("open"), prepareExport: () => useSelected("export"), offer, cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      operation?.abort.abort();
      operation = null;
      clearReview();
      clearDocument();
      errorCode = result = null;
      phase = "disposed";
      try { storage.close(); } catch {}
      emit();
    } });
}
