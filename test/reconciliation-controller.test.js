import test from "node:test";
import assert from "node:assert/strict";
import { createReconciliationController, RECONCILIATION_UNDO_LIMIT } from "../src/reconciliation-controller.js";
import { emptyReconciliationWorkspace, replaceReconciliationPart, reconciliationKey } from "../src/reconciliation-model.js";
import { prepareReconciliationFile } from "../src/reconciliation-file.js";
import { scenario, workspace, previewWorkspace, clone, fileFrom, deferred, tick, observation, hash } from "./helpers/reconciliation-fixtures.js";

function fixture(options = {}) {
  const states = [];
  const reads = [];
  const source = scenario();
  const controller = createReconciliationController({
    readObservation(agent) { reads.push([agent, "observation"]); return source.earlier; },
    readArchive(agent) { reads.push([agent, "archive"]); return source.archive; },
    onStateChange: state => states.push(state),
    ...options,
  });
  return { controller, states, reads, source };
}

test("controller performs no automatic capture, import, save or calculation", () => {
  const f = fixture();
  assert.deepEqual(f.reads, []);
  assert.equal(f.states.length, 0);
  assert.equal(f.controller.state.report, null);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.exportedCurrent, false);
  assert.deepEqual(f.controller.state.workspace, emptyReconciliationWorkspace());
});

test("a failing presentation callback cannot lose data or strand an operation", async () => {
  const f = fixture({ onStateChange() { throw Error("display failed"); } });
  const file = await prepareReconciliationFile(workspace());
  assert.equal(await f.controller.importFile(fileFrom(file.text), "workspace"), true);
  assert.equal(f.controller.state.busy, false);
  assert.equal(f.controller.apply(), true);
  assert.equal(f.controller.calculate(), true);
  assert.deepEqual(f.controller.state.workspace, workspace());
  assert.equal(f.controller.state.report.slots[0].status, "arithmetic-agreement");
});

for (const part of ["earlier", "later", "archive"]) test("capture " + part + " waits for review, copies source, applies once", () => {
  const f = fixture();
  assert.equal(f.controller.capture(part), true);
  assert.equal(f.reads.length, 1);
  assert.equal(f.controller.state.workspace.slots[0][part], null);
  assert.equal(f.controller.state.review.changes[0].part, part);
  assert.equal(f.controller.state.review.source, "card");
  assert.equal(f.controller.apply(), true);
  assert.notEqual(f.controller.state.workspace.slots[0][part], null);
  assert.equal(f.controller.state.revision, 1);
  assert.equal(f.controller.state.canUndo, true);
  assert.equal(f.controller.apply(), false);
  assert.equal(f.controller.state.revision, 1);
});

test("captured source cannot be edited after review begins", () => {
  const f = fixture();
  f.controller.capture("earlier");
  const captured = f.controller.state.review.after.slots[0].earlier.balanceBaseUnits;
  f.source.earlier.balanceBaseUnits = "0";
  f.controller.apply();
  assert.equal(f.controller.state.workspace.slots[0].earlier.balanceBaseUnits, captured);
});

test("source invalidation cancels card review but keeps applied records", () => {
  const f = fixture({ initial: workspace() });
  f.controller.capture("earlier");
  f.controller.invalidateSources();
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.apply(), false);
  assert.deepEqual(f.controller.state.workspace, workspace());
});

test("changing source cards does not invalidate a reviewed standalone file", async () => {
  const f = fixture();
  const file = await prepareReconciliationFile(workspace());
  await f.controller.importFile(fileFrom(file.text), "workspace");
  f.controller.invalidateSources();
  assert.equal(f.controller.state.review.source, "file");
  assert.equal(f.controller.apply(), true);
});

test("selection change cancels review and never applies into the wrong token", () => {
  const f = fixture();
  f.controller.capture("earlier");
  assert.equal(f.controller.selectAgent("EMA"), true);
  assert.equal(f.controller.state.agent, "EMA");
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.apply(), false);
  assert.deepEqual(f.controller.state.workspace, emptyReconciliationWorkspace());
  assert.equal(f.controller.selectAgent("invalid"), false);
  assert.equal(f.controller.state.agent, "EMA");
});

