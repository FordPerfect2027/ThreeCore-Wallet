import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { encodeWorkspace, workspaceDraftKey } from "../src/workspace-format.js";
import { draft, text, bundle, clone, OPTIONS, CONTRACTS } from "./helpers/workspace-fixtures.js";

function fixture() {
  let current = draft({ block: "10" });
  let writer = value => { current = clone(value); };
  const writes = [];
  const controller = createWorkspaceController({
    readDraft: () => current,
    writeDraft: value => { writes.push(clone(value)); return writer(value); },
  });
  return { controller, writes, current: () => current,
    edit: action => action(current), replace: value => { current = clone(value); },
    writer: action => { writer = action; },
    review: () => controller.preview(text({ block: "20" }), OPTIONS),
    apply: preview => controller.apply(preview.id, text({ block: "20" }), OPTIONS) };
}

test("workspace coordinator starts with no implicit write or undo", () => {
  const f = fixture();
  assert.equal(f.writes.length, 0);
  assert.equal(f.controller.state().hasUndo, false);
  assert.equal(f.controller.state().pending, false);
  assert.throws(() => f.controller.undoPreview(), { code: "WORKSPACE_NO_UNDO" });
});

test("workspace coordinator commits all three cards after explicit review", () => {
  const f = fixture();
  const review = f.review();
  assert.equal(f.writes.length, 0);
  const result = f.apply(review);
  assert.equal(f.writes.length, 1);
  assert.ok(f.current().every(row => JSON.parse(row.history).reports.length === 2));
  assert.equal(result.changed, true);
  assert.equal(f.controller.state().undoAvailable, true);
});

test("workspace coordinator cannot reuse an already applied preview", () => {
  const f = fixture();
  const review = f.review();
  f.apply(review);
  assert.throws(() => f.apply(review), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 1);
});

test("workspace coordinator requires exact input JSON at application time", () => {
  const f = fixture();
  const review = f.review();
  assert.throws(() => f.controller.apply(review.id, text({ block: "20" }) + " ", OPTIONS),
    { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 0);
  assert.throws(() => f.apply(review), { code: "WORKSPACE_REVIEW_REQUIRED" });
});

for (const options of [
  { ...OPTIONS, settings: false },
  { ...OPTIONS, histories: false },
  { ...OPTIONS, mode: "replace" },
]) {
  test("workspace coordinator invalidates review after option change " + JSON.stringify(options), () => {
    const f = fixture();
    const review = f.review();
    assert.throws(() => f.controller.apply(review.id, text({ block: "20" }), options),
      { code: "WORKSPACE_REVIEW_REQUIRED" });
    assert.equal(f.writes.length, 0);
  });
}

for (const key of ["account", "chainId", "tokenAddress", "tokens", "history"]) {
  test("workspace coordinator detects live changes in " + key, () => {
    const f = fixture();
    const review = f.review();
    f.edit(value => {
      if (key === "chainId") value[1][key] = 8453;
      else if (key === "history") value[1][key] = draft({ block: "99" })[1].history;
      else value[1][key] = CONTRACTS[2];
    });
    assert.throws(() => f.apply(review), { code: "WORKSPACE_STALE" });
    assert.equal(f.writes.length, 0);
  });
}

test("workspace coordinator cancellation consumes pending review", () => {
  const f = fixture();
  const review = f.review();
  f.controller.cancel();
  assert.equal(f.controller.state().pending, false);
  assert.throws(() => f.apply(review), { code: "WORKSPACE_REVIEW_REQUIRED" });
});

test("workspace coordinator failed new preview cannot leave old authorization", () => {
  const f = fixture();
  const old = f.review();
  assert.throws(() => f.controller.preview("bad", OPTIONS));
  assert.throws(() => f.apply(old), { code: "WORKSPACE_REVIEW_REQUIRED" });
  assert.equal(f.writes.length, 0);
});

test("workspace coordinator no-op does not disconnect or create undo", () => {
  const f = fixture();
  const same = text({ block: "10" });
  const preview = f.controller.preview(same, OPTIONS);
  assert.equal(f.controller.apply(preview.id, same, OPTIONS).changed, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.controller.state().hasUndo, false);
});

test("workspace coordinator undo restores exact original data without reconstructing keys", () => {
  const f = fixture();
  const before = clone(f.current());
  f.apply(f.review());
  const undo = f.controller.undoPreview();
  assert.equal(f.writes.length, 1);
  f.controller.undoApply(undo.id);
  assert.deepEqual(f.current(), before);
  assert.equal(f.writes.length, 2);
  assert.equal(f.controller.state().hasUndo, false);
});

test("workspace coordinator undo cannot be repeated", () => {
  const f = fixture();
  f.apply(f.review());
  const undo = f.controller.undoPreview();
  f.controller.undoApply(undo.id);
  assert.throws(() => f.controller.undoApply(undo.id), { code: "WORKSPACE_REVIEW_REQUIRED" });
});

test("workspace coordinator undo refuses to overwrite edits made after restore", () => {
  const f = fixture();
  f.apply(f.review());
  f.edit(value => { value[2].account = "unfinished new account"; });
  assert.equal(f.controller.state().hasUndo, true);
  assert.equal(f.controller.state().undoAvailable, false);
  assert.throws(() => f.controller.undoPreview(), { code: "WORKSPACE_UNDO_STALE" });
  assert.equal(f.current()[2].account, "unfinished new account");
});

test("workspace coordinator rechecks state after undo preview", () => {
  const f = fixture();
  f.apply(f.review());
  const undo = f.controller.undoPreview();
  f.edit(value => { value[0].tokenAddress = CONTRACTS[1]; });
  assert.throws(() => f.controller.undoApply(undo.id), { code: "WORKSPACE_UNDO_STALE" });
  assert.equal(f.writes.length, 1);
});

test("workspace coordinator a second restore retains only its immediate predecessor", () => {
  const f = fixture();
  f.apply(f.review());
  const middle = clone(f.current());
  const next = text({ block: "30" });
  const review = f.controller.preview(next, OPTIONS);
  f.controller.apply(review.id, next, OPTIONS);
  const undo = f.controller.undoPreview();
  f.controller.undoApply(undo.id);
  assert.deepEqual(f.current(), middle);
});

test("workspace coordinator recovery draft is available when direct undo is stale", () => {
  const f = fixture();
  const before = clone(f.current());
  f.apply(f.review());
  f.edit(value => { value[0].tokens = CONTRACTS.join("\n"); });
  const recovery = JSON.parse(f.controller.recoveryText());
  assert.equal(recovery.schema, "threecore-local-recovery-draft-v1");
  assert.deepEqual(recovery.entries, before);
  assert.equal(f.writes.length, 1);
});

test("workspace coordinator rolls back a partially written operation", () => {
  const f = fixture();
  const before = clone(f.current());
  let calls = 0;
  f.writer(value => {
    if (++calls === 1) {
      f.edit(current => { current[0] = clone(value[0]); });
      throw Error("Simulated second-card render failure");
    }
    f.replace(value);
  });
  assert.throws(() => f.apply(f.review()), { code: "WORKSPACE_ROLLED_BACK" });
  assert.deepEqual(f.current(), before);
  assert.equal(f.writes.length, 2);
  assert.equal(f.controller.state().recoveryRequired, false);
});

test("workspace coordinator verifies writes rather than trusting an adapter return", () => {
  const f = fixture();
  const before = clone(f.current());
  f.writer(() => {});
  assert.throws(() => f.apply(f.review()), { code: "WORKSPACE_ROLLED_BACK" });
  assert.deepEqual(f.current(), before);
});

test("workspace coordinator preserves emergency data if rollback also fails", () => {
  const f = fixture();
  const before = clone(f.current());
  f.writer(value => {
    f.edit(current => { current[0] = clone(value[0]); current[1].account = "broken"; });
    throw Error("Simulated local store failure");
  });
  assert.throws(() => f.apply(f.review()), { code: "WORKSPACE_RECOVERY_REQUIRED" });
  assert.equal(f.controller.state().recoveryRequired, true);
  assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, before);
  assert.throws(() => f.review(), { code: "WORKSPACE_RECOVERY_REQUIRED" });
  assert.throws(() => f.controller.undoPreview(), { code: "WORKSPACE_RECOVERY_REQUIRED" });
});

