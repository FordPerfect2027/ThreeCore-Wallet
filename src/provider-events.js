import { createProviderEventGate } from "./provider-event-gate.js";
/** Provider events are untrusted observations, never permission to reconnect. */
export const WALLET_EVENT_NAMES = Object.freeze(["accountsChanged", "chainChanged", "disconnect"]);
export class WalletEventError extends Error {
  constructor() {
    super("Walletの接続変更を監視できないため接続を終了しました。");
    this.name = "WalletEventError";
    this.code = "PROVIDER_EVENT_FAILURE";
  }
}

export function snapshotWalletAccounts(input) {
  try {
    if (!Array.isArray(input)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    const size = lengthDescriptor?.value;
    if (!Number.isSafeInteger(size) || size < 0 || size > 128) return null;
    if (Reflect.ownKeys(input).length !== size + 1) return null;
    const result = [];
    for (let i = 0; i < size; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" ||
          !/^0x[0-9a-f]{40}$/i.test(descriptor.value)) return null;
      result.push(descriptor.value.toLowerCase());
    }
    return Object.freeze(result);
  } catch { return null; }
}

export function snapshotWalletChain(input) {
  if (typeof input !== "string" || input.length > 16 || !/^0x[0-9a-f]+$/i.test(input)) return null;
  const value = BigInt(input);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return "0x" + value.toString(16);
}

function asynchronousResult(value, provider) {
  // EIP-1193 listener methods use synchronous EventEmitter semantics. Never
  // await an adapter's Promise to establish whether listeners were installed.
  if (value === provider || value === null ||
      !["object", "function"].includes(typeof value)) return false;
  let then;
  try { then = value.then; } catch { return true; }
  if (typeof then !== "function") return false;
  // Capture then once. Consume rejection without adopting its result as success.
  new Promise((resolve, reject) => {
    then.call(value, resolve, reject);
  }).catch(() => {});
  return true;
}

/**
 * Capture registration/removal functions once. Dispose all attempted listeners,
 * including the one for which registration threw after installing a callback.
 * The owner's generation remains the final authority after hostile reentrancy.
 */
export function observeWalletProvider(provider, handlers, isCurrent = () => true, eventGateOptions = {}) {
  if (!provider || typeof handlers !== "object" ||
      WALLET_EVENT_NAMES.some(name => typeof handlers[name] !== "function") ||
      typeof isCurrent !== "function") throw new WalletEventError();
  const eventGate = createProviderEventGate(eventGateOptions);
  let on, remove;
  try { on = provider.on; }
  catch { throw new WalletEventError(); }
  // Preserve the eventless/unremovable adapter compatibility policy. Local
  // generation and disposal guards remain authoritative even without removal.
  try { remove = provider.removeListener; } catch {}
  let disposed = false;
  const registrations = [];
  const current = () => {
    try { return !disposed && isCurrent() === true; } catch { return false; }
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    const pending = registrations.splice(0);
    if (typeof remove === "function") {
      for (const [name, fn] of pending) {
        try { asynchronousResult(remove.call(provider, name, fn), provider); } catch {}
      }
    }
  }
  if (!current()) { dispose(); throw new WalletEventError(); }
  if (typeof on !== "function") return Object.freeze({ dispose });
  try {
    for (const name of WALLET_EVENT_NAMES) {
      if (!current()) throw new WalletEventError();
      const listener = input => {
        if (!current()) return;
        if (!eventGate.accept()) {
          const shouldNotify = current();
          dispose();
          if (shouldNotify) handlers.disconnect(undefined);
          return;
        }
        const value = name === "accountsChanged" ? snapshotWalletAccounts(input) :
          name === "chainChanged" ? snapshotWalletChain(input) : undefined;
        if (!current()) return;
        handlers[name](value);
      };
      registrations.push([name, listener]);
      if (asynchronousResult(on.call(provider, name, listener), provider)) throw new WalletEventError();
      if (!current()) throw new WalletEventError();
    }
  } catch {
    dispose();
    throw new WalletEventError();
  }
  return Object.freeze({ dispose });
}