test("selecting the same token preserves its current review", () => {
  const f = fixture();
  f.controller.capture("earlier");
  const review = f.controller.state.review;
  f.controller.selectAgent("DAT");
  assert.equal(f.controller.state.review, review);
});

test("replacement requires a strict boolean acknowledgement", () => {
  const f = fixture({ initial: workspace() });
  const next = replaceReconciliationPart(workspace(), "DAT", "later", observation({ blockNumber: "43", blockHash: hash(43) }));
  f.controller.propose(next);
  for (const acknowledgement of [false, "true", 1, {}]) {
    assert.equal(f.controller.apply(acknowledgement), false);
    assert.deepEqual(f.controller.state.workspace, workspace());
  }
  assert.equal(f.controller.apply(true), true);
  assert.deepEqual(f.controller.state.workspace, next);
});

test("clear requires review, targets selection and is reversible", () => {
  const f = fixture({ initial: previewWorkspace() });
  f.controller.selectAgent("EMA");
  f.controller.remove();
  assert.equal(f.controller.state.review.changes.length, 3);
  assert.equal(f.controller.apply(), false);
  assert.equal(f.controller.apply(true), true);
  assert.equal(f.controller.state.workspace.slots[1].earlier, null);
  assert.notEqual(f.controller.state.workspace.slots[0].earlier, null);
  assert.equal(f.controller.travel("undo"), true);
  assert.deepEqual(f.controller.state.workspace, previewWorkspace());
  assert.equal(f.controller.travel("redo"), true);
  assert.equal(f.controller.state.workspace.slots[1].earlier, null);
});

test("no-op review does not inflate revisions or undo history", () => {
  const f = fixture({ initial: workspace() });
  f.controller.propose(clone(workspace()));
  assert.equal(f.controller.state.review.changes.length, 0);
  assert.equal(f.controller.apply(), true);
  assert.equal(f.controller.state.revision, 0);
  assert.equal(f.controller.state.canUndo, false);
});

test("new edits after undo clear the redo branch", () => {
  const f = fixture();
  f.controller.propose(workspace());
  f.controller.apply();
  f.controller.travel("undo");
  assert.equal(f.controller.state.canRedo, true);
  f.controller.capture("earlier");
  f.controller.apply();
  assert.equal(f.controller.state.canRedo, false);
  assert.equal(f.controller.travel("redo"), false);
});

test("undo count is bounded and remains exact for retained entries", () => {
  const f = fixture();
  for (let index = 0; index < 12; index++) {
    f.source.earlier.blockNumber = String(index + 100);
    f.source.earlier.blockHash = hash(index + 100);
    f.controller.capture("earlier");
    f.controller.apply(true);
  }
  assert.equal(f.controller.state.undoDepth, RECONCILIATION_UNDO_LIMIT);
  for (let index = 0; index < RECONCILIATION_UNDO_LIMIT; index++) assert.equal(f.controller.travel("undo"), true);
  assert.equal(f.controller.state.workspace.slots[0].earlier.blockNumber, "103");
  assert.equal(f.controller.travel("undo"), false);
  for (let index = 0; index < RECONCILIATION_UNDO_LIMIT; index++) assert.equal(f.controller.travel("redo"), true);
  assert.equal(f.controller.state.workspace.slots[0].earlier.blockNumber, "111");
});

test("calculation is explicit and any applied edit invalidates its report", () => {
  const f = fixture({ initial: workspace() });
  assert.equal(f.controller.calculate(), true);
  assert.equal(f.controller.state.report.slots[0].status, "arithmetic-agreement");
  f.controller.remove("archive");
  assert.notEqual(f.controller.state.report, null);
  f.controller.apply(true);
  assert.equal(f.controller.state.report, null);
  f.controller.calculate();
  assert.equal(f.controller.state.report.slots[0].status, "incomplete-history");
  f.controller.travel("undo");
  assert.equal(f.controller.state.report, null);
});

