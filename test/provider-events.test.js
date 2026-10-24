import test from "node:test";
import assert from "node:assert/strict";
import { observeWalletProvider, snapshotWalletAccounts, snapshotWalletChain,
  WALLET_EVENT_NAMES } from "../src/provider-events.js";
const A = "0x" + "ab".repeat(20), B = "0x" + "cd".repeat(20);

function emitter() {
  const handlers = new Map(), added = [], removed = [];
  const provider = {
    on(name, fn) {
      assert.equal(this, provider);
      added.push([name, fn]);
      handlers.set(name, fn);
    },
    removeListener(name, fn) {
      assert.equal(this, provider);
      removed.push([name, fn]);
      if (handlers.get(name) === fn) handlers.delete(name);
    },
  };
  return { provider, handlers, added, removed,
    emit(name, value) { handlers.get(name)?.(value); } };
}
function callbacks() {
  const seen = [];
  const handlers = Object.fromEntries(WALLET_EVENT_NAMES.map(name =>
    [name, value => seen.push({ name, value })]));
  return { handlers, seen };
}

test("account snapshots copy, normalize and freeze only bounded address strings", () => {
  const input = [A.toUpperCase().replace("0X", "0x"), B];
  const result = snapshotWalletAccounts(input);
  input[0] = B;
  assert.deepEqual(result, [A, B]);
  assert(Object.isFrozen(result));
  assert.deepEqual(snapshotWalletAccounts([]), []);
});
for (const input of [null, {}, "account", true, 1, ["bad"], [A, 5], [A, null], ["0x1"],
  ["0x" + "00".repeat(21)], ["  " + A], [A + "\n"], new Array(1)]) {
  test("invalid event account payload is refused: " + String(input), () => {
    assert.equal(snapshotWalletAccounts(input), null);
  });
}
test("event account count boundary accepts 128 and rejects 129", () => {
  assert.equal(snapshotWalletAccounts(Array(128).fill(A)).length, 128);
  assert.equal(snapshotWalletAccounts(Array(129).fill(A)), null);
});
test("event account getters do not run even when they would return the right address", () => {
  let reads = 0;
  const value = [A];
  Object.defineProperty(value, "0", { get() { reads++; return A; } });
  assert.equal(snapshotWalletAccounts(value), null);
  assert.equal(reads, 0);
});
test("event account metadata, symbols and extra index names are rejected", () => {
  for (const key of ["balance", "__proto__", Symbol("secret"), "02"]) {
    const value = [A];
    Object.defineProperty(value, key, { value: "untrusted" });
    assert.equal(snapshotWalletAccounts(value), null);
  }
});
test("inherited account slots cannot substitute for own data", () => {
  const value = new Array(1);
  Object.setPrototypeOf(value, { 0: A });
  assert.equal(snapshotWalletAccounts(value), null);
});
test("throwing event proxies are contained", () => {
  for (const trap of ["getOwnPropertyDescriptor", "ownKeys"]) {
    const value = new Proxy([A], { [trap]() { throw Error("private event"); } });
    assert.equal(snapshotWalletAccounts(value), null);
  }
});
for (const chain of [null, undefined, 8453, true, {}, "8453", "0x", "0xzz", "0x-1",
  "0x20000000000000", "0x0000000000000001", "0x2105\n"]) {
  test("invalid event chain is refused: " + String(chain), () => {
    assert.equal(snapshotWalletChain(chain), null);
  });
}
test("chain snapshots are canonical, bounded and do not coerce objects", () => {
  assert.equal(snapshotWalletChain("0x02105"), "0x2105");
  assert.equal(snapshotWalletChain("0X14A34"), "0x14a34");
  assert.equal(snapshotWalletChain("0x1fffffffffffff"), "0x1fffffffffffff");
  assert.equal(snapshotWalletChain("0x0"), "0x0");
  let coercions = 0;
  assert.equal(snapshotWalletChain({ toString() { coercions++; return "0x2105"; } }), null);
  assert.equal(coercions, 0);
});

test("registration captures one on and one removal function", () => {
  const e = emitter(), c = callbacks();
  const on = e.provider.on, remove = e.provider.removeListener;
  let onReads = 0, removeReads = 0;
  Object.defineProperty(e.provider, "on", { get() { onReads++; return on; }, configurable: true });
  Object.defineProperty(e.provider, "removeListener", { get() { removeReads++; return remove; }, configurable: true });
  const observation = observeWalletProvider(e.provider, c.handlers);
  Object.defineProperty(e.provider, "removeListener", { get() { throw Error("replacement"); } });
  observation.dispose();
  assert.equal(onReads, 1);
  assert.equal(removeReads, 1);
  assert.equal(e.added.length, 3);
  assert.equal(e.removed.length, 3);
});

test("disconnect details are never inspected or forwarded", () => {
  const e = emitter(), c = callbacks();
  const observation = observeWalletProvider(e.provider, c.handlers);
  const payload = new Proxy({}, { get() { throw Error("do not inspect disconnect details"); } });
  e.emit("disconnect", payload);
  assert.deepEqual(c.seen, [{ name: "disconnect", value: undefined }]);
  observation.dispose();
});

