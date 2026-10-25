import { consumeCallback, observeCallbackResult } from "./security-callback.js";

export const STORAGE_CONCURRENCY = 4;
export const STORAGE_OBSERVERS = 16;
export const STORAGE_COUNTER_LIMIT = 1_000_000_000;
export const STORAGE_SNAPSHOT_LIMITS = Object.freeze({
  nodes: 1_000_000,
  characters: 128 * 1024 * 1024,
  depth: 64,
});

export class StorageGuardError extends Error {
  constructor(code = "CHECKPOINT_STORAGE") {
    super(code);
    this.name = "StorageGuardError";
    this.code = code;
  }
}

export function storageFail(code) { throw new StorageGuardError(code); }

export function observeStorageCleanup(work) {
  consumeCallback(work);
}

export function ownStorageData(input, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch { return undefined; }
}

/** Capture reviewed JSON-shaped input before the first asynchronous boundary.
 * No getters, toJSON hooks, iterators, proxies-as-a-sandbox or platform cloning.
 * Limits bound the admitted tree, not arbitrary code in a hostile Proxy trap.
 */
export function captureStorageInput(value, limits = STORAGE_SNAPSHOT_LIMITS) {
  const bounds = {};
  for (const name of ["nodes", "characters", "depth"]) {
    const count = ownStorageData(limits, name);
    if (!Number.isSafeInteger(count) || count < 1 || count > STORAGE_SNAPSHOT_LIMITS[name]) {
      storageFail("CHECKPOINT_ADAPTER");
    }
    bounds[name] = count;
  }
  let nodes = 0;
  let characters = 0;
  const ancestors = new WeakSet();
  function text(value) {
    characters += value.length;
    if (characters > bounds.characters) storageFail("CHECKPOINT_CAPACITY");
    return value;
  }
  function visit(input, depth) {
    if (++nodes > bounds.nodes || depth > bounds.depth) storageFail("CHECKPOINT_CAPACITY");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") return text(input);
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (!input || typeof input !== "object") storageFail("CHECKPOINT_ADAPTER");
    if (ancestors.has(input)) storageFail("CHECKPOINT_ADAPTER");
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) {
      storageFail("CHECKPOINT_ADAPTER");
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length > bounds.nodes - nodes + 1) storageFail("CHECKPOINT_CAPACITY");
    ancestors.add(input);
    try {
      if (array) {
        const length = ownStorageData(input, "length");
        if (!Number.isSafeInteger(length) || length < 0 || length > bounds.nodes - nodes ||
            keys.length !== length + 1) storageFail("CHECKPOINT_ADAPTER");
        const result = [];
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
            storageFail("CHECKPOINT_ADAPTER");
          }
          result.push(visit(descriptor.value, depth + 1));
        }
        return Object.freeze(result);
      }
      const result = {};
      for (const key of keys) {
        if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) {
          storageFail("CHECKPOINT_ADAPTER");
        }
        text(key);
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
          storageFail("CHECKPOINT_ADAPTER");
        }
        Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1), enumerable: true });
      }
      return Object.freeze(result);
    } finally { ancestors.delete(input); }
  }
  try { return visit(value, 0); }
  catch (error) {
    if (error instanceof StorageGuardError) throw error;
    storageFail("CHECKPOINT_ADAPTER");
  }
}

/** Async policies cannot extend an active IndexedDB transaction's authority. */
export function synchronousStorageValue(value) {
  if (observeCallbackResult(value) !== "synchronous") storageFail("CHECKPOINT_ADAPTER");
  return value;
}
