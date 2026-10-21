import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { makeAerodromeMockWalletSource, SYNTHETIC_ACCOUNT } from "../src/aerodrome-mock-wallet.js";
import { createWalletProviderRegistry } from "../src/provider-registry.js";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";

const origin = "https://aerodrome.finance";
function fixture(options) {
  const listeners = new Map();
  const window = {
    location: { origin },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatchEvent(event) {
      for (const fn of [...listeners.get(event.type) ?? []]) fn(event);
    },
  };
  class CustomEvent { constructor(type, { detail }) { this.type = type; this.detail = detail; } }
  vm.runInNewContext(makeAerodromeMockWalletSource(SYNTHETIC_ACCOUNT, options), {
    window, CustomEvent, setTimeout: fn => fn(),
  }, { timeout: 1000 });
  return { window, mock: window.__threecoreWalletSimulation };
}

test("permission response identifies the exact dApp invoker", async () => {
  const { mock } = fixture();
  const granted = await mock.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  assert.equal(granted[0].invoker, origin);
  assert.equal(granted[0].parentCapability, "eth_accounts");
});

test("granting accounts emits one accountsChanged event and supports listener chaining", async () => {
  const { mock } = fixture();
  const events = [];
  const listener = accounts => events.push(Array.from(accounts));
  assert.equal(mock.provider.on("accountsChanged", listener), mock.provider);
  await mock.provider.request({ method: "eth_requestAccounts" });
  await mock.provider.request({ method: "eth_requestAccounts" });
  assert.deepEqual(events, [[SYNTHETIC_ACCOUNT]]);
  assert.equal(mock.provider.removeListener("accountsChanged", listener), mock.provider);
});

test("EIP-6963-only discovery has no legacy provider and never requests accounts", () => {
  const { window, mock } = fixture({ discovery: "eip6963-only" });
  assert.equal(window.ethereum, undefined);
  const registry = createWalletProviderRegistry({ eventTarget: window });
  assert.equal(registry.list().length, 1);
  assert.equal(registry.getProvider(registry.list()[0].uuid), mock.provider);
  registry.request();
  assert.equal(registry.list().length, 1);
  assert.deepEqual(Array.from(mock.observed), []);
  registry.dispose();
  assert.equal(registry.request(), false);
});

test("announcements freeze metadata and detail and preserve provider identity", () => {
  const { window, mock } = fixture();
  const found = [];
  window.addEventListener("eip6963:announceProvider", e => found.push(e.detail));
  window.dispatchEvent({ type: "eip6963:requestProvider" });
  window.dispatchEvent({ type: "eip6963:requestProvider" });
  assert.equal(found[0], found[1]);
  assert.equal(found[0].provider, mock.provider);
  assert.ok(Object.isFrozen(found[0]));
  assert.ok(Object.isFrozen(found[0].info));
});

test("permission responses carry the synthetic account restriction and cannot mutate later reads", async () => {
  const { mock } = fixture();
  const result = await mock.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  assert.equal(result[0].caveats[0].type, "restrictReturnedAccounts");
  assert.deepEqual(Array.from(result[0].caveats[0].value), [SYNTHETIC_ACCOUNT]);
  result[0].caveats[0].value[0] = "changed";
  result[0].invoker = "https://other.example";
  const next = await mock.provider.request({ method: "wallet_getPermissions" });
  assert.equal(next[0].invoker, origin);
  assert.deepEqual(Array.from(next[0].caveats[0].value), [SYNTHETIC_ACCOUNT]);
});

test("malformed account permission options cannot grant access or emit events", async () => {
  for (const value of [null, [], "", 1, true, { unexpected: true }]) {
    const { mock } = fixture();
    let events = 0;
    mock.provider.on("accountsChanged", () => events++);
    await assert.rejects(mock.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: value }] }), { code: 4001 });
    assert.equal(events, 0);
    assert.deepEqual(Array.from(await mock.provider.request({ method: "eth_accounts" })), []);
  }
});

test("account revocation emits an empty list once and clears permissions", async () => {
  const { mock } = fixture();
  const events = [];
  mock.provider.on("accountsChanged", a => events.push(Array.from(a)));
  await mock.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  mock.revokeAccounts();
  mock.revokeAccounts();
  assert.deepEqual(events, [[SYNTHETIC_ACCOUNT], []]);
  assert.deepEqual(Array.from(await mock.provider.request({ method: "eth_accounts" })), []);
  assert.deepEqual(Array.from(await mock.provider.request({ method: "wallet_getPermissions" })), []);
});