test("malformed account and chain events become null observations for fail-closed owners", () => {
  const e = emitter(), c = callbacks();
  const observation = observeWalletProvider(e.provider, c.handlers);
  e.emit("accountsChanged", ["invalid"]);
  e.emit("chainChanged", "invalid");
  assert.deepEqual(c.seen, [{ name: "accountsChanged", value: null },
    { name: "chainChanged", value: null }]);
  observation.dispose();
});

test("disposed callbacks retained by an extension stay inert", () => {
  const e = emitter(), c = callbacks();
  const observation = observeWalletProvider(e.provider, c.handlers);
  observation.dispose(); observation.dispose();
  for (const [, callback] of e.added) callback([A]);
  assert.equal(c.seen.length, 0);
  assert.equal(e.removed.length, 3);
});

test("generation invalidation during payload snapshot suppresses delivery", () => {
  const e = emitter(), c = callbacks();
  let current = true;
  const observation = observeWalletProvider(e.provider, c.handlers, () => current);
  const value = new Proxy([A], { ownKeys(target) { current = false; return Reflect.ownKeys(target); } });
  e.emit("accountsChanged", value);
  assert.equal(c.seen.length, 0);
  observation.dispose();
});

for (const failingName of WALLET_EVENT_NAMES) {
  test("partially installed listener cleaned after registration throws: " + failingName, () => {
    const e = emitter(), c = callbacks();
    const base = e.provider.on;
    e.provider.on = function(name, fn) {
      base.call(this, name, fn);
      if (name === failingName) throw Error("private registration failure");
    };
    assert.throws(() => observeWalletProvider(e.provider, c.handlers), error => {
      assert.equal(error.code, "PROVIDER_EVENT_FAILURE");
      assert(!error.message.includes("private"));
      return true;
    });
    assert.equal(e.handlers.size, 0);
    assert.equal(e.removed.length, e.added.length);
    for (const [, callback] of e.added) callback([A]);
    assert.equal(c.seen.length, 0);
  });
}

test("reentrant invalidation during registration stops the remaining registrations", () => {
  const e = emitter(), c = callbacks();
  let current = true;
  const base = e.provider.on;
  e.provider.on = function(name, fn) { base.call(this, name, fn); current = false; };
  assert.throws(() => observeWalletProvider(e.provider, c.handlers, () => current),
    { code: "PROVIDER_EVENT_FAILURE" });
  assert.equal(e.added.length, 1);
  assert.equal(e.removed.length, 1);
});

test("throwing cleanup cannot skip removal attempts for the other event names", () => {
  const e = emitter(), c = callbacks();
  const attempts = [];
  e.provider.removeListener = name => { attempts.push(name); throw Error("cleanup failure"); };
  const observation = observeWalletProvider(e.provider, c.handlers);
  observation.dispose();
  assert.deepEqual(attempts, WALLET_EVENT_NAMES);
  for (const [, callback] of e.added) callback([A]);
  assert.equal(c.seen.length, 0);
});

test("eventless adapters retain bounded polling compatibility", () => {
  const c = callbacks();
  for (const provider of [{}, { on: null }, { on: true }]) {
    const observation = observeWalletProvider(provider, c.handlers);
    observation.dispose();
  }
  assert.equal(c.seen.length, 0);
});

test("providers without a working removal function cannot reanimate disposed callbacks", () => {
  const e = emitter(), c = callbacks();
  delete e.provider.removeListener;
  const observation = observeWalletProvider(e.provider, c.handlers);
  observation.dispose();
  e.emit("accountsChanged", [A]); e.emit("chainChanged", "0x2105"); e.emit("disconnect");
  assert.equal(c.seen.length, 0);
});

for (const name of ["on"]) {
  test("inaccessible provider event service fails before subscription: " + name, () => {
    const e = emitter(), c = callbacks();
    Object.defineProperty(e.provider, name, { get() { throw Error("sensitive service error"); } });
    assert.throws(() => observeWalletProvider(e.provider, c.handlers), { code: "PROVIDER_EVENT_FAILURE" });
    assert.equal(e.added.length, 0);
  });
}

test("closed or throwing owner guards prevent any subscription", () => {
  for (const guard of [() => false, () => 1, () => { throw Error("owner failure"); }]) {
    const e = emitter(), c = callbacks();
    assert.throws(() => observeWalletProvider(e.provider, c.handlers, guard), { code: "PROVIDER_EVENT_FAILURE" });
    assert.equal(e.added.length, 0);
  }
});

test("owner guard is checked before reading an event payload", () => {
  const e = emitter(), c = callbacks();
  let current = true, inspected = 0;
  const observation = observeWalletProvider(e.provider, c.handlers, () => current);
  current = false;
  e.emit("accountsChanged", new Proxy([A], { ownKeys() { inspected++; throw Error(); } }));
  assert.equal(inspected, 0);
  assert.equal(c.seen.length, 0);
  observation.dispose();
});
