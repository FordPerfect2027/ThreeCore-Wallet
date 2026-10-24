/**
 * One visible read operation. Cancellation ends local waiting and prevents its
 * next subread. It cannot cancel an RPC already accepted by a wallet extension.
 * The RPC supervisor retains responsibility for that provider's pending capacity.
 */
export const WALLET_READ_METHODS = Object.freeze([
  "getBlockSnapshot", "getNativeBalance", "getContractCode", "getTokenBalance",
  "getTokenAllowance", "getTokenMetadata", "getTransferEvents",
]);
const MAX_PENDING = 32;
const stale = () => Object.assign(new Error("Obsolete view operation"), { code: "STALE_VIEW" });

export function createWalletReadScope({ isCurrent, onSettled = () => {} }) {
  if (typeof isCurrent !== "function" || typeof onSettled !== "function") throw TypeError("READ_SCOPE_CONFIG");
  let closed = false;
  let inspecting = false;
  const pending = new Set();
  function notifySettled() {
    try { Promise.resolve(onSettled()).catch(() => {}); } catch {}
  }
  function cancel() {
    if (closed) return false;
    closed = true;
    const waiters = [...pending];
    pending.clear();
    for (const stop of waiters) stop();
    return true;
  }
  function check() {
    if (closed) return false;
    if (inspecting) { cancel(); return false; }
    inspecting = true;
    let accepted = false;
    try {
      const value = isCurrent();
      if (value && ["object", "function"].includes(typeof value)) {
        const then = value.then;
        if (typeof then === "function") {
          new Promise((resolve, reject) => then.call(value, resolve, reject)).catch(() => {});
        }
      }
      accepted = value === true;
    } catch {}
    finally { inspecting = false; }
    if (!accepted) cancel();
    return !closed;
  }
  function assertCurrent() { if (!check()) throw stale(); }
  function invoke(operation) {
    return new Promise((resolve, reject) => {
      if (typeof operation !== "function") { reject(TypeError("READ_SCOPE_OPERATION")); return; }
      if (!check()) { reject(stale()); return; }
      if (pending.size >= MAX_PENDING) {
        reject(Object.assign(new Error("Read operation capacity exceeded"), { code: "READ_SCOPE_LIMIT" }));
        return;
      }
      let settled = false;
      const stop = () => finish(false, stale());
      function finish(ok, value) {
        if (settled) return;
        settled = true;
        pending.delete(stop);
        if (ok) resolve(value); else reject(value);
      }
      pending.add(stop);
      let result;
      try {
        assertCurrent();
        result = operation();
      } catch (error) {
        if (!check()) finish(false, stale()); else finish(false, error);
        return;
      }
      // Both handlers stay attached after cancellation to consume a late reject.
      Promise.resolve(result).then(value => {
        notifySettled();
        if (!check()) finish(false, stale()); else finish(true, value);
      }, error => {
        notifySettled();
        if (!check()) finish(false, stale()); else finish(false, error);
      });
    });
  }
  function bind(session) {
    assertCurrent();
    if (!session || typeof session !== "object") throw TypeError("READ_SCOPE_SESSION");
    const view = {};
    Object.defineProperty(view, "state", { enumerable: true, get() {
      assertCurrent();
      const value = session.state;
      assertCurrent();
      return value;
    } });
    // Whitelist only read capabilities. No forwarding Proxy or passthrough to
    // connect, disconnect, arbitrary request, signatures or transactions.
    for (const name of WALLET_READ_METHODS) {
      assertCurrent();
      const method = session[name];
      assertCurrent();
      if (typeof method === "function") {
        view[name] = (...args) => invoke(() => method.apply(session, args));
      }
    }
    return Object.freeze(view);
  }
  return Object.freeze({ invoke, bind, cancel, check,
    state: () => Object.freeze({ closed, pending: pending.size, maximum: MAX_PENDING }) });
}
