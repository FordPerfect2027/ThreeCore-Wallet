import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { workspaceDraftKey } from "../src/workspace-format.js";
import { draft, text, clone, OPTIONS, tick } from "./helpers/workspace-fixtures.js";
function fixture() {
  let current = draft({ block: "10" });
  let authorize = () => true;
  let read = () => clone(current);
  let writer = value => { current = clone(value); };
  let checks = 0;
  const writes = [];
  const controller = createWorkspaceController({
    readDraft: () => read(),
    writeDraft(value) { writes.push(clone(value)); return writer(value); },
    authorizeWrite() { checks++; return authorize(); },
  });
  return { controller, writes,
    get current() { return clone(current); }, get checks() { return checks; },
    authorize(fn) { authorize = fn; }, reader(fn) { read = fn; }, writer(fn) { writer = fn; },
    replace(value) { current = clone(value); },
    preview: () => controller.preview(text({ block: "20" }), OPTIONS),
    apply: review => controller.apply(review.id, text({ block: "20" }), OPTIONS),
  };
}

for (const allowed of [false, undefined, null, 0, "true", {}]) {
  test("restore requires literal true at final write boundary: " + String(allowed), () => {
    const f = fixture();
    const before = f.current;
    const review = f.preview();
    f.authorize(() => allowed);
    assert.throws(() => f.apply(review), { code: "WORKSPACE_REVIEW_REQUIRED" });
    assert.equal(f.writes.length, 0);
    assert.equal(f.checks, 1);
    assert.deepEqual(f.current, before);
    assert.equal(f.controller.state().hasUndo, false);
  });
}

test("expired authorization consumes review rather than allowing later retry", () => {
  const f = fixture();
  const review = f.preview();
  f.authorize(() => false);
  assert.throws(() => f.apply(review));
  f.authorize(() => true);
  assert.throws(() => f.apply(review), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 0);
  f.apply(f.preview());
  assert.equal(f.writes.length, 1);
});

test("final authorization errors have static safe messages", () => {
  const f = fixture();
  const review = f.preview();
  f.authorize(() => { throw Error("synthetic private error"); });
  assert.throws(() => f.apply(review), error => {
    assert.equal(error.code, "WORKSPACE_REVIEW_REQUIRED");
    assert(!error.message.includes("private"));
    return true;
  });
  assert.equal(f.writes.length, 0);
});

test("async authorization is rejected and its rejection is consumed", async () => {
  const f = fixture();
  const review = f.preview();
  f.authorize(async () => { throw Error("async authority failed"); });
  assert.throws(() => f.apply(review), { code: "WORKSPACE_REVIEW_REQUIRED" });
  await tick();
  assert.equal(f.writes.length, 0);
});

test("authorization callback cannot recursively apply or preview", () => {
  const f = fixture();
  const review = f.preview();
  let nested = 0;
  f.authorize(() => {
    assert.throws(() => f.apply(review), { code: "WORKSPACE_BUSY" }); nested++;
    assert.throws(() => f.preview(), { code: "WORKSPACE_BUSY" }); nested++;
    assert.throws(() => f.controller.dispose(), { code: "WORKSPACE_BUSY" }); nested++;
    return true;
  });
  f.apply(review);
  assert.equal(nested, 6, "Both pre-write and post-write authorization reject reentrancy");
  assert.equal(f.writes.length, 1);
});

test("authorization callback cancellation blocks the first write", () => {
  const f = fixture();
  const review = f.preview();
  f.authorize(() => { f.controller.cancel(); return true; });
  assert.throws(() => f.apply(review), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 0);
});

test("readDraft cancellation invalidates a newly created review", () => {
  const f = fixture();
  const before = f.current;
  f.reader(() => { f.controller.cancel(); return before; });
  assert.throws(() => f.preview(), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.controller.state().pending, false);
  assert.equal(f.writes.length, 0);
});

test("readDraft cancellation prevents applying a previously reviewed file", () => {
  const f = fixture();
  const review = f.preview();
  const before = f.current;
  f.reader(() => { f.controller.cancel(); return before; });
  assert.throws(() => f.apply(review), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 0);
  assert.equal(f.checks, 0);
});

test("readDraft cannot start a second review recursively", () => {
  const f = fixture();
  const before = f.current;
  let blocked = false;
  f.reader(() => {
    assert.throws(() => f.preview(), { code: "WORKSPACE_BUSY" });
    blocked = true;
    return before;
  });
  const review = f.preview();
  assert.equal(blocked, true);
  assert(review.id > 0);
  assert.equal(f.controller.state().pending, true);
});

test("readDraft disposal cannot leave an applicable review", () => {
  const f = fixture();
  const before = f.current;
  f.reader(() => { f.controller.dispose(); return before; });
  assert.throws(() => f.preview(), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.controller.state().disposed, true);
  assert.equal(f.controller.state().pending, false);
});

test("adapter cannot mutate expected output and pass verification against itself", () => {
  const f = fixture();
  const before = f.current;
  const review = f.preview();
  let call = 0;
  f.writer(value => {
    if (++call === 1) value[0].tokens = "";
    f.replace(value);
  });
  assert.throws(() => f.apply(review), { code: "WORKSPACE_ROLLED_BACK" });
  assert.equal(call, 2);
  assert.deepEqual(f.current, before);
  assert.equal(f.controller.state().recoveryRequired, false);
});

