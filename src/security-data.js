import { readAbortState } from "./security-abort.js";
import { consumeCallback, observeCallbackResult } from "./security-callback.js";

/**
 * Capture bounded own data before validation. Do not validate a property and
 * later read it again through a getter/Proxy, or call an input array's methods.
 * Reflection on a Proxy can still run application code: stateful callers must
 * check their revision/cancellation after this capture and before committing.
 */
export class SecurityDataError extends Error {
  constructor() { super("INVALID_DATA"); this.name = "SecurityDataError"; this.code = "INVALID_DATA"; }
}
const fail = () => { throw new SecurityDataError(); };

export function captureDataRecord(input, names) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== null && prototype !== Object.prototype) fail();
    const keys = Reflect.ownKeys(input);
    if (keys.length !== names.length || keys.some(key => !names.includes(key))) fail();
    const result = Object.create(null);
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch { fail(); }
}

/** Capture known optional adapter options once; unrelated properties are ignored. */
export function captureOptionalDataFields(input, names) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== null && prototype !== Object.prototype) fail();
    const result = Object.create(null);
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) continue;
      if (!Object.hasOwn(descriptor, "value")) fail();
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch { fail(); }
}

export function captureDataArray(input, maximum, minimum = 0) {
  try {
    if (!Number.isSafeInteger(maximum) || maximum < minimum || minimum < 0 || !Array.isArray(input)) fail();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value")) fail();
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < minimum || length > maximum) fail();
    const keys = Reflect.ownKeys(input);
    if (keys.length !== length + 1 || !keys.includes("length")) fail();
    for (const key of keys) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) fail();
    }
    const result = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch { fail(); }
}

// WebCrypto digest results must be genuine, exactly 32-byte ArrayBuffers.
// Read their intrinsic size: an own byteLength property is not authoritative.
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const viewPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const viewLength = Object.getOwnPropertyDescriptor(viewPrototype, "byteLength").get;
const viewBuffer = Object.getOwnPropertyDescriptor(viewPrototype, "buffer").get;
const viewTag = Object.getOwnPropertyDescriptor(viewPrototype, Symbol.toStringTag).get;
const checksumNow = performance.now.bind(performance);
const checksumSchedule = setTimeout.bind(globalThis);
const checksumUnschedule = clearTimeout.bind(globalThis);
let checksumJobs = 0, checksumBytes = 0;

export class ChecksumError extends Error {
  constructor(code) { super(code); this.name = "ChecksumError"; this.code = code; }
}

/** Cancellation ends the local wait. Native work retains its reservation until settlement. */
export async function sha256Hex(bytes, subtle = globalThis.crypto?.subtle, options = {}) {
  let signal, timeoutMs, size;
  try {
    ({ signal, timeoutMs = 30_000 } = captureOptionalDataFields(options, ["signal", "timeoutMs"]));
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
        Reflect.apply(viewTag, bytes, []) !== "Uint8Array") throw new Error();
    const buffer = Reflect.apply(viewBuffer, bytes, []);
    Reflect.apply(bufferLength, buffer, []); // Excludes shared memory.
    new Uint8Array(buffer, 0, 0); // Excludes a detached input, including a zero-length view.
    if (bufferResizable && Reflect.apply(bufferResizable, buffer, [])) throw new Error();
    size = Reflect.apply(viewLength, bytes, []);
  } catch { throw new ChecksumError("CHECKSUM_OPTIONS"); }
  if (size > 96 * 1024 * 1024) throw new ChecksumError("CHECKSUM_SIZE");
  if (checksumJobs >= 8 || checksumBytes + size > 128 * 1024 * 1024) throw new ChecksumError("CHECKSUM_BUSY");
  checksumJobs++; checksumBytes += size;
  const expires = checksumNow() + timeoutMs;
  return new Promise((resolve, reject) => {
    let done = false, started = false, reserved = true, attached = false, timer = null, remove;
    const release = () => {
      if (!reserved) return;
      reserved = false; checksumJobs--; checksumBytes -= size;
    };
    const onAbort = () => stop("CHECKSUM_CANCELLED");
    function cleanup() {
      if (timer !== null) { checksumUnschedule(timer); timer = null; }
      if (attached) {
        attached = false;
        const receiver = signal, detach = remove;
        consumeCallback(() => Reflect.apply(detach, receiver, ["abort", onAbort]));
      }
      signal = remove = null;
    }
    function stop(code) {
      if (done) return false;
      done = true;
      if (!started) release();
      cleanup(); reject(new ChecksumError(code)); return false;
    }
    function current() {
      if (done) return false;
      try {
        const aborted = readAbortState(signal);
        if (done) return false;
        if (typeof aborted !== "boolean") return stop("CHECKSUM_OPTIONS");
        if (aborted) return stop("CHECKSUM_CANCELLED");
      } catch { return stop("CHECKSUM_OPTIONS"); }
      return checksumNow() >= expires ? stop("CHECKSUM_TIMEOUT") : true;
    }
    try {
      if (!current()) return;
      timer = checksumSchedule(() => stop("CHECKSUM_TIMEOUT"), timeoutMs);
      if (signal != null) {
        const receiver = signal, add = signal.addEventListener;
        remove = signal.removeEventListener;
        if (typeof add !== "function" || typeof remove !== "function") { stop("CHECKSUM_OPTIONS"); return; }
        if (!current()) return;
        const detach = remove;
        attached = true;
        const registration = Reflect.apply(add, receiver, ["abort", onAbort, { once: true }]);
        if (observeCallbackResult(registration, () => consumeCallback(() => Reflect.apply(detach, receiver, ["abort", onAbort]))) !== "synchronous" || registration === false) {
          stop("CHECKSUM_OPTIONS"); return;
        }
      }
      if (!current()) return;
      let digest;
      try { digest = subtle?.digest; }
      catch { stop("CHECKSUM_UNAVAILABLE"); return; }
      if (!current()) return;
      if (typeof digest !== "function") { stop("CHECKSUM_UNAVAILABLE"); return; }
      started = true;
      let result;
      try { result = Reflect.apply(digest, subtle, ["SHA-256", bytes]); }
      catch { release(); stop("CHECKSUM_FAILED"); return; }
      Promise.resolve(result).then(value => {
        release();
        if (!current()) return;
        try {
          if (Reflect.apply(bufferLength, value, []) !== 32) throw new Error();
          const view = new Uint8Array(value, 0, 32);
          let hex = "";
          for (let index = 0; index < 32; index++) hex += view[index].toString(16).padStart(2, "0");
          done = true; cleanup(); resolve(hex);
        } catch { stop("CHECKSUM_FAILED"); }
      }, () => { release(); if (current()) stop("CHECKSUM_FAILED"); });
    } catch { release(); stop("CHECKSUM_OPTIONS"); }
    finally { bytes = subtle = null; }
  });
}
