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
