import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createAllowanceController } from "../src/allowance-controller.js";
import { targets, record, S1, S2, ACCOUNT, deferred } from "./helpers/allowance-fixtures.js";

const context = () => ({ ...targets(), account: ACCOUNT });
const configure = controller => { assert.equal(controller.preview(S1 + "\n" + S2), true); assert.equal(controller.apply(), true); };

test("allowance observer recursive cancellation is bounded", () => {
  let controller, calls = 0;
  controller = createAllowanceController({ getContext: context, read: async plan => record({ targets: plan }),
    onChange() { if (++calls < 16) controller.cancel(); },
  });
  assert.equal(controller.preview(S1), false);
  assert.ok(calls <= 2, `received ${calls} notifications`);
  assert.equal(controller.state().phase, "cancelled");
});

test("allowance disposal clears observers before abort and remains terminal", async () => {
  let controller, notifications = 0, aborts = 0;
  const gate = deferred();
  controller = createAllowanceController({ getContext: context, onChange() { notifications++; },
    read(plan, options) { options.signal.addEventListener("abort", () => { aborts++; controller.cancel(); }); return gate.promise; },
  });
  configure(controller);
  const pending = controller.inspect();
  const before = notifications;
  controller.dispose();
  gate.resolve(record());
  assert.equal(await pending, false);
  assert.equal(notifications, before);
  assert.equal(aborts, 1);
  assert.equal(controller.state().phase, "disposed");
});