test("missing or malformed card sources fail without losing prior state", () => {
  for (const readObservation of [() => null, () => undefined, () => ({}), () => { throw Error("secret"); }]) {
    const f = fixture({ initial: workspace(), readObservation });
    assert.equal(f.controller.capture("earlier"), false);
    assert.deepEqual(f.controller.state.workspace, workspace());
    assert.doesNotMatch(f.controller.state.message, /secret/);
  }
});

test("invalid mutation attempts do not alter state or revision", () => {
  const f = fixture({ initial: workspace() });
  assert.equal(f.controller.remove("constructor"), false);
  assert.equal(f.controller.propose({}), false);
  assert.equal(f.controller.capture("sendTransaction"), false);
  assert.equal(f.controller.travel("other"), false);
  assert.equal(f.controller.state.revision, 0);
  assert.deepEqual(f.controller.state.workspace, workspace());
});

test("import busy state blocks edits and calculations", async () => {
  const gate = deferred();
  const f = fixture({ readFile: async () => gate.promise });
  const pending = f.controller.importFile({}, "workspace");
  assert.equal(f.controller.state.busy, true);
  assert.equal(f.controller.capture("earlier"), false);
  assert.equal(f.controller.remove(), false);
  assert.equal(f.controller.propose(workspace()), false);
  assert.equal(f.controller.calculate(), false);
  gate.resolve(workspace());
  assert.equal(await pending, true);
  assert.equal(f.controller.state.busy, false);
  assert.equal(f.controller.state.review.source, "file");
  assert.equal(f.controller.state.error, null);
});

for (const action of ["cancel", "select", "dispose"]) test("late import completion ignored after " + action, async () => {
  const gate = deferred();
  const f = fixture({ readFile: async () => gate.promise });
  const pending = f.controller.importFile({}, "workspace");
  if (action === "cancel") f.controller.cancel();
  if (action === "select") f.controller.selectAgent("EMA");
  if (action === "dispose") f.controller.dispose();
  gate.resolve(workspace());
  assert.equal(await pending, false);
  assert.deepEqual(f.controller.state.workspace, emptyReconciliationWorkspace());
  assert.equal(f.controller.state.review, null);
});

test("cancelled failed import cannot overwrite a newer successful review", async () => {
  const gate = deferred();
  let calls = 0;
  const f = fixture({ readFile: async () => ++calls === 1 ? gate.promise : workspace() });
  const first = f.controller.importFile({}, "workspace");
  f.controller.cancel();
  assert.equal(await f.controller.importFile({}, "workspace"), true);
  const review = f.controller.state.review;
  gate.reject(Error("old failure"));
  assert.equal(await first, false);
  assert.equal(f.controller.state.review, review);
  assert.equal(f.controller.state.error, null);
});

test("failed import releases busy state and retains existing data", async () => {
  const f = fixture({ initial: workspace(), readFile: async () => { throw Error("private filename"); } });
  assert.equal(await f.controller.importFile({}, "workspace"), false);
  assert.equal(f.controller.state.busy, false);
  assert.equal(f.controller.state.review, null);
  assert.doesNotMatch(f.controller.state.error, /private filename/);
  assert.deepEqual(f.controller.state.workspace, workspace());
});

test("real saved JSON can be restored by a fresh controller after reload", async () => {
  const first = fixture({ initial: previewWorkspace() });
  const files = [];
  assert.equal(await first.controller.exportFile("json", file => files.push(file)), true);
  assert.equal(first.controller.state.exportedCurrent, true);
  first.controller.dispose();
  const second = fixture();
  assert.equal(await second.controller.importFile(fileFrom(files[0].text), "workspace"), true);
  assert.equal(second.controller.state.workspace.slots[0].earlier, null);
  assert.equal(second.controller.apply(), true);
  second.controller.calculate();
  assert.deepEqual(second.controller.state.workspace, previewWorkspace());
  assert.deepEqual(second.controller.state.report.slots.map(row => row.status),
    ["arithmetic-agreement", "unexplained-difference", "incomplete-history"]);
});

