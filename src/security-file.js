import { observeCallbackResult } from "./security-callback.js";
import { walletFileReadService } from "./file-read-service.js";
import { fileReadCode, SecurityFileError } from "./file-read-policy.js";
export { SecurityFileError, FILE_SECURITY_LIMIT, FILE_READ_TIMEOUT, FILE_CHUNK_LIMIT } from "./file-read-policy.js";

/** All production file formats share this page-wide budget and deadline guard. */
export const readSecurityFileText = (file, options) => walletFileReadService.readText(file, options);
export const readSecurityFileBytes = (file, options) => walletFileReadService.readBytes(file, options);

/** One view owns cancellation; admission and deadlines remain page-wide. */
export function createFileReadScope() {
  let controller = null, revision = 0;
  function stopPrevious() {
    const id = ++revision;
    const previous = controller;
    controller = null;
    previous?.abort();
    return id;
  }
  function cancel() { stopPrevious(); }
  async function readText(file, options = {}) {
    const id = stopPrevious();
    // Cleanup may synchronously cancel or replace this request.
    if (id !== revision) throw new SecurityFileError("FILE_CANCELLED");
    const own = new AbortController();
    controller = own;
    try {
      // Capture options only after this request owns cancellation.
      const { maxBytes, timeoutMs } = options;
      if (own.signal.aborted || id !== revision) throw new SecurityFileError("FILE_CANCELLED");
      const bytes = await readSecurityFileBytes(file, { maxBytes, timeoutMs, signal: own.signal });
      if (own.signal.aborted || id !== revision) throw new SecurityFileError("FILE_CANCELLED");
      // Preserve a BOM so each format parser can enforce its existing policy.
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new SecurityFileError("FILE_ENCODING"); }
    } finally {
      if (controller === own) controller = null;
    }
  }
  return Object.freeze({ readText, cancel });
}

/** Preserve each established file format's public error vocabulary. */
async function readFormat(file, { maxBytes, fail: formatFail, sizeCode,
  readCode, encodingCode, signal, timeoutMs } = {}, bytes = false) {
  try {
    const read = bytes ? readSecurityFileBytes : readSecurityFileText;
    return await read(file, { maxBytes, signal, timeoutMs });
  } catch (error) {
    const code = fileReadCode(error);
    const mapped = code === "FILE_SIZE" ? sizeCode : code === "FILE_ENCODING" ? encodingCode : readCode;
    return formatFail(mapped);
  }
}
export const readFormatFileText = (file, options) => readFormat(file, options, false);
export const readFormatFileBytes = (file, options) => readFormat(file, options, true);

/** Capture File metadata once. Native File getters remain supported. */
export function readFormatFileName(file, { maxLength, fail, code }) {
  let name;
  try { name = file?.name; } catch { return fail(code); }
  if (typeof name !== "string") {
    observeCallbackResult(name);
    return fail(code);
  }
  if (!name.length || name.length > maxLength || !/\.json$/i.test(name) ||
      /[/\\\u0000-\u001f\u007f]/.test(name)) return fail(code);
  return name;
}
