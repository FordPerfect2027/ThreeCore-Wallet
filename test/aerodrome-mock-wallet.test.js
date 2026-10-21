import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  makeAerodromeMockWalletSource,
  SYNTHETIC_ACCOUNT,
} from "../src/aerodrome-mock-wallet.js";

function simulatedBrowser(hostname = "aerodrome.finance", protocol = "https:", port = "") {
  const events = new Map();
  const announcements = [];
  const window = {
    location: { hostname, protocol, origin: protocol + "//" + hostname + (port ? ":" + port : "") },
    addEventListener(name, callback) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(callback);
    },
    dispatchEvent(event) {
      if (event.type === "eip6963:announceProvider") announcements.push(event.detail);
      for (const listener of events.get(event.type) || []) listener(event);
    },
  };
  class CustomEvent {
    constructor(type, { detail }) {
      this.type = type;
      this.detail = detail;
    }
  }
  const context = vm.createContext({
    window, CustomEvent,
    setTimeout: callback => callback(),
  });
  vm.runInContext(makeAerodromeMockWalletSource(), context, { timeout: 1000 });
  return { window, announcements };
}

const blocked = method => error =>
  error.code === 4001 &&
  error.message.includes(method + " is blocked by the ThreeCore simulation");

test("the fake wallet is only injected on exact official Aerodrome HTTPS origin", () => {
  const official = simulatedBrowser();
  assert.equal(official.window.ethereum, official.window.__threecoreWalletSimulation.provider);
  for (const [host, protocol] of [
    ["fake-aerodrome.finance", "https:"],
    ["aerodrome.finance.attacker.example", "https:"],
    ["aerodrome.finance", "http:"],
    ["wallet.aerodrome.finance", "https:"],
    ["example.com", "https:"],
  ]) {
    const browser = simulatedBrowser(host, protocol);
    assert.equal(browser.window.ethereum, undefined);
    assert.equal(browser.window.__threecoreWalletSimulation, undefined);
    assert.deepEqual(browser.announcements, []);
  }
});

test("EIP-6963 provider announcement contains only an explicit synthetic test wallet", () => {
  const { window, announcements } = simulatedBrowser();
  assert.equal(announcements.length, 1);
  const info = announcements[0].info;
  assert.equal(info.rdns, "xyz.threecore.simulation");
  assert.match(info.name, /TEST ONLY/);
  assert.equal(announcements[0].provider, window.ethereum);
  window.dispatchEvent({ type: "eip6963:requestProvider" });
  assert.equal(announcements.length, 2);
});

test("pre-authorization requests do not disclose the synthetic account", async () => {
  const { window } = simulatedBrowser();
  const wallet = window.ethereum;
  assert.equal(await wallet.request({ method: "eth_chainId" }), "0x2105");
  assert.equal(await wallet.request({ method: "net_version" }), "8453");
  assert.deepEqual(Array.from(await wallet.request({ method: "eth_accounts" })), []);
  assert.deepEqual(Array.from(await wallet.request({ method: "wallet_getPermissions" })), []);
  assert.equal(await wallet.request({ method: "eth_getBalance", params: [SYNTHETIC_ACCOUNT] }), "0x0");
  assert.equal(await wallet.request({ method: "wallet_getCapabilities" })?.then(x => JSON.stringify(x)), "{}");
});

test("Aerodrome wallet_requestPermissions only permits eth_accounts in simulation", async () => {
  const { window } = simulatedBrowser();
  const provider = window.ethereum;
  const response = await provider.request({
    method: "wallet_requestPermissions", params: [{ eth_accounts: {} }],
  });
  assert.equal(response[0].parentCapability, "eth_accounts");
  assert.equal((await provider.request({ method: "eth_accounts" }))[0], SYNTHETIC_ACCOUNT);
  assert.equal((await provider.request({ method: "eth_requestAccounts" }))[0], SYNTHETIC_ACCOUNT);
  assert.deepEqual(Array.from(window.__threecoreWalletSimulation.observed.slice(0, 3)), [
    "wallet_requestPermissions", "eth_accounts", "eth_requestAccounts",
  ]);
});

test("rejects additional wallet permission capabilities and malformed permissions", async () => {
  for (const params of [
    [], [{}], [{ eth_sendTransaction: {} }],
    [{ eth_accounts: {}, eth_sendTransaction: {} }],
    [null], "any",
  ]) {
    const { window } = simulatedBrowser();
    await assert.rejects(window.ethereum.request({
      method: "wallet_requestPermissions", params,
    }), blocked("wallet_requestPermissions"));
    assert.deepEqual(Array.from(await window.ethereum.request({ method: "eth_accounts" })), []);
  }
});

test("all signing and transaction methods reject even after account simulation", async () => {
  const { window } = simulatedBrowser();
  const p = window.ethereum;
  await p.request({ method: "eth_requestAccounts" });
  for (const method of [
    "personal_sign", "eth_sign", "eth_signTypedData_v4", "eth_sendTransaction",
    "eth_sendRawTransaction", "wallet_switchEthereumChain",
    "wallet_addEthereumChain", "eth_call", "wallet_sendCalls",
  ]) {
    await assert.rejects(p.request({ method, params: [] }), blocked(method));
  }
  assert.deepEqual(Array.from(await p.request({ method: "eth_accounts" })), [SYNTHETIC_ACCOUNT]);
});

test("test wallet account input must be a well-formed nonzero public address", () => {
  for (const value of [
    null, "not-a-wallet", "0x123", "0x" + "0".repeat(40), "",
  ]) {
    assert.throws(() => makeAerodromeMockWalletSource(value), TypeError);
  }
  const script = makeAerodromeMockWalletSource("0x" + "A".repeat(40));
  assert.ok(script.includes("0x" + "a".repeat(40)));
});

test("read-only browser simulation never mentions a private key or seed phrase as an input", () => {
  const source = makeAerodromeMockWalletSource();
  // Unknown or dangerous RPC methods all hit the default-deny branch.
  assert.ok(source.includes("default: return rejected(method)"));
  assert.equal(source.includes("privateKey"), false);
  assert.equal(source.includes("mnemonic"), false);
});

test("external dApp worker cannot attach to an existing user browser without launcher isolation", () => {
  const worker = fileURLToPath(new URL("../scripts/aerodrome-ui-probe.js", import.meta.url));
  const result = spawnSync(process.execPath, [worker, "--mock-wallet"], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, THREECORE_ISOLATED_EDGE_CDP_PORT: "" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /isolated Edge runner|existing browsers may be attached/i);
});

test("isolated Edge runner refuses arbitrary sites or unsafe command-line arguments", () => {
  const runner = fileURLToPath(new URL("../scripts/run-isolated-aerodrome-probe.js", import.meta.url));
  const result = spawnSync(process.execPath, [runner, "--url=https://unknown.example"], {
    encoding: "utf8", timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: run-isolated-aerodrome-probe/i);
});

test("synthetic provider is not injected on a nonstandard HTTPS port", () => {
  const { window, announcements } = simulatedBrowser("aerodrome.finance", "https:", "8443");
  assert.equal(window.ethereum, undefined);
  assert.equal(window.__threecoreWalletSimulation, undefined);
  assert.deepEqual(announcements, []);
});
