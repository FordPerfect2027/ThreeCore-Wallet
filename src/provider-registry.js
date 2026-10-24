/**
 * EIP-6963 multi-injected wallet discovery for ThreeCore.
 *
 * Discovery never connects to a wallet, asks for an address, or authorizes
 * any signing or transaction. Wallet metadata is self-reported and untrusted:
 * an rdns label or friendly name is NOT proof of the provider's identity.
 */
export const MAX_DISCOVERED_WALLETS = 32;
export const ANNOUNCE_EVENT = "eip6963:announceProvider";
export const REQUEST_EVENT = "eip6963:requestProvider";

function snapshotAnnouncement(event) {
  // Event properties may be accessors or proxies. Validate exactly the values
  // we retain; reading them again could produce different metadata/providers.
  // Ignore inaccessible announcements without disturbing other wallets.
  try {
    const detail = event?.detail;
    if (!detail || typeof detail !== "object") return null;
    const info = detail.info;
    const provider = detail.provider;
    if (!info || typeof info !== "object" || typeof provider?.request !== "function") return null;
    const { uuid, name, rdns } = info;
    if (typeof uuid !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(uuid) ||
        typeof name !== "string" || name.length === 0 || name.length > 100 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name) ||
        typeof rdns !== "string" || rdns.length === 0 || rdns.length > 255 ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(rdns)) return null;
    // UUID hex case is not a new identity. Do not read or render icon/extra
    // properties, or freeze/wrap an extension-owned provider object.
    return { info: Object.freeze({ uuid: uuid.toLowerCase(), name, rdns }), provider };
  } catch {
    return null;
  }
}

/**
 * Subscribe before asking injected wallet extensions to announce themselves.
 * The returned list only exposes safe text metadata; calling getProvider()
 * requires selecting an exact entry discovered in this browser page.
 *
 * @param {object} options
 * @param {EventTarget} options.eventTarget - typically window
 * @param {Function} [options.onChange] - render new wallet options
 */
export function createWalletProviderRegistry({ eventTarget, onChange = () => {} }) {
  if (!eventTarget || typeof eventTarget.addEventListener !== "function" ||
      typeof eventTarget.removeEventListener !== "function" ||
      typeof eventTarget.dispatchEvent !== "function") {
    throw new TypeError("A browser-compatible event target is required");
  }
  if (typeof onChange !== "function") throw new TypeError("onChange must be a function");

  const found = new Map();
  let disposed = false;

  function list() {
    return Object.freeze([...found.values()].map(({ info }) => info));
  }

  function onAnnouncement(event) {
    if (disposed || found.size >= MAX_DISCOVERED_WALLETS) return;
    const entry = snapshotAnnouncement(event);
    // A getter can reenter the registry and dispose it during validation.
    if (disposed || !entry || found.size >= MAX_DISCOVERED_WALLETS) return;
    const { uuid } = entry.info;
    // The first wallet announcing a UUID wins; do not silently replace the
    // provider selected by a user when a duplicate announcement arrives.
    if (found.has(uuid)) return;
    found.set(uuid, entry);
    try { onChange(list()); } catch { /* A UI observer cannot corrupt discovery state. */ }
  }

  eventTarget.addEventListener(ANNOUNCE_EVENT, onAnnouncement);

  function request() {
    if (disposed) return false;
    eventTarget.dispatchEvent(new Event(REQUEST_EVENT));
    return true;
  }

  function getProvider(uuid) {
    if (disposed || typeof uuid !== "string") return null;
    return found.get(uuid.toLowerCase())?.provider ?? null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    eventTarget.removeEventListener(ANNOUNCE_EVENT, onAnnouncement);
    found.clear();
  }

  request();
  return Object.freeze({ list, getProvider, request, dispose });
}
