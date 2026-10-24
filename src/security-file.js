/** Bounded browser File reads. No persistence, network or wallet operations. */
export class SecurityFileError extends Error {
  constructor(code) {
    super(code);
    this.name = "SecurityFileError";
    this.code = code;
  }
}
const fail = code => { throw new SecurityFileError(code); };
export const FILE_SECURITY_LIMIT = 96 * 1024 * 1024;
export const FILE_READ_TIMEOUT = 30_000;
export const FILE_CHUNK_LIMIT = 100_000;

function metadata(file, maxBytes) {
  try {
    const size = file?.size;
    if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) fail("FILE_SIZE");
    const stream = file.stream;
    const arrayBuffer = file.arrayBuffer;
    if (typeof stream !== "function" && typeof arrayBuffer !== "function") fail("FILE_READ");
    return { size, stream, arrayBuffer };
  } catch (error) {
    if (error instanceof SecurityFileError) throw error;
    fail("FILE_READ");
  }
}

/**
 * Prefer File.stream(): stop reading once actual bytes exceed the declaration.
 * The fallback supports older File-like adapters, but cannot prevent such an
 * adapter from allocating its own buffer. All late results are discarded.
 */
export async function readSecurityFileText(file, {
  maxBytes = FILE_SECURITY_LIMIT,
  timeoutMs = FILE_READ_TIMEOUT,
  signal,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > FILE_SECURITY_LIMIT ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) fail("FILE_OPTIONS");
  if (signal && (typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")) fail("FILE_OPTIONS");
  if (signal?.aborted) fail("FILE_CANCELLED");
  const captured = metadata(file, maxBytes);
  let reader;
  let stopped = false;
  let timer;
  let abort;
  function cancelReader() {
    if (!reader) return;
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
  }
  const deadline = new Promise((resolve, reject) => {
    const stop = code => {
      stopped = true;
      cancelReader();
      reject(new SecurityFileError(code));
    };
    timer = setTimeout(() => stop("FILE_TIMEOUT"), timeoutMs);
    abort = () => stop("FILE_CANCELLED");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  const work = async () => {
    if (stopped) fail("FILE_CANCELLED");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const parts = [];
    let received = 0;
    let chunks = 0;
    function accept(bytes) {
      if (stopped) fail("FILE_CANCELLED");
      if (!(bytes instanceof Uint8Array)) fail("FILE_READ");
      received += bytes.byteLength;
      if (received > captured.size || received > maxBytes || ++chunks > FILE_CHUNK_LIMIT) fail("FILE_SIZE");
      try { parts.push(decoder.decode(bytes, { stream: true })); }
      catch { fail("FILE_ENCODING"); }
    }
    if (typeof captured.stream === "function") {
      const stream = captured.stream.call(file);
      if (!stream || typeof stream.getReader !== "function") fail("FILE_READ");
      reader = stream.getReader();
      if (!reader || typeof reader.read !== "function" || typeof reader.cancel !== "function") fail("FILE_READ");
      while (!stopped) {
        const packet = await reader.read();
        if (stopped) fail("FILE_CANCELLED");
        if (!packet || typeof packet.done !== "boolean") fail("FILE_READ");
        if (packet.done) break;
        accept(packet.value);
      }
    } else {
      const buffer = await captured.arrayBuffer.call(file);
      if (!(buffer instanceof ArrayBuffer)) fail("FILE_SIZE");
      accept(new Uint8Array(buffer));
    }
    if (stopped) fail("FILE_CANCELLED");
    if (received !== captured.size) fail("FILE_SIZE");
    try { parts.push(decoder.decode()); }
    catch { fail("FILE_ENCODING"); }
    return parts.join("");
  };
  try {
    return await Promise.race([Promise.resolve().then(work), deadline]);
  } catch (error) {
    stopped = true;
    cancelReader();
    if (error instanceof SecurityFileError) throw error;
    fail("FILE_READ");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    try { reader?.releaseLock(); } catch {}
  }
}

/** Preserve each established file format's public error vocabulary. */
export async function readFormatFileText(file, { maxBytes, fail: formatFail, sizeCode,
  readCode, encodingCode, signal, timeoutMs } = {}) {
  try {
    return await readSecurityFileText(file, { maxBytes, signal, timeoutMs });
  } catch (error) {
    const code = error instanceof SecurityFileError ? error.code : "FILE_READ";
    const mapped = code === "FILE_SIZE" ? sizeCode : code === "FILE_ENCODING" ? encodingCode : readCode;
    return formatFail(mapped);
  }
}
