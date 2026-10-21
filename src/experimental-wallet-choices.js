// Experimental presentation adapter for the pinned Aerodrome connector list.
// Choice numbers distinguish local connector instances; they do not authenticate
// a wallet's brand, publisher, name, reverse-domain label or account ownership.
import { createWalletLifecycleHarness } from "./experimental-wallet-lifecycle.js";
import { createWalletRecoveryController, mountWalletRecoveryPanel } from "./experimental-wallet-recovery.js";
export function createWalletChoiceRegistry() {
  const known = new Map();
  let current = [], next = 0, generation = 0;
  const safeName = value => typeof value === "string" ? value.normalize("NFKC")
    .replace(/[\p{C}<>]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 48) : "";
  const active = row => current.some(r => r.lease === row.lease);
  function requireActive(row) {
    if (!active(row)) throw Error("Stale or removed wallet choice; select again");
  }
  async function resolveProvider(row) {
    requireActive(row);
    const provider = await row.identity.getProvider.call(row.connector);
    requireActive(row);
    if (!provider || !["object", "function"].includes(typeof provider)) throw Error("Missing wallet provider");
    if (row.identity.provider && row.identity.provider !== provider) throw Error("Wallet provider changed; selection refused");
    row.identity.provider = provider;
    return provider;
  }
  function map(connectors, configuredCount) {
    const previousRows = current;
    current = []; generation++;
    if (!Array.isArray(connectors) || connectors.length > 100 || !Number.isSafeInteger(configuredCount) ||
        configuredCount < 0 || configuredCount > connectors.length) throw Error("Invalid connector list");
    const seen = new Set(connectors.slice(0, configuredCount).map(c => c?.uid).filter(uid => typeof uid === "string")), staged = [];
    for (const connector of connectors.slice(configuredCount)) {
      const uid = connector?.uid;
      if (typeof uid !== "string" || !uid || uid.length > 128 || seen.has(uid) || typeof connector.getProvider !== "function") {
        throw Error("Missing or ambiguous connector identity");
      }
      seen.add(uid);
      const previous = known.get(uid);
      if (previous && (previous.getProvider !== connector.getProvider || previous.connect !== connector.connect)) {
        throw Error("Connector identity was rebound");
      }
      if (!previous && known.size + staged.filter(r => !known.has(r.uid)).length >= 100) throw Error("Too many connector identities");
      const id = previous?.id ?? ++next;
      const name = safeName(connector.name) || "Unnamed wallet";
      const label = `Wallet choice ${id}: ${name} (unverified name)`;
      const identity = previous ?? { uid, id, getProvider: connector.getProvider, connect: connector.connect };
      const prior = previousRows.find(r => r.uid === uid && r.label === label);
      staged.push({ uid, id, label, connector, identity, lease: prior?.lease ?? {} });
    }
    const decorated = staged.map(row => {
      const result = { ...row.connector, name: row.label };
      if (typeof row.identity.connect === "function") {
        result.connect = async (...args) => {
          const provider = await resolveProvider(row);
          // A cached provider can be rediscovered under a new framework UID.
          // Do not authorize either choice while both resolve to that provider.
          const label = await labelForProvider(provider);
          requireActive(row);
          if (label !== row.label) throw Error("Ambiguous or unavailable wallet provider; select again");
          // The pinned connector uses this.getProvider during connect. Bind
          // those lookups to the same guarded instance, with no fallback.
          const receiver = { ...row.connector, getProvider: () => resolveProvider(row) };
          const connected = await row.identity.connect.apply(receiver, args);
          requireActive(row);
          return connected;
        };
      }
      return result;
    });
    const configured = connectors.slice(0, configuredCount).map(c => c.name === "Injected" ? { ...c, name: "Browser Wallet" } : c);
    for (const r of staged) known.set(r.uid, r.identity);
    current = staged;
    return [...configured, ...decorated];
  }
  // Read-only test introspection: match the actual synthetic provider reference,
  // never its name, UUID, reverse-domain label, list position or advertised ID.
  async function labelForProvider(provider) {
    const version = generation, rows = [...current], matched = [];
    if (!provider || (typeof provider !== "object" && typeof provider !== "function")) return null;
    try {
      for (const row of rows) {
        if (await resolveProvider(row) === provider) matched.push(row.label);
        if (version !== generation) return null;
      }
    } catch { return null; }
    return matched.length === 1 ? matched[0] : null;
  }
  async function reviewProviders() {
    const version = generation, rows = [...current], entries = [];
    for (const row of rows) {
      const provider = await resolveProvider(row);
      if (generation !== version) throw Error("Wallet entries changed. Review them again.");
      entries.push({ uid: row.uid, id: row.id, label: row.label, provider });
    }
    return entries;
  }
  return Object.freeze({ map, labelForProvider, reviewProviders,
    invalidateChoices() { current = []; generation++; },
    choices: () => current.map(({ uid, id, label }) => ({ uid, id, label })) });
}

export function makeWalletChoiceRegistrySource({ lifecycle = false, recovery = false } = {}) {
  if (recovery && !lifecycle) throw Error("Recovery UI requires the isolated lifecycle experiment");
  return `(() => {
    if (window.location.origin !== "https://aerodrome.finance" || !window.__threecoreWalletSimulation) return;
    const registry = (${createWalletChoiceRegistry.toString()})();
    const recoveryFactory = ${recovery ? `(registry, access) => {
      const controller = (${createWalletRecoveryController.toString()})(registry, access);
      queueMicrotask(() => (${mountWalletRecoveryPanel.toString()})(document, controller));
      return controller;
    }` : "null"};
    const lifecycle = ${lifecycle ? `(${createWalletLifecycleHarness.toString()})(registry, recoveryFactory)` : "null"};
    Object.defineProperty(window, "__threecoreExperimentalChoices", { configurable: false,
      value: lifecycle ? Object.freeze({ ...registry, map: lifecycle.map, lifecycle }) : registry });
  })();`;
}