test("adapter receives copies and cannot modify a retained preview", () => {
  const f = fixture();
  const review = f.preview();
  const expected = workspaceDraftKey(review.after);
  f.writer(value => {
    f.replace(value);
    assert.throws(() => { value[0].tokens = ""; }, TypeError);
    assert.throws(() => { value[1].account = ""; }, TypeError);
  });
  f.apply(review);
  assert.equal(workspaceDraftKey(review.after), expected);
  assert.equal(workspaceDraftKey(f.current), expected);
  assert.equal(f.controller.state().hasUndo, true);
});

test("rollback adapter mutation cannot corrupt preserved emergency draft", () => {
  const f = fixture();
  const before = f.current;
  const review = f.preview();
  let count = 0;
  f.writer(value => {
    count++;
    value[0].tokens = "";
    f.replace(value);
    throw Error("private adapter error");
  });
  assert.throws(() => f.apply(review), { code: "WORKSPACE_RECOVERY_REQUIRED" });
  assert.equal(count, 2);
  const recovery = JSON.parse(f.controller.recoveryText());
  assert.deepEqual(recovery.entries, before);
  assert.equal(f.controller.state().recoveryRequired, true);
});

test("rollback remains permitted if authorization expires after first write", () => {
  const f = fixture();
  const before = f.current;
  const review = f.preview();
  let permitted = true;
  let calls = 0;
  f.authorize(() => permitted);
  f.writer(value => {
    if (++calls === 1) {
      permitted = false;
      f.replace(value);
      throw Error("write failed after mutation");
    }
    f.replace(value);
  });
  assert.throws(() => f.apply(review), { code: "WORKSPACE_ROLLED_BACK" });
  assert.equal(calls, 2);
  assert.equal(f.checks, 1);
  assert.deepEqual(f.current, before);
});

test("async writer failure retains recovery data without racing another write", async () => {
  const f = fixture();
  const before = f.current;
  const review = f.preview();
  let calls = 0;
  f.writer(value => {
    if (++calls === 1) return Promise.reject(Error("async write must not be used"));
    f.replace(value);
  });
  assert.throws(() => f.apply(review), { code: "WORKSPACE_RECOVERY_REQUIRED" });
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, before);
  assert.deepEqual(f.current, before);
});

test("async rollback is rejected and preserves emergency recovery data", async () => {
  const f = fixture();
  const before = f.current;
  const review = f.preview();
  f.writer(() => Promise.reject(Error("unsupported async adapter")));
  assert.throws(() => f.apply(review), { code: "WORKSPACE_RECOVERY_REQUIRED" });
  await tick();
  assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, before);
});

test("failed adapter text is never copied into rollback exception", () => {
  const f = fixture();
  const review = f.preview();
  let calls = 0;
  f.writer(value => {
    if (++calls === 1) throw { code: "synthetic secret password", message: "private" };
    f.replace(value);
  });
  assert.throws(() => f.apply(review), error => {
    assert.equal(error.code, "WORKSPACE_ROLLED_BACK");
    assert.equal(error.message, "WORKSPACE_ROLLED_BACK");
    return true;
  });
});

test("undo requires fresh final authorization", () => {
  const f = fixture();
  f.apply(f.preview());
  const after = f.current;
  const review = f.controller.undoPreview();
  f.authorize(() => false);
  assert.throws(() => f.controller.undoApply(review.id), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.current, after);
  assert.equal(f.controller.state().hasUndo, true);
});

test("undo read cancellation cannot become a new valid review", () => {
  const f = fixture();
  f.apply(f.preview());
  const current = f.current;
  f.reader(() => { f.controller.cancel(); return current; });
  assert.throws(() => f.controller.undoPreview(), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 1);
});

test("undo application read cancellation does not write", () => {
  const f = fixture();
  f.apply(f.preview());
  const review = f.controller.undoPreview();
  const current = f.current;
  f.reader(() => { f.controller.cancel(); return current; });
  assert.throws(() => f.controller.undoApply(review.id), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 1);
});

test("status called from readDraft cannot recurse while checking undo", () => {
  const f = fixture();
  f.apply(f.preview());
  const current = f.current;
  let inner;
  f.reader(() => { inner = f.controller.state(); return current; });
  const state = f.controller.state();
  assert.equal(state.undoAvailable, true);
  assert.equal(inner.undoAvailable, false);
});

test("successful restore and undo preserve distinct DAT EMA CAWELON records", () => {
  const f = fixture();
  const before = f.current;
  const result = f.apply(f.preview());
  assert.equal(result.changed, true);
  assert.deepEqual(f.current.map(row => row.agent), ["DAT", "EMA", "CAWELON"]);
  for (const row of f.current) assert.equal(JSON.parse(row.history).reports.length, 2);
  const undo = f.controller.undoPreview();
  f.controller.undoApply(undo.id);
  assert.deepEqual(f.current, before);
  assert.equal(f.checks, 4, "Restore and undo each verify authority before and after writing");
  assert.equal(f.controller.state().hasUndo, false);
});
