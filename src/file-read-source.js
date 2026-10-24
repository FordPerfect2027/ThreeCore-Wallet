import { fileReadFail as fail, consumeCleanup } from "./file-read-policy.js";
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typed, "byteLength").get;
const typedBuffer = Object.getOwnPropertyDescriptor(typed, "buffer").get;
const typedOffset = Object.getOwnPropertyDescriptor(typed, "byteOffset").get;
const typedName = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
const setBytes = Uint8Array.prototype.set;

/** Capture selected methods once; do not evaluate unused fallback getters. */
export function captureFileSource(file, maxBytes) {
  const size = file?.size;
  if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) fail("FILE_SIZE");
  const stream = file.stream;
  if (typeof stream === "function") return { file, size, stream, arrayBuffer: null };
  const arrayBuffer = file.arrayBuffer;
  if (typeof arrayBuffer !== "function") fail("FILE_READ");
  return { file, size, stream: null, arrayBuffer };
}

/** Read only own data fields; done/value accessors are not invoked. */
export function inspectReadPacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) fail("FILE_READ");
  const done = Object.getOwnPropertyDescriptor(packet, "done");
  const value = Object.getOwnPropertyDescriptor(packet, "value");
  if (!done || !Object.hasOwn(done, "value") || typeof done.value !== "boolean") fail("FILE_READ");
  if (value && !Object.hasOwn(value, "value")) fail("FILE_READ");
  if (done.value) {
    if (value && value.value !== undefined) fail("FILE_READ");
    return { done: true, value: undefined };
  }
  if (!value) fail("FILE_READ");
  return { done: false, value: value.value };
}

/** Snapshot bytes before another await; shared memory and proxies are rejected. */
export function snapshotFileChunk(value, remaining, fallback = false) {
  let buffer, offset, length;
  try {
    if (fallback) {
      length = bufferLength.call(value);
      buffer = value;
      offset = 0;
    } else {
      if (typedName.call(value) !== "Uint8Array") fail("FILE_READ");
      length = typedLength.call(value);
      buffer = typedBuffer.call(value);
      offset = typedOffset.call(value);
      bufferLength.call(buffer);
    }
  } catch { fail(fallback ? "FILE_SIZE" : "FILE_READ"); }
  if (length > remaining || (fallback && length !== remaining)) fail("FILE_SIZE");
  try {
    const copy = new Uint8Array(length);
    setBytes.call(copy, new Uint8Array(buffer, offset, length));
    return copy;
  } catch { fail(fallback ? "FILE_SIZE" : "FILE_READ"); }
}

/** Capture the original receiver and cleanup methods, including partial setup. */
export function openFileStream(captured, checkpoint) {
  const stream = captured.stream.call(captured.file);
  checkpoint();
  const getReader = stream?.getReader;
  checkpoint();
  if (typeof getReader !== "function") fail("FILE_READ");
  const reader = getReader.call(stream);
  let read, cancel, release;
  let closed = false;
  function cleanup(cancelInput = true) {
    if (closed) return;
    closed = true;
    if (cancelInput && typeof cancel === "function") consumeCleanup(() => cancel.call(reader));
    if (typeof release === "function") consumeCleanup(() => release.call(reader));
  }
  try {
    // A broken cleanup getter must not prevent capturing the other cleanup.
    let captureFailed = false;
    try { cancel = reader?.cancel; } catch { captureFailed = true; }
    try { release = reader?.releaseLock; } catch { captureFailed = true; }
    try { read = reader?.read; } catch { captureFailed = true; }
    checkpoint();
    if (captureFailed || typeof read !== "function" || typeof cancel !== "function" ||
        (release !== undefined && typeof release !== "function")) fail("FILE_READ");
  } catch (error) { cleanup(); throw error; }
  return Object.freeze({ read: () => read.call(reader), cleanup });
}
