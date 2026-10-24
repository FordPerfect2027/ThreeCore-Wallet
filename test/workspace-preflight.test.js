import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, text, clone, OPTIONS, tick } from "./helpers/workspace-fixtures.js";

function fixture() {
  let value = draft({ block: "10" }), prepare = () => {}, authorize = () => true;
  const writes = [], calls = [];
  const controller = createWorkspaceController({
    readDraft: () => clone(value),
    writeDraft(next) { calls.push("write"); writes.push(clone(next)); value = clone(next); },
    prepareWrite(after, before, checkCurrent) { calls.push("prepare"); return prepare(after, before, checkCurrent); },
    authorizeWrite: () => authorize(),
  });
  return { controller, writes, calls,
    get value() { return clone(value); }, replace(next) { value = clone(next); },
    prepare(fn) { prepare = fn; }, authorize(fn) { authorize = fn; },
    operation(mode) {
      const payload = text({ block: "20" });
      const preview = controller.preview(payload, OPTIONS);
      if (mode === "restore") return () => controller.apply(preview.id, payload, OPTIONS);
      controller.apply(preview.id, payload, OPTIONS);
      const undo = controller.undoPreview();
      return () => controller.undoApply(undo.id);
    },
  };
}

for (const mode of ["restore", "undo"]) {
  for (const stop of ["cancel", "dispose"]) {
    test(`${mode} preflight: ${stop} prevents the first write`, () => {
      const f = fixture(), run = f.operation(mode), before = f.value, count = f.writes.length;
      let reached = false;
      f.prepare(() => { reached = true; f.controller[stop](); });
      assert.throws(run, { code: "WORKSPACE_REVIEW_REQUIRED" });
      assert(reached);
      assert.equal(f.writes.length, count);
      assert.deepEqual(f.value, before);
      assert.equal(f.controller.state().pending, false);
      if (stop === "dispose") assert.equal(f.controller.state().disposed, true);
    });
  }

  test(`${mode} preflight: preserves edits made while disconnecting`, () => {
    const f = fixture(), run = f.operation(mode), edited = f.value, count = f.writes.length;
    edited[1].account = "unfinished local edit";
    f.prepare(() => f.replace(edited));
    assert.throws(run, { code: "WORKSPACE_STALE" });
    assert.deepEqual(f.value, edited);
    assert.equal(f.writes.length, count);
  });

  test(`${mode} preflight: guard interrupts remaining preparation steps`, () => {
    const f = fixture(), run = f.operation(mode), count = f.writes.length;
    let laterStep = false;
    f.prepare((after, before, checkCurrent) => {
      f.controller.cancel(); checkCurrent(); laterStep = true;
    });
    assert.throws(run, { code: "WORKSPACE_REVIEW_REQUIRED" });
    assert.equal(laterStep, false);
    assert.equal(f.writes.length, count);
  });

  test(`${mode} preflight: cannot recursively preview or apply`, () => {
    const f = fixture(), run = f.operation(mode);
    let attempts = 0;
    f.prepare(() => {
      assert.throws(run, { code: "WORKSPACE_BUSY" }); attempts++;
      assert.throws(() => f.controller.preview(text(), OPTIONS), { code: "WORKSPACE_BUSY" }); attempts++;
    });
    run();
    assert.equal(attempts, 2);
  });

  test(`${mode} preflight: preparation receives immutable detached copies`, () => {
    const f = fixture(), run = f.operation(mode), original = f.value;
    let reached = false;
    f.prepare((after, before) => {
      reached = true;
      assert(Object.isFrozen(after) && Object.isFrozen(before));
      assert.throws(() => { after[0].account = "mutated candidate"; }, TypeError);
      assert.throws(() => { before[1].account = "mutated rollback"; }, TypeError);
    });
    run();
    assert(reached);
    assert.notEqual(f.value[0].account, "mutated candidate");
    if (mode === "restore") assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, original);
  });

  test(`${mode} preflight: expired authority prevents commit`, () => {
    const f = fixture(), run = f.operation(mode), count = f.writes.length;
    let allowed = true;
    f.authorize(() => allowed);
    f.prepare(() => { allowed = false; });
    assert.throws(run, { code: "WORKSPACE_REVIEW_REQUIRED" });
    assert.equal(f.writes.length, count);
  });

  test(`${mode} preflight: rejected async preparation is consumed and cannot write`, async () => {
    const f = fixture(), run = f.operation(mode), count = f.writes.length;
    f.prepare(() => Promise.reject(Error("synthetic preparation failure")));
    assert.throws(run, { code: "WORKSPACE_REVIEW_REQUIRED" });
    await tick();
    assert.equal(f.writes.length, count);
  });
}

test("preflight failure retains the preceding undo point", () => {
  const f = fixture(), original = f.value;
  f.operation("restore")();
  const before = f.value, payload = text({ block: "30" });
  const review = f.controller.preview(payload, OPTIONS);
  f.prepare(() => { throw Error("synthetic private error"); });
  assert.throws(() => f.controller.apply(review.id, payload, OPTIONS), error => {
    assert.equal(error.code, "WORKSPACE_REVIEW_REQUIRED");
    assert(!error.message.includes("private")); return true;
  });
  assert.deepEqual(f.value, before);
  assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, original);
});

test("preflight runs before each write and is skipped for a no-op", () => {
  const f = fixture();
  f.operation("restore")();
  assert.deepEqual(f.calls, ["prepare", "write"]);
  const same = text({ block: "20" });
  const preview = f.controller.preview(same, OPTIONS);
  f.controller.apply(preview.id, same, OPTIONS);
  assert.deepEqual(f.calls, ["prepare", "write"]);
  const undo = f.controller.undoPreview(); f.controller.undoApply(undo.id);
  assert.deepEqual(f.calls, ["prepare", "write", "prepare", "write"]);
});

test("panel can close during preflight without writes or stranded controls", () => {
  const parent = new Element("main"), document = { createElement: tag => new Element(tag) };
  let writes = 0, called = false;
  const panel = mountWorkspacePanel({ document, parent, readDraft: draft,
    writeDraft() { writes++; }, prepareWrite() { called = true; panel.dispose(); } });
  const q = name => parent.find("workspace-" + name);
  q("json").value = text({ block: "99" }); q("preview").click();
  q("confirmed").checked = true; q("confirmed").dispatchEvent(new Event("change"));
  const apply = q("apply"), status = q("status");
  apply.click();
  assert(called);
  assert.equal(writes, 0);
  assert.equal(parent.children.length, 0);
  assert(!status.textContent.includes("一括復元しました"));
  apply.click(); assert.equal(writes, 0);
  panel.dispose();
});
