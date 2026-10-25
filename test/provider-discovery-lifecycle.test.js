import test from "node:test";
import assert from "node:assert/strict";
import { ANNOUNCE_EVENT, REQUEST_EVENT, createWalletProviderRegistry } from "../src/provider-registry.js";

const info = Object.freeze({ uuid: "12345678-1234-1234-1234-123456789abc", name: "Synthetic", rdns: "test.wallet" });
const tick = () => new Promise(resolve => setImmediate(resolve));
function targetFixture() {
  const listeners = new Set(), calls = [];
  let add = () => {}, remove = () => {}, dispatch = () => true;
  const provider = { request() { throw Error("Discovery must never request accounts"); } };
  const target = {
    addEventListener(type, handler) { calls.push("add"); listeners.add(handler); return add(type, handler); },
    removeEventListener(type, handler) { calls.push("remove"); listeners.delete(handler); return remove(type, handler); },
    dispatchEvent(event) { calls.push("dispatch"); assert.equal(event.type, REQUEST_EVENT); return dispatch(event); },
  };
  return { target, listeners, calls, provider,
    add: fn => { add = fn; }, remove: fn => { remove = fn; }, dispatch: fn => { dispatch = fn; },
    announce() { for (const listener of [...listeners]) listener({ detail: { info, provider } }); } };
}

test("discovery construction failure detaches the listener and cannot retain providers", () => {
  const f = targetFixture(); let notify = 0;
  f.dispatch(() => { throw Error("private dispatcher detail"); });
  assert.throws(() => createWalletProviderRegistry({ eventTarget: f.target, onChange: () => notify++ }),
    error => error instanceof TypeError && !error.message.includes("private"));
  assert.equal(f.listeners.size, 0); f.announce(); assert.equal(notify, 0);
});
for (const receipt of [false, "promise"]) {
  test(`discovery rejects ${receipt} registration before request`, async () => {
    const f = targetFixture();
    f.add(() => receipt === false ? false : Promise.resolve());
    assert.throws(() => createWalletProviderRegistry({ eventTarget: f.target }), TypeError);
    await tick(); assert.equal(f.listeners.size, 0);
    assert.equal(f.calls.filter(value => value === "dispatch").length, 0);
  });
}
test("discovery late registration is removed after it settles", async () => {
  const f = targetFixture(); let complete;
  const ready = new Promise(resolve => { complete = resolve; });
  f.add((type, handler) => { f.listeners.delete(handler); return ready.then(() => f.listeners.add(handler)); });
  assert.throws(() => createWalletProviderRegistry({ eventTarget: f.target }), TypeError);
  complete(); await tick(); assert.equal(f.listeners.size, 0);
  assert.equal(f.calls.includes("dispatch"), false);
});
test("discovery captures target method getters once", () => {
  const f = targetFixture(), target = {}; const reads = {};
  for (const name of ["addEventListener", "removeEventListener", "dispatchEvent"]) {
    reads[name] = 0;
    Object.defineProperty(target, name, { get() {
      reads[name]++; return reads[name] === 1 ? f.target[name] : () => { throw Error("changed method"); };
    } });
  }
  const registry = createWalletProviderRegistry({ eventTarget: target });
  assert.equal(registry.request(), true); registry.dispose();
  assert.deepEqual(Object.values(reads), [1, 1, 1]); assert.equal(f.listeners.size, 0);
});
for (const failure of ["throw", "false", "promise"]) {
  test(`discovery ${failure} refresh fails closed and remains disposed`, async () => {
    const f = targetFixture(), registry = createWalletProviderRegistry({ eventTarget: f.target });
    f.announce(); assert.equal(registry.list().length, 1);
    f.dispatch(() => { if (failure === "throw") throw Error("synthetic");
      return failure === "false" ? false : Promise.resolve(true); });
    assert.equal(registry.request(), false); await tick();
    assert.deepEqual(registry.list(), []); assert.equal(registry.getProvider(info.uuid), null);
    assert.equal(f.listeners.size, 0); assert.equal(registry.request(), false);
  });
}
test("discovery clear is terminal even when removal throws", () => {
  const f = targetFixture(), registry = createWalletProviderRegistry({ eventTarget: f.target });
  f.announce(); const stale = [...f.listeners][0];
  f.remove(() => { throw Error("synthetic remove failure"); });
  assert.doesNotThrow(() => registry.dispose());
  assert.deepEqual(registry.list(), []); assert.equal(registry.getProvider(info.uuid), null);
  stale({ detail: { info, provider: f.provider } }); assert.deepEqual(registry.list(), []);
  assert.equal(registry.request(), false); registry.dispose();
});
test("discovery cannot report request success if an observer disposes during dispatch", () => {
  const f = targetFixture(); let registry;
  registry = createWalletProviderRegistry({ eventTarget: f.target, onChange: () => registry.dispose() });
  f.dispatch(() => { f.announce(); return true; });
  assert.equal(registry.request(), false); assert.deepEqual(registry.list(), []);
});
test("discovery captures observer then once without changing first-provider identity", async () => {
  const f = targetFixture(); let reads = 0, calls = 0;
  const registry = createWalletProviderRegistry({ eventTarget: f.target, onChange: () => ({
    get then() { reads++; return resolve => { calls++; resolve(); }; },
  }) });
  f.announce(); await tick(); f.announce();
  assert.equal(reads, 1); assert.equal(calls, 1);
  assert.equal(registry.getProvider(info.uuid), f.provider); registry.dispose();
});
test("real EventTarget discovery remains synchronous and never requests accounts", () => {
  const target = new EventTarget(); let requests = 0;
  target.addEventListener(REQUEST_EVENT, () => {
    const event = new Event(ANNOUNCE_EVENT);
    Object.defineProperty(event, "detail", { value: { info, provider: { request() { requests++; } } } });
    target.dispatchEvent(event);
  });
  const registry = createWalletProviderRegistry({ eventTarget: target });
  assert.equal(registry.list().length, 1); assert.equal(registry.request(), true);
  assert.equal(requests, 0); registry.dispose(); assert.deepEqual(registry.list(), []);
});
