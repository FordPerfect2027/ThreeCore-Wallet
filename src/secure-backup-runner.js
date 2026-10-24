import { SecureBackupError, secureFail } from "./secure-backup-format.js";

/**
 * WebCrypto cannot be cancelled. Keep the slot occupied until native work really
 * settles, even when the UI has already cancelled or timed out. No retry queue.
 */
export function createSecureBackupRunner({ timeoutMs = 60_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    secureFail("SECURE_INTERNAL");
  }
  let active = null;
  function busy() { return active !== null; }
  async function run(work, { signal } = {}) {
    if (typeof work !== "function" || (signal &&
        (typeof signal.addEventListener !== "function" ||
         typeof signal.removeEventListener !== "function"))) secureFail("SECURE_INTERNAL");
    if (signal?.aborted) secureFail("SECURE_CANCELLED");
    if (active) secureFail("SECURE_BUSY");
    const token = {};
    active = token;
    let stopped = false;
    let timer;
    let onAbort;
    const deadline = new Promise((resolve, reject) => {
      function stop(code) {
        if (stopped) return;
        stopped = true;
        reject(new SecureBackupError(code));
      }
      timer = setTimeout(() => stop("SECURE_TIMEOUT"), timeoutMs);
      onAbort = () => stop("SECURE_CANCELLED");
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    const pending = Promise.resolve().then(() => {
      if (stopped) secureFail("SECURE_CANCELLED");
      return work(() => !stopped);
    }).finally(() => {
      if (active === token) active = null;
    });
    // Promise.race installs a rejection observer on the late native result.
    try { return await Promise.race([pending, deadline]); }
    finally {
      stopped = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  return Object.freeze({ run, busy });
}

// Shared by all panels in this JavaScript realm, including remounted panels.
export const secureBackupRunner = createSecureBackupRunner();
