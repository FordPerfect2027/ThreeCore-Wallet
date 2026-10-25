import { consumeCallback } from "./security-callback.js";

/**
 * Deliver aggregate service status, never wallet or file payloads.
 * A listener can synchronously stop work. The next listener must see that stop,
 * not a snapshot captured before the first listener ran.
 *
 * Reentrant invalidations are drained at most twice per delivery. Notification
 * callbacks are observers, not a background work scheduler: a callback that
 * continually mutates the service cannot create an endless microtask chain.
 * The service's state() remains the authoritative synchronous snapshot.
 */
export function createStateNotifier({ observers, read, deferred = false }) {
  if (!(observers instanceof Set) || typeof read !== "function" || typeof deferred !== "boolean") {
    throw TypeError("STATE_NOTIFIER_OPTIONS");
  }
  let delivering = false;
  let scheduled = false;
  let dirty = false;
  const delivered = new WeakMap();

  function send(listener) {
    if (!observers.has(listener)) return;
    // read() belongs to the service. All current callers return flat, frozen,
    // bounded primitive records; serialization never visits external payloads.
    const value = read();
    const key = JSON.stringify(value);
    if (!observers.has(listener) || delivered.get(listener) === key) return;
    delivered.set(listener, key);
    consumeCallback(() => listener(value));
  }

  function flush(initial = null) {
    if (delivering) { dirty = true; return; }
    delivering = true;
    try {
      for (let round = 0; round < 2; round++) {
        dirty = false;
        const batch = initial && round === 0 ? [initial] : [...observers];
        for (const listener of batch) send(listener);
        if (!dirty) break;
      }
    } finally { delivering = false; dirty = false; }
  }

  function notify() {
    if (!observers.size) return;
    if (delivering) { dirty = true; return; }
    if (!deferred) { flush(); return; }
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      flush();
    });
  }

  return Object.freeze({ notify,
    initial(listener) {
      // An explicit subscription outside delivery gets its initial view. A
      // subscription made by the callback itself cannot recurse indefinitely.
      if (!delivering) delivered.delete(listener);
      if (observers.has(listener)) flush(listener);
    },
    forget(listener) { delivered.delete(listener); },
  });
}
