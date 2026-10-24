import { walletFileReadService } from "./file-read-service.js";
import { fileReadCode } from "./file-read-policy.js";
export { SecurityFileError, FILE_SECURITY_LIMIT, FILE_READ_TIMEOUT, FILE_CHUNK_LIMIT } from "./file-read-policy.js";

/** All production file formats share this page-wide budget and deadline guard. */
export const readSecurityFileText = (file, options) => walletFileReadService.readText(file, options);
export const readSecurityFileBytes = (file, options) => walletFileReadService.readBytes(file, options);

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
