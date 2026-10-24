import test from "node:test";
import assert from "node:assert/strict";
import { createWalletReadScope, WALLET_READ_METHODS } from "../src/wallet-read-scope.js";
import { deferred, flush } from "./helpers/access-lifecycle.js";

test("cancellation resolves local waiting without waiting for the provider", async () => {
  const wait = deferred();
  const scope = createWalletReadScope({ isCurrent: () => true });
  const pending = scope.invoke(() => wait.promise);
  const rejected = assert.rejects(pending, { code: "STALE_VIEW" });
  assert.equal(scope.state().pending, 1);
  scope.cancel();
  await rejected;
  assert.equal(scope.state().pending, 0);
  assert.equal(scope.check(), false);
  wait.resolve("late result");
  await flush();
  assert.equal(scope.check(), false);
});

for (const outcome of ["resolve", "reject"]) {
  test(`all outstanding reads discard a late ${outcome} after cancellation`, async () => {
    let notifications = 0;
    const scope = createWalletReadScope({ isCurrent: () => true, onSettled: () => notifications++ });
    const waits = Array.from({ length: 32 }, () => deferred());
    const rejected = waits.map(wait => assert.rejects(scope.invoke(() => wait.promise), { code: "STALE_VIEW" }));
    scope.cancel();
    await Promise.all(rejected);
    assert.equal(scope.state().pending, 0);
    assert.equal(notifications, 0);
    for (const wait of waits) wait[outcome](outcome === "reject" ? Error("late private rejection") : "late");
    await flush();
    assert.equal(notifications, 32);
    assert.equal(scope.check(), false);
  });
}

test("capacity rejects the next call before its operation executes", async () => {
  const scope = createWalletReadScope({ isCurrent: () => true });
  const waits = Array.from({ length: 32 }, () => deferred());
  const promises = waits.map(wait => scope.invoke(() => wait.promise));
  let extra = 0;
  await assert.rejects(scope.invoke(() => { extra++; }), { code: "READ_SCOPE_LIMIT" });
  assert.equal(extra, 0);
  assert.equal(scope.state().pending, 32);
  for (const wait of waits) wait.resolve(1);
  assert.deepEqual(await Promise.all(promises), Array(32).fill(1));
  assert.equal(await scope.invoke(() => 2), 2);
  assert.equal(scope.state().pending, 0);
  scope.cancel();
});

for (const permission of [false, 0, 1, null, undefined, "true"]) {
  test(`permission ${String(permission)} is not an exact synchronous true`, async () => {
    const scope = createWalletReadScope({ isCurrent: () => permission });
    let calls = 0;
    await assert.rejects(scope.invoke(() => calls++), { code: "STALE_VIEW" });
    assert.equal(calls, 0);
    assert.equal(scope.state().closed, true);
  });
}

for (const outcome of ["resolve", "reject", "throw"]) {
  test(`async permission ${outcome} is consumed without admitting an operation`, async () => {
    let gets = 0;
    const value = Object.defineProperty({}, "then", { get() {
      assert.equal(++gets, 1);
      return (resolve, reject) => {
        if (outcome === "throw") throw Error("permission error");
        if (outcome === "resolve") resolve(true); else reject(Error("permission rejection"));
      };
    } });
    const scope = createWalletReadScope({ isCurrent: () => value });
    await assert.rejects(scope.invoke(() => { throw Error("should not enter"); }), { code: "STALE_VIEW" });
    await flush();
    assert.equal(gets, 1);
    assert.equal(scope.check(), false);
  });
}

for (const phase of ["before", "during", "after"]) {
  test(`operation generation invalidation ${phase} rejects its result`, async () => {
    let allowed = true, calls = 0;
    const wait = deferred();
    const scope = createWalletReadScope({ isCurrent: () => allowed });
    if (phase === "before") allowed = false;
    const result = scope.invoke(() => {
      calls++;
      if (phase === "during") allowed = false;
      return wait.promise;
    });
    const rejected = assert.rejects(result, { code: "STALE_VIEW" });
    if (phase === "after") allowed = false;
    wait.resolve("result");
    await rejected;
    assert.equal(calls, phase === "before" ? 0 : 1);
    assert.equal(scope.state().closed, true);
  });
}

