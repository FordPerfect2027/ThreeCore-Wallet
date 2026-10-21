/**
 * A strictly un-funded synthetic EIP-1193/EIP-6963 provider for testing the
 * official Aerodrome web UI. This is NEVER a real wallet/provider extension.
 *
 * Requests for signing, sending transactions, token approvals or network
 * switches always reject. The account does not correspond to any stored key.
 * Inject only into a brand-new, isolated browser profile with no extensions.
 */
export const SYNTHETIC_ACCOUNT = "0x1111111111111111111111111111111111111111";
export const SYNTHETIC_WALLET_NAME = "ThreeCore TEST ONLY (no funds)";
export const SECONDARY_WALLET_NAME = "ThreeCore SECONDARY TEST ONLY (no funds)";
export const MOCK_SCENARIOS = Object.freeze(["single", "multi-reannounce", "delayed", "duplicate-name", "unnamed"]);

export function makeAerodromeMockWalletSource(account = SYNTHETIC_ACCOUNT, { discovery = "legacy-and-eip6963", scenario = "single", lifecycle = false } = {}) {
  if (typeof account !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(account) ||
      /^0x0{40}$/i.test(account)) {
    throw new TypeError("A complete, nonzero synthetic EVM test address is required");
  }
  if (!["legacy-and-eip6963", "eip6963-only"].includes(discovery)) {
    throw new TypeError("Unsupported synthetic provider discovery mode");
  }
  if (!MOCK_SCENARIOS.includes(scenario) || (scenario !== "single" && discovery !== "eip6963-only")) {
    throw new TypeError("Unsupported synthetic wallet scenario or discovery mode");
  }
  if (lifecycle && (discovery !== "eip6963-only" || !["duplicate-name", "unnamed"].includes(scenario))) {
    throw new TypeError("Lifecycle fixtures require isolated same-name or unnamed providers");
  }
  const primary = providerSource(account, discovery, { slot: "__threecoreWalletSimulation",
    name: scenario === "unnamed" ? "" : SYNTHETIC_WALLET_NAME, uuid: "f0c10000-1000-4000-8000-000000000001",
    rdns: "xyz.threecore.simulation", delayed: scenario === "delayed" });
  if (!["multi-reannounce", "duplicate-name", "unnamed"].includes(scenario)) return primary;
  // Announce the other provider first: selecting the first discovered provider
  // must not accidentally satisfy the intended wallet's connection checks.
  return providerSource("0x2222222222222222222222222222222222222222", discovery, {
    slot: "__threecoreSecondarySimulation",
    name: scenario === "unnamed" ? "   " : scenario === "duplicate-name" ? SYNTHETIC_WALLET_NAME : SECONDARY_WALLET_NAME,
    uuid: "f0c10000-1000-4000-8000-000000000002", rdns: "xyz.threecore.secondary", delayed: false,
  }) + "\n" + primary + (lifecycle ? "\n" + providerSource("0x3333333333333333333333333333333333333333", discovery, {
    slot: "__threecoreAddedSimulation", name: scenario === "unnamed" ? "" : SYNTHETIC_WALLET_NAME,
    uuid: "f0c10000-1000-4000-8000-000000000003", rdns: "xyz.threecore.added", delayed: true,
  }) : "");
}

function providerSource(account, discovery, { slot, name, uuid, rdns, delayed }) {
  const literalAccount = JSON.stringify(account.toLowerCase());
  return `(() => {
    "use strict";
    if (window.location.origin !== "https://aerodrome.finance") return;

    const observed = [];
    const rejections = [];
    const emitted = [];
    const trace = [];
    let phase = "page-load";
    function note(kind, method) {
      if (trace.length >= 200) return;
      trace.push({ sequence: trace.length + 1, phase, kind, method,
        stack: kind === "rpc" ? String(new Error().stack || "").slice(0, 1800) : undefined });
    }
    const listeners = new Map();
    const account = ${literalAccount};
    let permitted = false;
    let announcementsEnabled = ${!delayed};

    function rejected(method) {
      const error = new Error(method + " is blocked by the ThreeCore simulation");
      error.code = 4001;
      rejections.push({ method, code: error.code });
      return Promise.reject(error);
    }

    function setPermission(next) {
      if (permitted === next) return;
      permitted = next;
      const accounts = permitted ? [account] : [];
      emitted.push({ event: "accountsChanged", accounts: [...accounts] });
      for (const listener of [...listeners.get("accountsChanged") || []]) {
        listener.call(provider, [...accounts]);
      }
    }
    function permissions() {
      return permitted ? [{ invoker: window.location.origin,
        parentCapability: "eth_accounts",
        caveats: [{ type: "restrictReturnedAccounts", value: [account] }] }] : [];
    }

    const provider = {
      isThreeCoreReadOnlySimulation: true,
      on(event, listener) {
        if (typeof event !== "string" || typeof listener !== "function") throw new TypeError("Invalid listener");
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(listener);
        return provider;
      },
      removeListener(event, listener) {
        const list = listeners.get(event);
        const index = list?.lastIndexOf(listener) ?? -1;
        if (index !== -1) list.splice(index, 1);
        return provider;
      },
      request: async ({method, params = []}) => {
        note("rpc", method);
        observed.push(method);
        switch (method) {
          case "eth_chainId": return "0x2105";
          case "net_version": return "8453";
          case "eth_accounts": return permitted ? [account] : [];
          case "eth_requestAccounts":
            setPermission(true);
            return [account];
          case "wallet_getPermissions":
            return permissions();
          case "wallet_requestPermissions": {
            if (!Array.isArray(params) || params.length !== 1 ||
                !params[0] || typeof params[0] !== "object" ||
                Array.isArray(params[0]) ||
                Object.keys(params[0]).join(",") !== "eth_accounts" ||
                !params[0].eth_accounts || typeof params[0].eth_accounts !== "object" ||
                Array.isArray(params[0].eth_accounts) || Object.keys(params[0].eth_accounts).length !== 0) {
              return rejected(method);
            }
            setPermission(true);
            return permissions();
          }
          case "wallet_getCapabilities": return {};
          case "eth_getBalance": return "0x0";
          default: return rejected(method);
        }
      }
    };

    Object.defineProperty(window, ${JSON.stringify(slot)}, {
      configurable: false,
      value: { observed, rejections, emitted, trace, provider, fakeAccount: account,
        name: ${JSON.stringify(name)}, uuid: ${JSON.stringify(uuid)},
        get announcementsEnabled() { return announcementsEnabled; },
        reannounce: () => announce(),
        activate: () => { announcementsEnabled = true; announce(); },
        markPhase: value => { phase = String(value).slice(0, 60); },
        get accounts() { return permitted ? [account] : []; },
        discovery: ${JSON.stringify(discovery)},
        // Test-only control: simulates the user revoking account access.
        revokeAccounts: () => setPermission(false) },
    });
    if (${JSON.stringify(discovery)} === "legacy-and-eip6963") {
      Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
    }

    const info = Object.freeze({
      uuid: ${JSON.stringify(uuid)},
      name: ${JSON.stringify(name)},
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      rdns: ${JSON.stringify(rdns)},
    });
    const detail = Object.freeze({ info, provider });
    function announce() {
      if (!announcementsEnabled) return;
      note("announcement");
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail,
      }));
    }
    window.addEventListener("eip6963:requestProvider", () => { note("discovery-request"); announce(); });
    setTimeout(announce, 40);
  })();`;
}
