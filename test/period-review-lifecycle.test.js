import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodController } from "../src/period-controller.js";
import { checkpoint, context } from "./helpers/period-fixtures.js";
const planInput = { earlierBlock: "30", laterBlock: "42", windowSize: 5 };
const setup = options => createPeriodController({ getContext: () => context(), read: async () => checkpoint(), ...options });
const onCapture = (value, callback) => new Proxy(value, { ownKeys(target) { callback(); return Reflect.ownKeys(target); } });

test("saved-checkpoint options use captured own flags", () => {
  const controller = setup();
  const options = new Proxy({ requiresNewPlan: false }, { get() { throw Error("Live option read"); } });
  assert.equal(controller.stageSaved(checkpoint(3), options), true);
  assert.equal(controller.state.review.requiresNewPlan, false);
});
for (const action of ["cancel", "dispose"]) {
  test(action + " during checkpoint capture cannot leave a staged review", () => {
    const controller = setup();
    const input = onCapture(checkpoint(3), () => controller[action]());
    assert.equal(controller.stageSaved(input, { requiresNewPlan: false }), false);
    assert.equal(controller.state.review, null);
    assert.equal(controller.state.phase, action === "dispose" ? "disposed" : "idle");
    assert.equal(controller.state.error, null);
  });
}
for (const invalid of [false, true]) {
  test("a reentrant newer checkpoint review survives the older " + (invalid ? "failure" : "completion"), () => {
    const controller = setup(); let entered = false;
    const older = { ...checkpoint(3), ...(invalid ? { unexpected: true } : {}) };
    const input = onCapture(older, () => {
      if (entered) return; entered = true;
      assert.equal(controller.stageSaved(checkpoint(4), { requiresNewPlan: false }), true);
    });
    assert.equal(controller.stageSaved(input, { requiresNewPlan: false }), false);
    assert.equal(controller.state.phase, "review");
    assert.equal(controller.state.error, null);
    assert.equal(controller.state.review.candidate.records.length, 2);
  });
}
test("plan form accessors are rejected without being evaluated by a spread", () => {
  const controller = setup(); let reads = 0;
  assert.equal(controller.prepare({ ...planInput, get earlierBlock() { reads++; return "30"; } }), false);
  assert.equal(reads, 0);
  assert.equal(controller.state.review, null);
});
test("cancelling during plan context capture prevents review publication", () => {
  let controller;
  controller = setup({ getContext() { controller.cancel(); return context(); } });
  assert.equal(controller.prepare(planInput), false);
  assert.equal(controller.state.phase, "idle"); assert.equal(controller.state.review, null);
});
for (const action of ["cancel", "dispose", "replace"]) {
  test("apply cannot consume a different review after context callback " + action, () => {
    let controller, armed = false;
    controller = setup({ getContext() {
      if (armed) {
        armed = false;
        if (action === "replace") controller.prepare({ ...planInput, laterBlock: "43" });
        else controller[action]();
      }
      return context();
    } });
    assert.equal(controller.prepare(planInput), true);
    armed = true;
    assert.equal(controller.apply(), false);
    assert.equal(controller.state.draft, null);
    assert.equal(controller.state.error, null);
    if (action === "replace") {
      assert.equal(controller.state.review.candidate.plan.laterBlock, "43");
      assert.equal(controller.state.phase, "review");
    } else {
      assert.equal(controller.state.review, null);
      assert.equal(controller.state.phase, action === "dispose" ? "disposed" : "idle");
    }
  });
}
test("a review cancelled by its display callback does not report staging success", () => {
  let controller;
  controller = setup({ onChange(state) { if (state.phase === "review") controller.cancel(); } });
  assert.equal(controller.stageSaved(checkpoint(3), { requiresNewPlan: false }), false);
  assert.equal(controller.state.review, null);
});
test("cancellation while obtaining an imported checkpoint cannot resurrect its review", async () => {
  let controller;
  controller = setup({ readFile: async () => ({ get draft() { controller.cancel(); return checkpoint(3); } }) });
  assert.equal(await controller.importFile({}), false);
  assert.equal(controller.state.phase, "idle"); assert.equal(controller.state.review, null);
});