test("a reentrant currentness predicate cannot recurse indefinitely", () => {
  let scope, attempts = 0;
  scope = createWalletReadScope({ isCurrent() { attempts++; return scope.check(); } });
  assert.equal(scope.check(), false);
  assert.equal(attempts, 1);
  assert.equal(scope.state().closed, true);
});

for (const name of WALLET_READ_METHODS) {
  test(`bound method ${name} retains its receiver and captures the original function`, async () => {
    const scope = createWalletReadScope({ isCurrent: () => true });
    const calls = [];
    const session = { state: { connected: true }, [name](...args) {
      assert.equal(this, session);
      calls.push(args);
      return 42;
    } };
    const view = scope.bind(session);
    session[name] = () => { throw Error("replacement must not be called"); };
    assert.equal(await view[name]("input", 7), 42);
    assert.deepEqual(calls, [["input", 7]]);
    assert(Object.isFrozen(view));
    scope.cancel();
    await assert.rejects(view[name]("later"), { code: "STALE_VIEW" });
    assert.equal(calls.length, 1);
  });
  test(`getter cancellation while binding ${name} cannot expose a live operation`, () => {
    const scope = createWalletReadScope({ isCurrent: () => true });
    const session = { state: {} };
    Object.defineProperty(session, name, { get() { scope.cancel(); return () => 42; } });
    assert.throws(() => scope.bind(session), { code: "STALE_VIEW" });
    assert.equal(scope.state().pending, 0);
  });
}

test("bound views expose no wallet authority or arbitrary request passthrough", () => {
  const scope = createWalletReadScope({ isCurrent: () => true });
  let reads = 0;
  const session = { state: { connected: true } };
  for (const name of ["request", "connect", "disconnect", "sendTransaction", "signMessage", "privateKey"]) {
    Object.defineProperty(session, name, { get() { reads++; throw Error("sensitive getter"); } });
  }
  const view = scope.bind(session);
  assert.deepEqual(Object.keys(view), ["state"]);
  assert.equal(reads, 0);
  scope.cancel();
});

test("state getter invalidation is checked after reading as well as before", () => {
  const scope = createWalletReadScope({ isCurrent: () => true });
  const session = { get state() { scope.cancel(); return { connected: true }; } };
  const view = scope.bind(session);
  assert.throws(() => view.state, { code: "STALE_VIEW" });
});

for (const outcome of ["value", "throw", "rejected"]) {
  test(`synchronous operation ${outcome} releases its local slot`, async () => {
    const scope = createWalletReadScope({ isCurrent: () => true });
    const error = Error("controlled failure");
    const result = scope.invoke(() => {
      if (outcome === "throw") throw error;
      return outcome === "value" ? 23 : Promise.reject(error);
    });
    if (outcome === "value") assert.equal(await result, 23);
    else await assert.rejects(result, value => value === error);
    assert.equal(scope.state().pending, 0);
    assert.equal(scope.check(), true);
    scope.cancel();
  });
}

for (const kind of ["throw", "reject", "cancel"]) {
  test(`settlement observer ${kind} cannot create an unhandled rejection`, async () => {
    let scope;
    scope = createWalletReadScope({ isCurrent: () => true, onSettled() {
      if (kind === "throw") throw Error("observer failure");
      if (kind === "reject") return Promise.reject(Error("observer rejection"));
      scope.cancel();
    } });
    const result = scope.invoke(() => 9);
    if (kind === "cancel") await assert.rejects(result, { code: "STALE_VIEW" });
    else assert.equal(await result, 9);
    await flush();
    assert.equal(scope.state().pending, 0);
    scope.cancel();
  });
}

test("a thenable cancelling while adopted cannot deliver its later success", async () => {
  const scope = createWalletReadScope({ isCurrent: () => true });
  let called = 0;
  const result = scope.invoke(() => ({ then(resolve, reject) {
    called++;
    scope.cancel();
    resolve(99);
    reject(Error("late failure"));
  } }));
  await assert.rejects(result, { code: "STALE_VIEW" });
  await flush();
  assert.equal(called, 1);
  assert.equal(scope.state().pending, 0);
});
