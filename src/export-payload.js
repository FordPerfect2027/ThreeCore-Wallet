import { EXPORT_LIMITS, exportFail, exportErrorCode, ExportSecurityError } from "./export-policy.js";

const types = Object.freeze({ json: "application/json", csv: "text/csv", txt: "text/plain", html: "text/html" });
const reserved = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
function field(input, name, required = true) {
  const descriptor = Object.getOwnPropertyDescriptor(input, name);
  if (!descriptor) { if (required) exportFail("EXPORT_FORMAT"); return undefined; }
  if (!Object.hasOwn(descriptor, "value")) exportFail("EXPORT_FORMAT");
  return descriptor.value;
}

/** Count exact UTF-8 bytes without making a second, potentially large buffer. */
export function exportTextBytes(text, limit = EXPORT_LIMITS.fileBytes) {
  if (typeof text !== "string" || !Number.isSafeInteger(limit) || limit < 1 ||
      limit > EXPORT_LIMITS.fileBytes || !text.length || text.length > limit) exportFail("EXPORT_SIZE");
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) exportFail("EXPORT_ENCODING");
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) exportFail("EXPORT_ENCODING");
    else bytes += 3;
    if (bytes > limit) exportFail("EXPORT_SIZE");
  }
  return bytes;
}

/** App-generated simple filenames only; never coerce or silently rename input. */
export function inspectExportFilename(filename) {
  if (typeof filename !== "string" || filename.length > EXPORT_LIMITS.filenameCharacters) exportFail("EXPORT_NAME");
  const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.(json|csv|txt|html)$/.exec(filename);
  if (!match || reserved.test(match[1])) exportFail("EXPORT_NAME");
  return match[2];
}

/** Snapshot only the fields needed for transport; metadata never crosses it. */
export function inspectExportPayload(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) exportFail("EXPORT_FORMAT");
    const text = field(input, "text"), filename = field(input, "filename"), mimeType = field(input, "mimeType");
    const kind = inspectExportFilename(filename);
    if (typeof mimeType !== "string" || ![types[kind], types[kind] + ";charset=utf-8",
      types[kind] + "; charset=utf-8"].includes(mimeType)) exportFail("EXPORT_TYPE");
    const byteLength = exportTextBytes(text);
    const declared = field(input, "byteLength", false);
    if (declared !== undefined && (!Number.isSafeInteger(declared) || declared !== byteLength)) exportFail("EXPORT_SIZE");
    return Object.freeze({ text, filename, mimeType: types[kind] + ";charset=utf-8", kind, byteLength });
  } catch (error) {
    // Own-property proxy traps must not leak their message or supplied values.
    const code = exportErrorCode(error);
    if (code !== "EXPORT_FAILED") throw new ExportSecurityError(code);
    exportFail("EXPORT_FORMAT");
  }
}
