import { walletFileReadService } from "./file-read-service.js";
import { fileReadCode, SecurityFileError } from "./file-read-policy.js";
export { SecurityFileError, FILE_SECURITY_LIMIT, FILE_READ_TIMEOUT, FILE_CHUNK_LIMIT } from "./file-read-policy.js";

/** All production file formats share this page-wide budget and deadline guard. */
export const readSecurityFileText = (file, options) => walletFileReadService.readText(file, options);
export const readSecurityFileBytes = (file, options) => walletFileReadService.readBytes(file, options);

/** One view owns cancellation; admission and deadlines remain page-wide. */
export function createFileReadScope() {
  let controller = null;
  function cancel() {
    const previous = controller;
    controller = null;
    previous?.abort();
  }
  async function readText(file, { maxBytes, timeoutMs } = {}) {
    cancel();
    const own = new AbortController();
    controller = own;
    try {
      const bytes = await readSecurityFileBytes(file, { maxBytes, timeoutMs, signal: own.signal });
      if (own.signal.aborted) throw new SecurityFileError("FILE_CANCELLED");
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
