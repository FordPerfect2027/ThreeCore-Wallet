// Test-only control over the pinned dApp's connector store. This simulates list
// removal/restoration, not an EIP-6963 removal event or extension uninstall.
export function createWalletLifecycleHarness(registry, recoveryFactory = null) {
  let store, configRef, configuredCount, saved, recovery;
  const removed = new Map();
  function map(connectors, count, config) {
    const nextStore = config?._internal?.connectors;
    if (!nextStore || !Array.isArray(config.connectors) || !["setState", "subscribe"].every(k => typeof nextStore[k] === "function")) {
      throw Error("Unsupported experimental connector store");
    }
    if (store && (store !== nextStore || configuredCount !== count)) throw Error("Experimental store changed");
    if (!store) {
      store = nextStore; configRef = config; configuredCount = count;
      store.subscribe(next => { recovery?.changed(); registry.map(next, configuredCount); });
      recovery = recoveryFactory?.(registry, { rows, configuredCount, replace: next => store.setState(next) });
    }
    return registry.map(connectors, count);
  }
  function rows() {
    if (!store) throw Error("Experimental chooser not ready");
    return configRef.connectors;
  }
  function one(uid) {
    const list = rows(), matches = list.slice(configuredCount).filter(c => c.uid === uid);
    if (matches.length !== 1) throw Error("Missing or ambiguous experimental choice");
    return matches[0];
  }
  return Object.freeze({ map,
    capture(uid) {
      one(uid);
      saved = registry.map(rows(), configuredCount).find(c => c.uid === uid);
      if (typeof saved?.connect !== "function") throw Error("No connect callback");
    },
    remove(uid) {
      const connector = one(uid);
      if (removed.has(uid)) throw Error("Already removed");
      removed.set(uid, connector);
      store.setState(rows().filter(c => c.uid !== uid));
    },
    restore(uid) {
      const connector = removed.get(uid);
      if (!connector || rows().some(c => c.uid === uid)) throw Error("Cannot restore experimental choice");
      removed.delete(uid); store.setState([...rows(), connector]);
    },
    reverse() { const list = rows(); store.setState([...list.slice(0, configuredCount), ...list.slice(configuredCount).reverse()]); },
    async trySavedConnect() {
      if (!saved) throw Error("No saved experimental choice");
      try { await saved.connect(); return { rejected: false }; }
      catch (error) { return { rejected: true, error: error.message }; }
    },
  });
}
