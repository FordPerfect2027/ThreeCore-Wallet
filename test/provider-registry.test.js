import test from "node:test";
import assert from "node:assert/strict";
import {
  ANNOUNCE_EVENT,
  REQUEST_EVENT,
  createWalletProviderRegistry,
} from "../src/provider-registry.js";
import { ThreeCoreWalletSession, CHAINS } from "../src/wallet-session.js";

const WALLET_A = Object.freeze({
  uuid: "12345678-1234-1234-1234-123456789abc",
  name: "Example Wallet A",
  rdns: "org.example.walleta",
});
const WALLET_B = Object.freeze({
  uuid: "87654321-4321-4321-4321-cba987654321",
  name: "Example Wallet B",
  rdns: "org.example.walletb",
});
const ACCOUNT_A = "0x1111111111111111111111111111111111111111";
const ACCOUNT_B = "0x2222222222222222222222222222222222222222";

function announce(target, info, provider) {
  const event = new Event(ANNOUNCE_EVENT);
  Object.defineProperty(event, "detail", { value: { info, provider } });
  target.dispatchEvent(event);
}

function makeProvider(account) {
  const requests = [];
  const provider = {
    requests,
    async request({ method }) {
      requests.push(method);
      if (method === "eth_chainId") return CHAINS.BASE_SEPOLIA.hex;
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_getBalance") return "0x10";
      throw new Error("Unexpected request " + method);
    },
  };
  return provider;
}

test("registers announce listener before dispatching provider request", () => {
  const events = new EventTarget();
  const p = makeProvider(ACCOUNT_A);
  events.addEventListener(REQUEST_EVENT, () => announce(events, WALLET_A, p));
  const changes = [];
  const registry = createWalletProviderRegistry({
    eventTarget: events,
    onChange: (list) => changes.push(list),
  });
  assert.deepEqual(registry.list(), [WALLET_A]);
  assert.deepEqual(changes, [[WALLET_A]]);
  assert.equal(registry.getProvider(WALLET_A.uuid), p);
  registry.dispose();
});

test("discovers two wallet providers without requesting accounts", () => {
  const events = new EventTarget();
  const a = makeProvider(ACCOUNT_A);
  const b = makeProvider(ACCOUNT_B);
  const registry = createWalletProviderRegistry({ eventTarget: events });
  announce(events, WALLET_A, a);
  announce(events, WALLET_B, b);
  assert.deepEqual(registry.list(), [WALLET_A, WALLET_B]);
  assert.ok(Object.isFrozen(registry.list()));
  assert.ok(Object.isFrozen(registry.list()[0]));
  assert.equal(registry.getProvider(WALLET_B.uuid), b);
  assert.equal(registry.getProvider("other"), null);
  assert.deepEqual(a.requests, []);
  assert.deepEqual(b.requests, []);
  registry.dispose();
});

test("repeated wallet announcements do not override first discovered provider", () => {
  const events = new EventTarget();
  const a = makeProvider(ACCOUNT_A);
  const replacement = makeProvider(ACCOUNT_B);
  let changed = 0;
  const registry = createWalletProviderRegistry({
    eventTarget: events,
    onChange: () => changed++,
  });
  announce(events, WALLET_A, a);
  announce(events, { ...WALLET_A, name: "Impostor label" }, replacement);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].name, WALLET_A.name);
  assert.equal(registry.getProvider(WALLET_A.uuid), a);
  assert.equal(changed, 1);
  registry.dispose();
});

test("malformed metadata or missing EIP-1193 request method is rejected", () => {
  const events = new EventTarget();
  const registry = createWalletProviderRegistry({ eventTarget: events });
  const a = makeProvider(ACCOUNT_A);
  announce(events, { ...WALLET_A, uuid: "invalid" }, a);
  announce(events, { ...WALLET_A, name: "" }, a);
  announce(events, { ...WALLET_A, rdns: "wallet<script>" }, a);
  announce(events, WALLET_A, {});
  announce(events, WALLET_A, null);
  assert.deepEqual(registry.list(), []);
  registry.dispose();
});

test("refresh requests providers again without account access", () => {
  const events = new EventTarget();
  let requests = 0;
  events.addEventListener(REQUEST_EVENT, () => requests++);
  const registry = createWalletProviderRegistry({ eventTarget: events });
  assert.equal(requests, 1);
  assert.equal(registry.request(), true);
  assert.equal(requests, 2);
  assert.equal(registry.list().length, 0);
  registry.dispose();
});

test("disposing stops discovery, clears references and blocks future requests", () => {
  const events = new EventTarget();
  let requests = 0;
  events.addEventListener(REQUEST_EVENT, () => requests++);
  const registry = createWalletProviderRegistry({ eventTarget: events });
  const p = makeProvider(ACCOUNT_A);
  announce(events, WALLET_A, p);
  registry.dispose();
  registry.dispose();
  announce(events, WALLET_B, makeProvider(ACCOUNT_B));
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.getProvider(WALLET_A.uuid), null);
  assert.equal(registry.request(), false);
  assert.equal(requests, 1);
});

test("requires event dispatcher and update callback", () => {
  assert.throws(() => createWalletProviderRegistry({ eventTarget: null }), TypeError);
  assert.throws(() => createWalletProviderRegistry({ eventTarget: {} }), TypeError);
  assert.throws(() => createWalletProviderRegistry({
    eventTarget: new EventTarget(), onChange: "not a function",
  }), TypeError);
});

test("each ThreeCore agent can use a separately selected discovered provider", async () => {
  const events = new EventTarget();
  const a = makeProvider(ACCOUNT_A);
  const b = makeProvider(ACCOUNT_B);
  const registry = createWalletProviderRegistry({ eventTarget: events });
  announce(events, WALLET_A, a);
  announce(events, WALLET_B, b);

  const dat = new ThreeCoreWalletSession({
    provider: registry.getProvider(WALLET_A.uuid),
    agent: "DAT",
    siteOrigin: "https://threecore.example",
    approvedOrigins: ["https://threecore.example"],
    expectedAccount: ACCOUNT_A,
    chainId: CHAINS.BASE_SEPOLIA.id,
  });
  const ema = new ThreeCoreWalletSession({
    provider: registry.getProvider(WALLET_B.uuid),
    agent: "EMA",
    siteOrigin: "https://threecore.example",
    approvedOrigins: ["https://threecore.example"],
    expectedAccount: ACCOUNT_B,
    chainId: CHAINS.BASE_SEPOLIA.id,
  });

  await dat.connect();
  await ema.connect();
  assert.equal(dat.state.connected, true);
  assert.equal(ema.state.connected, true);
  assert.equal(await dat.getNativeBalance(), 16n);
  assert.equal(await ema.getNativeBalance(), 16n);
  assert.equal(a.requests.filter(x => x === "eth_requestAccounts").length, 1);
  assert.equal(b.requests.filter(x => x === "eth_requestAccounts").length, 1);
  assert.equal(a.requests.includes("eth_sendTransaction"), false);
  assert.equal(b.requests.includes("personal_sign"), false);
  dat.disconnect();
  ema.disconnect();
  registry.dispose();
});