test("removed listeners stay removed and account payloads do not share mutable arrays", async () => {
  const { mock } = fixture();
  let removedCalls = 0;
  const removed = () => removedCalls++;
  const seen = [];
  mock.provider.on("accountsChanged", a => a.push("mutated"));
  mock.provider.on("accountsChanged", a => seen.push(Array.from(a)));
  mock.provider.on("accountsChanged", removed).removeListener("accountsChanged", removed);
  await mock.provider.request({ method: "eth_requestAccounts" });
  mock.revokeAccounts();
  assert.equal(removedCalls, 0);
  assert.deepEqual(seen, [[SYNTHETIC_ACCOUNT], []]);
});

for (const discovery of ["legacy-and-eip6963", "eip6963-only"]) {
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    test(`${agent} connects via ${discovery}, invalidates on revocation and explicitly reconnects`, async () => {
      const { window, mock } = fixture({ discovery });
      const registry = createWalletProviderRegistry({ eventTarget: window });
      const provider = discovery === "eip6963-only" ? registry.getProvider(registry.list()[0].uuid) : window.ethereum;
      const session = new ThreeCoreWalletSession({ provider, agent, siteOrigin: origin,
        approvedOrigins: [origin], expectedAccount: SYNTHETIC_ACCOUNT, chainId: 8453 });
      try {
        assert.equal((await session.connect()).connected, true);
        assert.equal(await session.getNativeBalance(), 0n);
        mock.revokeAccounts();
        assert.equal(session.state.connected, false);
        await assert.rejects(session.getNativeBalance(), { code: "NOT_CONNECTED" });
        assert.equal((await session.connect()).connected, true);
        assert.equal(mock.observed.filter(m => m === "eth_requestAccounts").length, 2);
        assert.equal(mock.observed.some(m => /sign|send|switch/i.test(m)), false);
      } finally { session.disconnect(); registry.dispose(); }
    });
  }
}

test("dangerous requests stay rejected and are recorded across permission revocation", async () => {
  const { mock } = fixture({ discovery: "eip6963-only" });
  const methods = ["personal_sign", "eth_sign", "eth_signTypedData", "eth_signTypedData_v4", "eth_sendTransaction", "eth_sendRawTransaction", "wallet_sendCalls", "wallet_switchEthereumChain", "wallet_addEthereumChain"];
  for (const permitted of [true, false]) {
    if (permitted) await mock.provider.request({ method: "eth_requestAccounts" });
    else mock.revokeAccounts();
    for (const method of methods) await assert.rejects(mock.provider.request({ method, params: [] }), { code: 4001 });
  }
  assert.deepEqual(Array.from(mock.rejections, r => r.method), [...methods, ...methods]);
  assert.ok(mock.rejections.every(r => r.code === 4001));
});

test("discovery configuration rejects unsupported modes", () => {
  for (const discovery of [null, false, "legacy", "https://unknown.example"]) {
    assert.throws(() => makeAerodromeMockWalletSource(SYNTHETIC_ACCOUNT, { discovery }), TypeError);
  }
});

test("trace separates discovery, readiness reads and explicit account permission", async () => {
  const { window, mock } = fixture({ discovery: "eip6963-only" });
  const registry = createWalletProviderRegistry({ eventTarget: window });
  await mock.provider.request({ method: "eth_accounts" });
  mock.markPhase("browser-wallet-click");
  await mock.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  assert.deepEqual(Array.from(mock.trace, e => e.kind), ["announcement", "discovery-request", "announcement", "rpc", "rpc"]);
  assert.equal(mock.trace[3].phase, "page-load");
  assert.equal(mock.trace[4].phase, "browser-wallet-click");
  assert.equal(mock.trace[4].sequence, 5);
  registry.dispose();
});
test("diagnostic trace omits request payloads and is bounded", async () => {
  const { mock } = fixture();
  await assert.rejects(mock.provider.request({ method: "personal_sign", params: ["payload-must-not-be-recorded"] }), { code: 4001 });
  assert.equal(JSON.stringify(mock.trace).includes("payload-must-not-be-recorded"), false);
  for (let i = 0; i < 210; i++) await mock.provider.request({ method: "eth_accounts" });
  assert.equal(mock.trace.length, 200);
  assert.equal(mock.trace[199].sequence, 200);
});