test("allowance observer malformed asynchronous then cannot reject globally", () => {
  const controllerUrl = new URL("../src/allowance-controller.js", import.meta.url).href;
  const fixtureUrl = new URL("./helpers/allowance-fixtures.js", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", `
    import { createAllowanceController } from ${JSON.stringify(controllerUrl)};
    import { targets,record,S1,ACCOUNT } from ${JSON.stringify(fixtureUrl)};
    const controller=createAllowanceController({getContext:()=>({...targets(),account:ACCOUNT}),
      read:async()=>record(),onChange:()=>({async then(){throw Error('synthetic callback');}})});
    if(!controller.preview(S1))throw Error('preview failed');
    setTimeout(()=>console.log('contained'),15);
  `], { timeout: 10000, encoding: "utf8", windowsHide: true });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
  assert.equal(child.stdout.trim(), "contained");
});

for (const at of [1, 2]) for (const action of ["cancel", "dispose"]) {
  test(`allowance ${action} inside read context ${at} prevents work`, async () => {
    let controller, armed = false, calls = 0, reads = 0;
    controller = createAllowanceController({ getContext() {
      if (armed && ++calls === at) controller[action](); return context();
    }, read: async plan => { reads++; return record({ targets: plan }); } });
    configure(controller); armed = true;
    assert.equal(await controller.inspect(), false);
    assert.equal(reads, 0);
    assert.equal(controller.state().phase, action === "cancel" ? "cancelled" : "disposed");
  });
}

test("allowance cancelled observation capture does not restore a result", async () => {
  let controller, once = false;
  controller = createAllowanceController({ getContext: context, read: async plan => new Proxy(record({ targets: plan }), {
    getOwnPropertyDescriptor(target, key) { if (!once) { once = true; controller.cancel(); } return Reflect.getOwnPropertyDescriptor(target, key); },
  }) });
  configure(controller);
  assert.equal(await controller.inspect(), false);
  assert.equal(controller.state().phase, "cancelled");
  assert.equal(controller.state().observation, null);
});

test("allowance nested read started by abort retains its state and abort handle", async () => {
  let controller, second, secondSignal, index = 0;
  const gates = [deferred(), deferred()];
  controller = createAllowanceController({ getContext: context, read(plan, options) {
    const i = index++;
    if (i === 0) options.signal.addEventListener("abort", () => { second = controller.inspect(); });
    else secondSignal = options.signal;
    return gates[i].promise;
  } });
  configure(controller);
  const first = controller.inspect();
  controller.cancel();
  assert.equal(controller.state().phase, "reading");
  controller.cancel();
  assert.equal(secondSignal.aborted, true);
  gates[0].resolve(record()); gates[1].resolve(record());
  assert.equal(await first, false); assert.equal(await second, false);
});

test("allowance cancelled apply cannot commit its earlier preview", () => {
  let controller, armed = false;
  controller = createAllowanceController({ getContext() {
    if (armed) { armed = false; controller.cancel(); } return context();
  }, read: async () => record() });
  controller.preview(S1); armed = true;
  assert.equal(controller.apply(), false);
  assert.equal(controller.state().phase, "cancelled");
  assert.equal(controller.state().plan, null);
});

test("allowance reentrant apply preserves a newer pending review", () => {
  let controller, armed = false;
  controller = createAllowanceController({ getContext() {
    if (armed) { armed = false; controller.preview(S2); } return context();
  }, read: async () => record() });
  controller.preview(S1); armed = true;
  assert.equal(controller.apply(), false);
  assert.equal(controller.state().phase, "preview");
  assert.equal(controller.state().preview.plan.targets[0].address, S2);
  assert.equal(controller.state().plan, null);
});

test("allowance failed outer context preserves nested preview", () => {
  let controller, first = true;
  controller = createAllowanceController({ getContext() {
    if (first) { first = false; controller.preview(S2); throw Error("old context"); } return context();
  }, read: async () => record() });
  assert.equal(controller.preview(S1), false);
  assert.equal(controller.state().phase, "preview");
  assert.equal(controller.state().preview.plan.targets[0].address, S2);
});

test("allowance context account accessor is never executed", () => {
  let getters = 0;
  const value = context();
  Object.defineProperty(value, "account", { get() { getters++; return ACCOUNT; } });
  const controller = createAllowanceController({ getContext: () => value, read: async () => record() });
  assert.equal(controller.preview(S1), false);
  assert.equal(getters, 0);
});

for (const kind of ["accessor", "reflection"]) {
  test(`allowance progress ${kind} cannot publish after cancellation`, async () => {
    let controller, update, getters = 0, once = false;
    const gate = deferred();
    controller = createAllowanceController({ getContext: context, read(plan, options) { update = options.onProgress; return gate.promise; } });
    configure(controller);
    const pending = controller.inspect();
    const value = { agent: "DAT", stage: "allowance", completed: 0, total: 2, spenderAddress: S1 };
    if (kind === "accessor") Object.defineProperty(value, "stage", { get() { getters++; controller.cancel(); return "allowance"; } });
    update(kind === "accessor" ? value : new Proxy(value, { getOwnPropertyDescriptor(target, key) {
      if (!once) { once = true; controller.cancel(); } return Reflect.getOwnPropertyDescriptor(target, key);
    } }));
    assert.equal(getters, 0);
    assert.equal(controller.state().progress, null);
    assert.equal(controller.state().phase, kind === "accessor" ? "reading" : "cancelled");
    gate.resolve(record({ targets: targets("DAT", 8453, [{ address: S1, label: "" }, { address: S2, label: "" }]) }));
    assert.equal(await pending, kind === "accessor");
  });
}

test("allowance error-code accessor is not executed", async () => {
  let getters = 0;
  const controller = createAllowanceController({ getContext: context, read: async () => { throw { get code() { getters++; return "ALLOWANCE_CANCELLED"; } }; } });
  configure(controller);
  assert.equal(await controller.inspect(), false);
  assert.equal(getters, 0);
  assert.equal(controller.state().errorCode, "ALLOWANCE_UNAVAILABLE");
});

test("allowance reflected diagnostic cannot replace a newer preview", async () => {
  let controller;
  const error = new Proxy({ code: "ALLOWANCE_UNAVAILABLE" }, { getOwnPropertyDescriptor(target, key) {
    controller.preview(S2); return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  controller = createAllowanceController({ getContext: context, read: async () => { throw error; } });
  configure(controller);
  assert.equal(await controller.inspect(), false);
  assert.equal(controller.state().phase, "preview");
  assert.equal(controller.state().preview.plan.targets[0].address, S2);
});
