import { createCheckpointStorage, checkpointStorageError } from "./checkpoint-storage.js";
import { EncryptedLibraryError, emptyEncryptedLibrary, validateEncryptedLibrary,
  mutateEncryptedLibrary } from "./encrypted-library-model.js";

export const ENCRYPTED_LIBRARY_DATABASE = "threecore-encrypted-backups-v1";

export function encryptedLibraryStorageError(error) {
  try {
    if (error instanceof EncryptedLibraryError) {
      const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
      if (typeof code === "string" && /^LIBRARY_[A-Z_]+$/.test(code)) return new EncryptedLibraryError(code);
    }
  } catch {}
  const codes = {
    CHECKPOINT_UNAVAILABLE: "LIBRARY_UNAVAILABLE", CHECKPOINT_QUOTA: "LIBRARY_QUOTA",
    CHECKPOINT_BLOCKED: "LIBRARY_BLOCKED", CHECKPOINT_TIMEOUT: "LIBRARY_TIMEOUT",
    CHECKPOINT_BUSY: "LIBRARY_BUSY", CHECKPOINT_CLOCK: "LIBRARY_STORAGE", CHECKPOINT_TIMER: "LIBRARY_STORAGE",
    CHECKPOINT_CAPACITY: "LIBRARY_CAPACITY", CHECKPOINT_ADAPTER: "LIBRARY_FORMAT",
    CHECKPOINT_CLOSED: "LIBRARY_CLOSED", CHECKPOINT_CANCELLED: "LIBRARY_CANCELLED",
    CHECKPOINT_ABORTED: "LIBRARY_CANCELLED", CHECKPOINT_SCHEMA: "LIBRARY_FORMAT",
    CHECKPOINT_VERSION: "LIBRARY_FORMAT", QuotaExceededError: "LIBRARY_QUOTA",
    SecurityError: "LIBRARY_UNAVAILABLE", NotAllowedError: "LIBRARY_UNAVAILABLE",
    AbortError: "LIBRARY_CANCELLED", InvalidStateError: "LIBRARY_CLOSED",
    VersionError: "LIBRARY_FORMAT",
  };
  // Only known data properties are read. Provider/browser prose is never displayed.
  let code, name;
  try {
    code = Object.getOwnPropertyDescriptor(error, "code")?.value;
    // Native DOMException names use an inherited accessor; only this native type is allowed.
    name = Object.getOwnPropertyDescriptor(error, "name")?.value;
    if (!name) code = code ?? checkpointStorageError(error).code;
  } catch {}
  return new EncryptedLibraryError((typeof code === "string" ? codes[code] : undefined) ??
    (typeof name === "string" ? codes[name] : undefined) ?? "LIBRARY_STORAGE");
}

/** Separate origin-scoped storage. Never opens or migrates an existing plaintext database. */
export function createEncryptedLibraryStorage({ indexedDB, name = ENCRYPTED_LIBRARY_DATABASE,
  openTimeoutMs = 8000, transactionTimeoutMs = 30000, guard, deadlineOptions, snapshotLimits } = {}) {
  const storage = createCheckpointStorage({ indexedDB, name, openTimeoutMs, transactionTimeoutMs, guard, deadlineOptions, snapshotLimits,
    documentPolicy: {
      empty: emptyEncryptedLibrary,
      validate: validateEncryptedLibrary,
      mutate: mutateEncryptedLibrary,
      mapError: encryptedLibraryStorageError,
    } });
  return Object.freeze({
    read: options => storage.read(options).catch(error => { throw encryptedLibraryStorageError(error); }),
    change: (expected, operation, options) => storage.change(expected, operation, options)
      .catch(error => { throw encryptedLibraryStorageError(error); }),
    close: storage.close,
  });
}
