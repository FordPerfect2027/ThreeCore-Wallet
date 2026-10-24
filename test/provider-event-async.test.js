import test from "node:test";
import assert from "node:assert/strict";
import { observeWalletProvider } from "../src/provider-events.js";
import { drain } from "./helpers/rpc-supervisor-fixtures.js";
const A = "0x" + "11".repeat(20);

function fixture() {
  const entries = [], active = new Map(), removed = [];
  let deliveries = 0;
  const provider = {
    on(name, fn) { entries.push([name, fn]); active.set(name, fn); return this; },
    removeListener(name, fn) { removed.push([name, fn]); active.delete(name); return this; },
  };
  const handlers = { accountsChanged() { deliveries++; }, chainChanged() { deliveries++; }, disconnect() { deliveries++; } };
  return { provider, handlers, entries, active, removed, deliveries: () => deliveries };
}

for (const phase of ["accountsChanged", "chainChanged", "disconnect"]) {
  for (const outcome of ["resolve", "reject", "never"]) {
    test("async listener registration fails closed: " + phase + " / " + outcome, async () => {
      const f = fixture();
      const install = f.provider.on;
      f.provider.on = function(name, fn) {
        install.call(this, name, fn);
        if (name !== phase) return this;
        if (outcome === "resolve") return Promise.resolve(this);
        if (outcome === "reject") return Promise.reject(Error("private asynchronous registration failure"));
        return new Promise(() => {});
      };
      assert.throws(() => observeWalletProvider(f.provider, f.handlers), { code: "PROVIDER_EVENT_FAILURE" });
      await drain();
      assert.equal(f.active.size, 0);
      assert.equal(f.removed.length, f.entries.length);
      for (const [, listener] of f.entries) listener([A]);
      assert.equal(f.deliveries(), 0);
    });
  }
}

test("then getter for asynchronous registration is captured once", async () => {
  const f = fixture();
  const install = f.provider.on;
  let gets = 0, calls = 0;
  f.provider.on = function(name, fn) {
    install.call(this, name, fn);
    return Object.defineProperty({}, "then", { get() {
      gets++;
      if (gets > 1) throw Error("read twice");
      return function(resolve) { calls++; resolve("unused"); };
    } });
  };
  assert.throws(() => observeWalletProvider(f.provider, f.handlers), { code: "PROVIDER_EVENT_FAILURE" });
  await drain();
  assert.equal(gets, 1);
  assert.equal(calls, 1);
  assert.equal(f.active.size, 0);
});

test("throwing then accessor cannot leave a partially registered observer active", () => {
  const f = fixture();
  const install = f.provider.on;
  f.provider.on = function(name, fn) {
    install.call(this, name, fn);
    return Object.defineProperty({}, "then", { get() { throw Error("private then failure"); } });
  };
  assert.throws(() => observeWalletProvider(f.provider, f.handlers), error => {
    assert.equal(error.code, "PROVIDER_EVENT_FAILURE");
    assert(!error.message.includes("private")); return true;
  });
  assert.equal(f.active.size, 0);
});

test("a hostile thenable resolving twice is consumed without installing later listeners", async () => {
  const f = fixture();
  const install = f.provider.on;
  f.provider.on = function(name, fn) {
    install.call(this, name, fn);
    return { then(resolve, reject) { resolve("first"); reject(Error("second")); resolve("third"); } };
  };
  assert.throws(() => observeWalletProvider(f.provider, f.handlers), { code: "PROVIDER_EVENT_FAILURE" });
  await drain();
  assert.equal(f.entries.length, 1);
  assert.equal(f.active.size, 0);
});

test("throwing thenable function is consumed rather than becoming an unhandled rejection", async () => {
  const f = fixture();
  const install = f.provider.on;
  f.provider.on = function(name, fn) {
    install.call(this, name, fn);
    return { then() { throw Error("private thenable throw"); } };
  };
  assert.throws(() => observeWalletProvider(f.provider, f.handlers), { code: "PROVIDER_EVENT_FAILURE" });
  await drain();
  assert.equal(f.active.size, 0);
});

test("an EventEmitter-style provider return is not inspected for then", () => {
  const f = fixture();
  let reads = 0;
  Object.defineProperty(f.provider, "then", { get() { reads++; throw Error("not a promise"); } });
  const observer = observeWalletProvider(f.provider, f.handlers);
  assert.equal(f.entries.length, 3);
  observer.dispose();
  assert.equal(reads, 0);
});

for (const mode of ["resolve", "reject", "throw-then", "never"]) {
  test("asynchronous removal cannot reopen local callbacks: " + mode, async () => {
    const f = fixture();
    const remove = f.provider.removeListener;
    f.provider.removeListener = function(name, fn) {
      remove.call(this, name, fn);
      if (mode === "resolve") return Promise.resolve(this);
      if (mode === "reject") return Promise.reject(Error("private remove failure"));
      if (mode === "throw-then") return { then() { throw Error("private removal thenable"); } };
      return new Promise(() => {});
    };
    const observer = observeWalletProvider(f.provider, f.handlers);
    observer.dispose();
    await drain();
    assert.equal(f.removed.length, 3);
    assert.equal(f.active.size, 0);
    for (const [, fn] of f.entries) fn([A]);
    assert.equal(f.deliveries(), 0);
  });
}

test("async cleanup failures do not skip other listeners after partial installation", async () => {
  const f = fixture();
  const install = f.provider.on, remove = f.provider.removeListener;
  f.provider.on = function(name, fn) {
    install.call(this, name, fn);
    if (name === "disconnect") return Promise.reject(Error("install failure"));
    return this;
  };
  f.provider.removeListener = function(name, fn) {
    remove.call(this, name, fn);
    return Promise.reject(Error("remove failure"));
  };
  assert.throws(() => observeWalletProvider(f.provider, f.handlers), { code: "PROVIDER_EVENT_FAILURE" });
  await drain();
  assert.equal(f.removed.length, 3);
  assert.equal(f.active.size, 0);
});

test("late asynchronous registration completion cannot restore disposed listeners", async () => {
  const f = fixture();
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const install = f.provider.on;
  f.provider.on = function(name, fn) { install.call(this, name, fn); return pending; };
  assert.throws(() => observeWalletProvider(f.provider, f.handlers), { code: "PROVIDER_EVENT_FAILURE" });
  resolve(f.provider); await drain();
  for (const [, fn] of f.entries) fn([A]);
  assert.equal(f.deliveries(), 0);
  assert.equal(f.entries.length, 1);
});
