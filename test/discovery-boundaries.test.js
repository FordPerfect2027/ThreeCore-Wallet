import test from "node:test";
import assert from "node:assert/strict";
import { ANNOUNCE_EVENT, REQUEST_EVENT, createWalletProviderRegistry } from "../src/provider-registry.js";

const INFO = Object.freeze({
  uuid: "aabbccdd-1234-4234-8234-aabbccddeeff", name: "Synthetic Wallet", rdns: "test.synthetic",
});
function target() {
  // Synchronous dispatch exposes listener exceptions directly to assertions.
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatchEvent(event) { for (const fn of [...listeners.get(event.type) ?? []]) fn(event); return true; },
    announce(detail) { this.dispatchEvent({ type: ANNOUNCE_EVENT, detail }); },
  };
}
function provider() {
  const calls = [];
  return { calls, request(args) { calls.push(args); throw Error("Discovery must not issue RPC"); } };
}
const throwing = () => { throw Error("Untrusted property access"); };
const accessor = (object, key, get) => Object.defineProperty(object, key, { get, configurable: true });
const badEvents = [
  ["event.detail", () => accessor({ type: ANNOUNCE_EVENT }, "detail", throwing)],
  ["detail.info", p => ({ type: ANNOUNCE_EVENT, detail: accessor({ provider: p }, "info", throwing) })],
  ["detail.provider", () => ({ type: ANNOUNCE_EVENT, detail: accessor({ info: INFO }, "provider", throwing) })],
  ["provider.request", () => ({ type: ANNOUNCE_EVENT, detail: { info: INFO, provider: accessor({}, "request", throwing) } })],
  ...["uuid", "name", "rdns"].map(key => ["info." + key, p => ({
    type: ANNOUNCE_EVENT, detail: { info: accessor({ ...INFO }, key, throwing), provider: p },
  })]),
  ["revoked proxy", p => {
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    return { type: ANNOUNCE_EVENT, detail: { info: revoked.proxy, provider: p } };
  }],
];
for (const [name, event] of badEvents) {
  test("isolates throwing announcement property: " + name, () => {
    const events = target(), p = provider();
    const registry = createWalletProviderRegistry({ eventTarget: events });
    try {
      assert.doesNotThrow(() => events.dispatchEvent(event(p)));
      assert.deepEqual(registry.list(), []);
      events.announce({ info: INFO, provider: p });
      assert.equal(registry.getProvider(INFO.uuid), p);
      assert.deepEqual(p.calls, []);
    } finally { registry.dispose(); }
  });
}

test("stores the same provider whose request method was checked", () => {
  const events = target(), original = provider(), replacement = provider();
  const registry = createWalletProviderRegistry({ eventTarget: events });
  let reads = 0;
  try {
    events.announce(accessor({ info: INFO }, "provider", () => ++reads === 1 ? original : replacement));
    assert.equal(registry.getProvider(INFO.uuid), original);
    assert.equal(reads, 1);
    assert.deepEqual(original.calls, []);
    assert.deepEqual(replacement.calls, []);
  } finally { registry.dispose(); }
});

test("snapshots event detail, info and text fields once", () => {
  const events = target(), p = provider();
  const registry = createWalletProviderRegistry({ eventTarget: events });
  const reads = { detail: 0, info: 0, uuid: 0, name: 0, rdns: 0 };
  const info = {};
  for (const key of ["uuid", "name", "rdns"]) accessor(info, key, () => {
    reads[key]++; return reads[key] === 1 ? INFO[key] : "invalid after first read";
  });
  const detail = accessor({ provider: p }, "info", () => { reads.info++; return info; });
  const event = accessor({ type: ANNOUNCE_EVENT }, "detail", () => { reads.detail++; return detail; });
  try {
    events.dispatchEvent(event);
    assert.deepEqual(registry.list(), [INFO]);
    assert.deepEqual(reads, { detail: 1, info: 1, uuid: 1, name: 1, rdns: 1 });
  } finally { registry.dispose(); }
});

test("case-equivalent UUIDs keep the first provider and one chooser entry", () => {
  const events = target(), first = provider(), other = provider();
  let changes = 0;
  const registry = createWalletProviderRegistry({ eventTarget: events, onChange: () => changes++ });
  try {
    events.announce({ info: { ...INFO, uuid: INFO.uuid.toUpperCase() }, provider: first });
    events.announce({ info: INFO, provider: other });
    assert.deepEqual(registry.list(), [INFO]);
    assert.equal(registry.getProvider(INFO.uuid), first);
    assert.equal(registry.getProvider(INFO.uuid.toUpperCase()), first);
    assert.equal(changes, 1);
    assert.deepEqual(other.calls, []);
  } finally { registry.dispose(); }
});

test("disposal during metadata access cannot repopulate the registry", () => {
  const events = target(), p = provider();
  let changes = 0;
  const registry = createWalletProviderRegistry({ eventTarget: events, onChange: () => changes++ });
  const info = accessor({ ...INFO }, "name", () => { registry.dispose(); return INFO.name; });
  events.announce({ info, provider: p });
  assert.deepEqual(registry.list(), []);
  assert.equal(changes, 0);
  assert.equal(registry.request(), false);
});

test("later metadata mutation cannot change the accepted snapshot", () => {
  const events = target(), p = provider(), info = { ...INFO };
  const detail = { info, provider: p };
  const registry = createWalletProviderRegistry({ eventTarget: events });
  try {
    events.announce(detail);
    info.name = "Changed"; info.uuid = "bad"; detail.provider = provider();
    assert.deepEqual(registry.list(), [INFO]);
    assert.equal(registry.getProvider(INFO.uuid), p);
  } finally { registry.dispose(); }
});

test("unrendered icons and unknown properties are not read or frozen", () => {
  const events = target(), p = provider();
  const info = accessor(accessor({ ...INFO }, "icon", throwing), "extra", throwing);
  const registry = createWalletProviderRegistry({ eventTarget: events });
  try {
    assert.doesNotThrow(() => events.announce({ info, provider: p }));
    assert.deepEqual(registry.list(), [INFO]);
    assert.equal(Object.isFrozen(p), false);
    assert.equal(Object.isFrozen(info), false);
    assert.deepEqual(p.calls, []);
  } finally { registry.dispose(); }
});

test("duplicate names and rdns do not collapse independent provider UUIDs", () => {
  const events = target(), first = provider(), second = provider();
  const otherInfo = { ...INFO, uuid: "12345678-1234-4234-8234-123456789abc" };
  const registry = createWalletProviderRegistry({ eventTarget: events });
  try {
    events.announce({ info: INFO, provider: first });
    events.announce({ info: otherInfo, provider: second });
    assert.equal(registry.list().length, 2);
    assert.equal(registry.getProvider(INFO.uuid), first);
    assert.equal(registry.getProvider(otherInfo.uuid), second);
  } finally { registry.dispose(); }
});

test("synchronous initial discovery can skip bad metadata and accept a later provider", () => {
  const events = target(), p = provider();
  events.addEventListener(REQUEST_EVENT, () => {
    events.announce({ info: accessor({}, "uuid", throwing), provider: p });
    events.announce({ info: INFO, provider: p });
  });
  let registry;
  try {
    assert.doesNotThrow(() => { registry = createWalletProviderRegistry({ eventTarget: events }); });
    assert.deepEqual(registry.list(), [INFO]);
    assert.deepEqual(p.calls, []);
  } finally { registry?.dispose(); }
});
