import test from "node:test";
import assert from "node:assert/strict";
import { createWalletProviderRegistry, MAX_DISCOVERED_WALLETS, ANNOUNCE_EVENT } from "../src/provider-registry.js";
import { providerFixture, A } from "./helpers/security-fixtures.js";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";

const info = n => ({ uuid: "12345678-1234-4234-8234-" + n.toString(16).padStart(12, "0"),
  name: "Wallet " + n, rdns: "wallet.example" });
function announce(target, detail) {
  const event = new Event(ANNOUNCE_EVENT);
  Object.defineProperty(event, "detail", { value: detail });
  target.dispatchEvent(event);
}

test("a flood of announcements cannot grow the registry indefinitely", () => {
  const target = new EventTarget(), notifications = [];
  const registry = createWalletProviderRegistry({ eventTarget: target, onChange: rows => notifications.push(rows) });
  let requests = 0;
  const provider = { request() { requests++; } };
  for (let i = 0; i < 2000; i++) announce(target, { info: info(i), provider });
  assert.equal(registry.list().length, MAX_DISCOVERED_WALLETS);
  assert.equal(notifications.length, MAX_DISCOVERED_WALLETS);
  assert.equal(requests, 0);
  assert.equal(registry.getProvider(info(200).uuid), null);
  registry.dispose();
});

test("after the discovery limit, metadata getters are not evaluated", () => {
  const target = new EventTarget(); const registry = createWalletProviderRegistry({ eventTarget: target });
  for (let i = 0; i < MAX_DISCOVERED_WALLETS; i++) announce(target, { info: info(i), provider: { request() {} } });
  let reads = 0;
  announce(target, { get info() { reads++; throw Error(); } });
  assert.equal(reads, 0);
  registry.dispose();
});

for (const hidden of ["\u0000", "\n", "\u007f", "\u0085", "\u202e", "\u202d", "\u2066", "\u2069"]) {
  test("control and direction-spoofing wallet labels are rejected: " + hidden.charCodeAt(0), () => {
    const target = new EventTarget(); const registry = createWalletProviderRegistry({ eventTarget: target });
    announce(target, { info: { ...info(1), name: "Trusted" + hidden + "Wallet" }, provider: { request() {} } });
    assert.equal(registry.list().length, 0);
    registry.dispose();
  });
}

test("a throwing UI observer cannot prevent later wallet discovery", () => {
  const target = new EventTarget(); const registry = createWalletProviderRegistry({ eventTarget: target,
    onChange() { throw Error("render failure"); } });
  for (let i = 0; i < 3; i++) announce(target, { info: info(i), provider: { request() {} } });
  assert.equal(registry.list().length, 3);
  registry.dispose();
});

test("the first provider retains its identity under duplicate and case-varied announcements", () => {
  const target = new EventTarget(); const registry = createWalletProviderRegistry({ eventTarget: target });
  const first = { request() {} }, second = { request() {} }, row = info(10);
  announce(target, { info: row, provider: first });
  announce(target, { info: { ...row, uuid: row.uuid.toUpperCase(), name: "Replacement" }, provider: second });
  assert.equal(registry.getProvider(row.uuid), first);
  assert.equal(registry.list()[0].name, row.name);
  registry.dispose();
});

test("a request function replacement cannot silently change an established provider transport", async () => {
  const f = providerFixture();
  let intercepted = 0;
  f.provider.request = () => { intercepted++; throw Error("swapped"); };
  await f.wallet.connect();
  assert.equal(await f.wallet.getNativeBalance(), 1n);
  assert.equal(intercepted, 0);
  f.wallet.disconnect();
});

test("provider request is captured once and retains its original this binding", async () => {
  let captures = 0, calls = 0;
  const provider = {
    marker: 42,
    get request() {
      captures++;
      return function ({ method }) {
        assert.equal(this.marker, 42); calls++;
        return Promise.resolve(method === "eth_chainId" ? "0x14a34" : [A]);
      };
    },
  };
  const wallet = new ThreeCoreWalletSession({ provider, agent: "DAT", expectedAccount: A,
    chainId: 84532, siteOrigin: "https://local.example", approvedOrigins: ["https://local.example"] });
  await wallet.connect();
  assert.equal(captures, 1);
  assert.equal(calls, 4);
  wallet.disconnect();
});

test("unavailable provider transport is rejected with a fixed local error", () => {
  const provider = { get request() { throw Error("hidden token"); } };
  assert.throws(() => new ThreeCoreWalletSession({ provider }), error =>
    error.code === "NO_PROVIDER" && !error.message.includes("hidden token"));
});

test("in-flight reads are bounded without sending excess provider requests", async () => {
  let block = false, calls = 0;
  const f = providerFixture(({ method }) => {
    if (block && method === "eth_chainId") { calls++; return new Promise(() => {}); }
  });
  await f.wallet.connect(); block = true;
  const pending = Array.from({ length: 40 }, () => f.wallet.getNativeBalance().catch(error => error));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 32);
  f.wallet.disconnect();
  const results = await Promise.all(pending);
  assert.equal(results.filter(error => error.code === "RPC_INFLIGHT_LIMIT").length, 8);
  assert.equal(results.filter(error => error.code === "SESSION_CHANGED").length, 32);
});
