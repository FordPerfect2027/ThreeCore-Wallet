/**
 * Observe adapter failures without making an asynchronous result authoritative.
 * Capture `then` once: a second getter read could describe a different result.
 * The returned classification is synchronous; settlement only performs cleanup.
 */
export function observeCallbackResult(value, onResolved = () => {}) {
  if (value === null || !["object", "function"].includes(typeof value)) return "synchronous";
  let then;
  try { then = value.then; } catch { return "unreadable"; }
  if (typeof then !== "function") return "synchronous";
  Promise.resolve({ then(resolve, reject) {
    const returned = Reflect.apply(then, value, [resolve, reject]);
    // A malformed async `then` method can reject its own returned native promise
    // without calling reject. Observe that separate promise without recursively
    // invoking arbitrary thenables or rereading their accessors.
    if (returned !== value && returned != null) {
      try { Reflect.apply(Promise.prototype.then, returned, [() => {}, () => {}]); }
      catch { /* Non-native return values are not settlement signals. */ }
    }
  } }).then(onResolved, () => {}).catch(() => {});
  return "asynchronous";
}

/** Best effort cleanup does not authorize a retry, resume, or successful save. */
export function consumeCallback(work) {
  try { observeCallbackResult(work()); } catch {}
}

/**
 * A deadline must have a cancellable handle now. Zero and opaque native handles
 * are valid. A late handle is released, never installed into a newer operation.
 * An unreadable handle is still offered to cleanup in case allocation happened.
 */
export function acceptTimerHandle(handle, release) {
  const kind = observeCallbackResult(handle, late => {
    if (late != null) consumeCallback(() => release(late));
  });
  if (kind === "unreadable") consumeCallback(() => release(handle));
  return kind === "synchronous" && handle != null && handle !== false;
}

/** Clock values cannot arrive later or be converted from objects/strings. */
export function readSynchronousClock(now) {
  const value = now();
  return observeCallbackResult(value) === "synchronous" && typeof value === "number" ? value : NaN;
}
