import test from "node:test";
import assert from "node:assert/strict";
import { createTokenIdentityController } from "../src/token-identity-controller.js";
import { observation, deferred } from "./helpers/identity-fixtures.js";

const row = observation();
const context = () => ({ agent: row.agent, chainId: row.chainId, account: row.account, tokenAddress: row.tokenAddress });

for (const at of [1, 2]) for (const action of ["cancel", "dispose"]) {
  test(`identity ${action} inside context read ${at} prevents adapter work`, async () => {
    let controller, calls = 0, reads = 0;
    controller = createTokenIdentityController({
      getContext() { if (++calls === at) controller[action](); return context(); },
      read: async () => { reads++; return row; },
    });
    assert.equal(await controller.inspect(), false);
    assert.equal(reads, 0);
    assert.equal(controller.state().phase, action === "cancel" ? "cancelled" : "disposed");
  });
}

test("identity cancellation during returned observation capture stays cancelled", async () => {
  let controller, triggered = false;
  const value = new Proxy(row, { getOwnPropertyDescriptor(target, key) {
    if (!triggered) { triggered = true; controller.cancel(); }
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  controller = createTokenIdentityController({ getContext: context, read: async () => value });
  assert.equal(await controller.inspect(), false);
  assert.equal(controller.state().phase, "cancelled");
  assert.equal(controller.state().observation, null);
});

test("identity abort listener can start a new read without losing its cancellation handle", async () => {
  let controller, second, firstSignal, secondSignal, reads = 0;
  const gates = [deferred(), deferred()];
  controller = createTokenIdentityController({ getContext: context, read: input => {
    const index = reads++;
    if (index === 0) { firstSignal = input.signal; input.signal.addEventListener("abort", () => { second = controller.inspect(); }); }
    else secondSignal = input.signal;
    return gates[index].promise;
  } });
  const first = controller.inspect();
  controller.cancel();
  assert.equal(firstSignal.aborted, true);
  assert.equal(controller.state().phase, "reading");
  controller.cancel();
  assert.equal(secondSignal.aborted, true);
  gates[0].resolve(row); gates[1].resolve(row);
  assert.equal(await first, false);
  assert.equal(await second, false);
});

test("identity invalid outer context cannot erase a nested successful read", async () => {
  let controller, nested, calls = 0;
  controller = createTokenIdentityController({ getContext() {
    if (++calls === 1) { nested = controller.inspect(); throw Error("old context unavailable"); }
    return context();
  }, read: async () => row });
  const old = controller.inspect();
  assert.equal(await old, false);
  assert.equal(await nested, true);
  assert.equal(controller.state().phase, "ready");
});

test("identity context accessors are not executed", async () => {
  let getterCalls = 0, reads = 0;
  const value = context();
  Object.defineProperty(value, "account", { enumerable: true, get() { getterCalls++; return row.account; } });
  const controller = createTokenIdentityController({ getContext: () => value, read: async () => { reads++; return row; } });
  assert.equal(await controller.inspect(), false);
  assert.equal(getterCalls, 0);
  assert.equal(reads, 0);
});

test("identity progress accessors cannot cancel or rewrite the read", async () => {
  const gate = deferred();
  let controller, update, getters = 0;
  controller = createTokenIdentityController({ getContext: context, read: input => { update = input.onProgress; return gate.promise; } });
  const pending = controller.inspect();
  update({ agent: "DAT", get stage() { getters++; controller.cancel(); return "complete"; } });
  assert.equal(getters, 0);
  assert.equal(controller.state().progress, null);
  assert.equal(controller.state().phase, "reading");
  gate.resolve(row);
  assert.equal(await pending, true);
});

test("identity cancellation during progress reflection prevents publication", async () => {
  const gate = deferred();
  let controller, update, once = false;
  controller = createTokenIdentityController({ getContext: context, read: input => { update = input.onProgress; return gate.promise; } });
  const pending = controller.inspect();
  update(new Proxy({ agent: "DAT", stage: "metadata" }, { getOwnPropertyDescriptor(target, key) {
    if (!once) { once = true; controller.cancel(); }
    return Reflect.getOwnPropertyDescriptor(target, key);
  } }));
  assert.equal(controller.state().phase, "cancelled");
  assert.equal(controller.state().progress, null);
  gate.resolve(row);
  assert.equal(await pending, false);
});

test("identity error-code getter is not invoked", async () => {
  let getters = 0;
  const controller = createTokenIdentityController({ getContext: context, read: async () => {
    throw { get code() { getters++; return "IDENTITY_CANCELLED"; } };
  } });
  assert.equal(await controller.inspect(), false);
  assert.equal(getters, 0);
  assert.equal(controller.state().errorCode, "IDENTITY_UNAVAILABLE");
});

test("identity reflected diagnostic cannot overwrite cancellation", async () => {
  let controller;
  const error = new Proxy({ code: "IDENTITY_UNAVAILABLE" }, { getOwnPropertyDescriptor(target, key) {
    controller.cancel(); return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  controller = createTokenIdentityController({ getContext: context, read: async () => { throw error; } });
  assert.equal(await controller.inspect(), false);
  assert.equal(controller.state().phase, "cancelled");
  assert.equal(controller.state().errorCode, null);
});
