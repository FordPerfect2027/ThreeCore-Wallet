import { observeCallbackResult } from "./security-callback.js";
/** Fixed outward-facing codes: never retain browser exceptions or file content. */
export const EXPORT_LIMITS = Object.freeze({
  fileBytes: 96 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  active: 4,
  retentionMs: 1000,
  observers: 32,
  filenameCharacters: 180,
});
export const EXPORT_CODES = Object.freeze([
  "EXPORT_FORMAT", "EXPORT_NAME", "EXPORT_TYPE", "EXPORT_SIZE", "EXPORT_ENCODING",
  "EXPORT_BUSY", "EXPORT_UNAVAILABLE", "EXPORT_FAILED", "EXPORT_CANCELLED",
  "EXPORT_CLOCK", "EXPORT_CLEANUP", "EXPORT_DISPOSED", "EXPORT_OPTIONS",
]);
export class ExportSecurityError extends Error {
  constructor(code) {
    const safe = EXPORT_CODES.includes(code) ? code : "EXPORT_FAILED";
    super(safe);
    this.name = "ExportSecurityError";
    this.code = safe;
  }
}
export function exportFail(code) { throw new ExportSecurityError(code); }
export function exportErrorCode(error) {
  try {
    if (error instanceof ExportSecurityError && EXPORT_CODES.includes(error.code)) return error.code;
  } catch {}
  return "EXPORT_FAILED";
}
export function consumeExportCallback(action) {
  try { Promise.resolve(action()).catch(() => {}); } catch {}
}
/** Resource operations must be synchronous; rejection is always consumed. */
export function requireSyncExport(value, code = "EXPORT_FAILED") {
  if (observeCallbackResult(value) !== "synchronous") exportFail(code);
  if (value === false) exportFail(code);
  return value;
}
