/** Limits measure input bytes, not total JavaScript heap usage. */
export const FILE_SECURITY_LIMIT = 96 * 1024 * 1024;
export const FILE_READ_TIMEOUT = 30_000;
export const FILE_CHUNK_LIMIT = 100_000;
export const FILE_READ_CONCURRENCY = 4;
export const FILE_READ_RESERVED_LIMIT = 128 * 1024 * 1024;
export const FILE_READ_OBSERVER_LIMIT = 64;
export const FILE_ERROR_CODES = Object.freeze([
  "FILE_OPTIONS", "FILE_SIZE", "FILE_READ", "FILE_ENCODING", "FILE_TIMEOUT",
  "FILE_CANCELLED", "FILE_BUSY", "FILE_CLOCK", "FILE_DISPOSED",
]);
export class SecurityFileError extends Error {
  constructor(code) {
    const safe = FILE_ERROR_CODES.includes(code) ? code : "FILE_READ";
    super(safe);
    this.name = "SecurityFileError";
    this.code = safe;
  }
}
export const fileReadFail = code => { throw new SecurityFileError(code); };
/** Never retain an adapter exception, message, or stack as diagnostics. */
export function fileReadCode(error) {
  try {
    if (error instanceof SecurityFileError && FILE_ERROR_CODES.includes(error.code)) return error.code;
  } catch { /* Exceptions are themselves untrusted input. */ }
  return "FILE_READ";
}
export function consumeCleanup(action) {
  try { Promise.resolve(action()).catch(() => {}); } catch { /* Best effort. */ }
}
