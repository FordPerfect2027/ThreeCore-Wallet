/** Outstanding native requests, not just promises the application still awaits. */
export const RPC_CAPACITY = Object.freeze({ perProvider: 32, perPage: 96 });

export function createRpcCapacity({ perProvider = 32, perPage = 96 } = {}) {
  if (!Number.isSafeInteger(perProvider) || perProvider < 1 || perProvider > 32 ||
      !Number.isSafeInteger(perPage) || perPage < perProvider || perPage > 96) {
    throw TypeError("Invalid request capacity");
  }
  const providers = new WeakMap();
  let pending = 0;
  let waiting = 0;
  let occupiedProviders = 0;

  function acquire(provider) {
    if ((!provider || typeof provider !== "object") && typeof provider !== "function") {
      throw TypeError("A provider identity is required");
    }
    const count = providers.get(provider) ?? 0;
    if (count >= perProvider || pending >= perPage) return null;
    if (count === 0) occupiedProviders++;
    providers.set(provider, count + 1);
    pending++;
    waiting++;
    let active = true;
    let local = true;
    function abandon() {
      if (!active || !local) return false;
      local = false;
      waiting--;
      return true;
    }
    function release() {
      if (!active) return false;
      abandon();
      active = false;
      pending--;
      const remaining = providers.get(provider) - 1;
      if (remaining === 0) {
        providers.delete(provider);
        occupiedProviders--;
      } else providers.set(provider, remaining);
      provider = null;
      return true;
    }
    return Object.freeze({ abandon, release });
  }
  function state() {
    return Object.freeze({ pending, waiting, abandoned: pending - waiting,
      occupiedProviders, perProvider, perPage });
  }
  // No reset, eviction, provider enumeration or timed release API exists.
  return Object.freeze({ acquire, state });
}
