import test from "node:test";
import assert from "node:assert/strict";
import { analyzePeriodReport } from "../src/period-report-engine.js";
import { analyzeReportSet } from "../src/report-set-engine.js";
import { reportSetTimeline } from "../src/report-set-timeline.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { reportInput, sequenceSet, demoSetHistory, historyMemory, clone } from "./helpers/report-set-fixtures.js";

const cases = [
  { name: "period analysis", create: reportInput, run: analyzePeriodReport, draft: input => input.slots[0].entry.draft },
  { name: "set analysis", create: () => sequenceSet(demoSetHistory()), run: analyzeReportSet, draft: input => input.entries[0].report.slots[0].entry.draft },
  { name: "set timeline", create: () => sequenceSet(demoSetHistory()), run: reportSetTimeline, draft: input => input.entries[0].report.slots[0].entry.draft },
];
function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value); assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}
for (const c of cases) {
  test(c.name + ": repeated owned snapshots preserve exact content and fresh outer presentation identity", () => {
    const input = c.create(), before = JSON.stringify(input), first = c.run(input), second = c.run(input);
    assert.notEqual(first, second); assert.deepEqual(first, second);
    assertDeepFrozen(first); assertDeepFrozen(second);
    assert.equal(JSON.stringify(input), before);
    assert.throws(() => { second.extra = true; }, TypeError);
    assert.deepEqual(c.run(input), first);
  });
  for (const shallowFreeze of [false, true]) test(c.name + ": " + (shallowFreeze ? "shallow-frozen" : "mutable") + " caller evidence is recaptured and later corruption still rejected", () => {
    const input = clone(c.create()); if (shallowFreeze) Object.freeze(input);
    const before = c.run(input), saved = JSON.stringify(before);
    c.draft(input).records = [];
    const after = c.run(input); assert.notDeepEqual(after, before); assert.equal(JSON.stringify(before), saved);
    assertDeepFrozen(after);
    c.draft(input).plan.laterBlock = "INVALID_BLOCK";
    assert.throws(() => c.run(input)); assert.equal(JSON.stringify(before), saved);
  });
  test(c.name + ": a previously accepted caller proxy must still validate after revocation", () => {
    let descriptors = 0;
    const proxy = Proxy.revocable(c.create(), { getOwnPropertyDescriptor(target, key) { descriptors++; return Reflect.getOwnPropertyDescriptor(target, key); } });
    const before = c.run(proxy.proxy); assert.ok(descriptors > 0); assertDeepFrozen(before);
    proxy.revoke(); assert.throws(() => c.run(proxy.proxy));
  });
}
test("reaccepting the same owned set still presents a new outer result for UI reset detection", async () => {
  const input = sequenceSet(), store = historyMemory(), controller = createReportSetController({ storage: store.storage,
    readFile: async () => ({ input, checksumVerified: true }) });
  try {
    assert.equal(await controller.importFile({}), true); assert.equal(await controller.applyReview(), true);
    const before = controller.state.result;
    assert.equal(await controller.importFile({}), true); assert.equal(await controller.applyReview(), true);
    assert.equal(controller.state.input, input); assert.notEqual(controller.state.result, before); assert.deepEqual(controller.state.result, before);
    assert.ok(store.calls.every(row => row[0] === "read"));
  } finally { controller.dispose(); }
});
