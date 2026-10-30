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

export class ChecksumError extends Error {
  constructor(code) { super(code); this.name = "ChecksumError"; this.code = code; }
}

export async function sha256Hex(bytes, subtle = globalThis.crypto?.subtle) {
  let digest;
  try { digest = subtle?.digest; }
  catch { throw new ChecksumError("CHECKSUM_UNAVAILABLE"); }
  if (typeof digest !== "function") throw new ChecksumError("CHECKSUM_UNAVAILABLE");
  try {
    const result = await Reflect.apply(digest, subtle, ["SHA-256", bytes]);
    if (Reflect.apply(bufferLength, result, []) !== 32) throw new Error();
    const view = new Uint8Array(result, 0, 32);
    let hex = "";
    for (let index = 0; index < 32; index++) hex += view[index].toString(16).padStart(2, "0");
    return hex;
  } catch { throw new ChecksumError("CHECKSUM_FAILED"); }
}