test("workspace coordinator rejects reentrant application from its write callback", () => {
  const f = fixture();
  let attempts = 0;
  f.writer(value => {
    assert.throws(() => f.review(), { code: "WORKSPACE_BUSY" });
    assert.throws(() => f.controller.dispose(), { code: "WORKSPACE_BUSY" });
    attempts++;
    f.replace(value);
  });
  f.apply(f.review());
  assert.equal(attempts, 1);
});

test("workspace coordinator failed restore keeps earlier undo when rollback succeeds", () => {
  const f = fixture();
  const original = clone(f.current());
  f.apply(f.review());
  const middle = clone(f.current());
  let calls = 0;
  f.writer(value => {
    if (++calls === 1) throw Error("Transient failure");
    f.replace(value);
  });
  const next = text({ block: "30" });
  const review = f.controller.preview(next, OPTIONS);
  assert.throws(() => f.controller.apply(review.id, next, OPTIONS), { code: "WORKSPACE_ROLLED_BACK" });
  assert.deepEqual(f.current(), middle);
  assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, original);
});

test("workspace coordinator undo failure returns to post-restore state", () => {
  const f = fixture();
  f.apply(f.review());
  const middle = clone(f.current());
  const undo = f.controller.undoPreview();
  let calls = 0;
  f.writer(value => {
    if (++calls === 1) throw Error("Undo unavailable temporarily");
    f.replace(value);
  });
  assert.throws(() => f.controller.undoApply(undo.id), { code: "WORKSPACE_ROLLED_BACK" });
  assert.deepEqual(f.current(), middle);
  assert.equal(f.controller.state().undoAvailable, true);
});

test("workspace coordinator input after preview is detached from caller mutations", () => {
  const f = fixture();
  const review = f.review();
  assert.ok(Object.isFrozen(review.after[0]));
  assert.throws(() => { review.after[0].account = "replacement"; }, TypeError);
  assert.equal(f.apply(review).changed, true);
});

test("workspace coordinator disposing removes authorization and recovery data", () => {
  const f = fixture();
  f.apply(f.review());
  f.controller.dispose();
  assert.equal(f.controller.state().disposed, true);
  assert.equal(f.controller.state().hasUndo, false);
  assert.throws(() => f.review(), { code: "WORKSPACE_DISPOSED" });
  assert.throws(() => f.controller.recoveryText(), { code: "WORKSPACE_DISPOSED" });
});

test("workspace coordinator validates its synchronous adapter contract", () => {
  for (const options of [{}, { readDraft: () => draft() }, { writeDraft: () => {} }]) {
    assert.throws(() => createWorkspaceController(options), { code: "WORKSPACE_ADAPTER" });
  }
});

test("workspace coordinator can restore and undo unfinished original form data", () => {
  const f = fixture();
  f.edit(value => { value[0].account = "0xunfinished"; });
  const beforeKey = workspaceDraftKey(f.current());
  f.apply(f.review());
  const review = f.controller.undoPreview();
  f.controller.undoApply(review.id);
  assert.equal(workspaceDraftKey(f.current()), beforeKey);
});