for (const kind of ["text", "summary", "events", "ledger", "windows"]) test(kind + " export requires current calculation", async () => {
  const f = fixture({ initial: workspace() });
  const files = [];
  assert.equal(await f.controller.exportFile(kind, file => files.push(file)), false);
  assert.equal(files.length, 0);
  f.controller.calculate();
  assert.equal(await f.controller.exportFile(kind, file => files.push(file)), true);
  assert.equal(files.length, 1);
  assert.ok(files[0].text.length > 100);
  assert.equal(f.controller.state.exportedCurrent, false);
  assert.ok(files[0].filename.endsWith(kind === "text" ? ".txt" : ".csv"));
});

test("a failed new capture discards an older review instead of leaving it actionable", () => {
  let valid = true;
  const f = fixture({ readObservation: () => valid ? scenario().earlier : null });
  f.controller.capture("earlier");
  assert.notEqual(f.controller.state.review, null);
  valid = false;
  assert.equal(f.controller.capture("later"), false);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.apply(), false);
});

test("JSON export marker reflects current content, not just last action", async () => {
  const f = fixture({ initial: workspace() });
  await f.controller.exportFile("json", () => {});
  assert.equal(f.controller.state.exportedCurrent, true);
  f.controller.remove("archive");
  f.controller.apply(true);
  assert.equal(f.controller.state.exportedCurrent, false);
  f.controller.travel("undo");
  assert.equal(f.controller.state.exportedCurrent, true);
});

for (const action of ["cancel", "select", "dispose"]) test("cancelled JSON preparation never downloads after " + action, async () => {
  const gate = deferred();
  let delivered = 0;
  const f = fixture({ initial: workspace(), prepareFile: async () => gate.promise });
  const pending = f.controller.exportFile("json", () => { delivered++; });
  if (action === "cancel") f.controller.cancel();
  if (action === "select") f.controller.selectAgent("EMA");
  if (action === "dispose") f.controller.dispose();
  gate.resolve({ text: "{}", filename: "fixture.json" });
  assert.equal(await pending, false);
  assert.equal(delivered, 0);
  assert.equal(f.controller.state.exportedCurrent, false);
});

test("download failure is reported without claiming a saved backup", async () => {
  const f = fixture({ initial: workspace() });
  assert.equal(await f.controller.exportFile("json", () => { throw Error("disk path"); }), false);
  assert.equal(f.controller.state.exportedCurrent, false);
  assert.equal(f.controller.state.busy, false);
  assert.doesNotMatch(f.controller.state.message, /disk path/);
});

test("unknown export and invalid delivery functions are rejected", async () => {
  const f = fixture({ initial: workspace() });
  assert.equal(await f.controller.exportFile("html", () => {}), false);
  assert.equal(await f.controller.exportFile("json", null), false);
  assert.equal(f.controller.state.busy, false);
});

test("dispose is idempotent and prevents future callbacks and mutations", async () => {
  const f = fixture({ initial: workspace() });
  const key = reconciliationKey(f.controller.state.workspace);
  f.controller.dispose();
  f.controller.dispose();
  const count = f.states.length;
  for (const run of [() => f.controller.capture("earlier"), () => f.controller.propose(workspace()),
    () => f.controller.remove(), () => f.controller.apply(true), () => f.controller.cancel(),
    () => f.controller.selectAgent("EMA"), () => f.controller.travel("undo"), () => f.controller.calculate()]) assert.equal(run(), false);
  assert.equal(await f.controller.importFile({}, "workspace"), false);
  assert.equal(await f.controller.exportFile("json", () => { throw Error("not called"); }), false);
  f.controller.invalidateSources();
  await tick();
  assert.equal(f.states.length, count);
  assert.equal(reconciliationKey(f.controller.state.workspace), key);
});
