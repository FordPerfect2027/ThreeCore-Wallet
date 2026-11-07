import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { CheckpointError } from "../src/checkpoint-model.js";
import { decodeWorkspaceFile } from "../src/workspace-file.js";
import { workspaceDraftKey } from "../src/workspace-format.js";
import { draft, gate, CONTRACTS } from "./helpers/workspace-fixtures.js";
import { TIME, id, stored, memoryStorage, preparedDraft } from "./helpers/checkpoint-fixtures.js";

const prepared = await preparedDraft();
function fixture(t, options = {}) {
  let current = draft(), counter = 20;
  const storage = options.storage ?? memoryStorage();
  const staged = [], downloads = [];
  const controller = createCheckpointController({ storage,
    readDraft: () => current, onStage: value => staged.push(value),
    download: value => downloads.push(value), now: () => TIME,
    createId: () => id(++counter), ...options });
  t.after(() => controller.dispose());
  return { controller, storage, staged, downloads,
    draft: () => current, edit: action => action(current) };
}

test("quick save is explicit and persists all three histories without manual refresh or name", async t => {
  const f = fixture(t);
  assert.deepEqual(f.storage.calls, []);
  const key = workspaceDraftKey(f.draft());
  assert.equal(await f.controller.saveQuick(), true);
  assert.deepEqual(f.storage.calls, ["read", "save"]);
  const [saved] = f.storage.current().entries;
  assert.equal(saved.label, "ThreeCore " + TIME);
  assert.equal(saved.createdAt, TIME);
  const decoded = await decodeWorkspaceFile(new TextEncoder().encode(saved.fileText));
  assert.deepEqual(decoded.workspace.entries.map(row => row.agent), ["DAT", "EMA", "CAWELON"]);
  assert.equal(workspaceDraftKey(f.draft()), key);
  assert.equal(f.controller.state().lastAction, "save");
  assert.equal(f.controller.state().canStage, false);
  assert.deepEqual(f.staged, []);
  assert.deepEqual(f.downloads, []);
});

test("quick save appends without changing archived or active saved data", async t => {
  const initial = stored(2, prepared.text);
  initial.entries[0].archived = true;
  const f = fixture(t, { storage: memoryStorage(initial) });
  const before = f.storage.current().entries;
  assert.equal(await f.controller.saveQuick(), true);
  assert.deepEqual(f.storage.current().entries.slice(0, 2), before);
  assert.equal(f.storage.current().entries.length, 3);
});

test("double click while initial metadata read waits cannot create duplicate saves", async t => {
  const f = fixture(t), pending = gate();
  f.storage.onRead(() => pending.promise);
  const saving = f.controller.saveQuick();
  assert.equal(f.controller.state().busy, true);
  assert.equal(await f.controller.saveQuick(), false);
  assert.deepEqual(f.storage.calls, ["read"]);
  pending.resolve();
  assert.equal(await saving, true);
  assert.equal(f.storage.current().entries.length, 1);
});

for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
  test(agent + " edit during initial read refuses stale quick save", async t => {
    const f = fixture(t, { storage: memoryStorage(stored(1, prepared.text)) });
    const before = f.storage.current(), pending = gate();
    f.storage.onRead(() => pending.promise);
    const saving = f.controller.saveQuick();
    f.edit(rows => { rows[index].tokens = CONTRACTS[(index + 1) % CONTRACTS.length]; });
    pending.resolve();
    assert.equal(await saving, false);
    assert.equal(f.controller.state().errorCode, "CHECKPOINT_DRAFT_CHANGED");
    assert.deepEqual(f.storage.current(), before);
    assert.deepEqual(f.storage.calls, ["read"]);
  });
}

test("a form edit during the queued write cannot replace saved data", async t => {
  const f = fixture(t, { storage: memoryStorage(stored(1, prepared.text)) });
  const before = f.storage.current();
  f.storage.onChange(() => { f.edit(rows => { rows[0].tokens = CONTRACTS[1]; }); });
  assert.equal(await f.controller.saveQuick(), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_DRAFT_CHANGED");
  assert.deepEqual(f.storage.current(), before);
});

test("quick save disposal during initial read cannot start a write", async t => {
  const f = fixture(t), pending = gate();
  f.storage.onRead(() => pending.promise);
  const saving = f.controller.saveQuick();
  f.controller.dispose();
  pending.resolve();
  assert.equal(await saving, false);
  assert.deepEqual(f.storage.calls, ["read", "close"]);
  assert.equal(f.storage.current().entries.length, 0);
});

test("quick save refuses to evict old checkpoints when all five slots are full", async t => {
  const f = fixture(t, { storage: memoryStorage(stored(5, prepared.text)) });
  const before = f.storage.current();
  assert.equal(await f.controller.saveQuick(), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_CAPACITY");
  assert.deepEqual(f.storage.current(), before);
});

for (const code of ["CHECKPOINT_QUOTA", "CHECKPOINT_BLOCKED", "CHECKPOINT_VERSION", "CHECKPOINT_CLOCK"]) {
  test("quick save does not retry or overwrite after " + code, async t => {
    const f = fixture(t, { storage: memoryStorage(stored(1, prepared.text)) });
    const before = f.storage.current();
    f.storage.onRead(() => { throw new CheckpointError(code); });
    assert.equal(await f.controller.saveQuick(), false);
    assert.equal(f.controller.state().errorCode, code);
    assert.deepEqual(f.storage.calls, ["read"]);
    assert.deepEqual(f.storage.current(), before);
    assert.deepEqual(f.downloads, []);
  });
}

test("a committed quick save remains successful after a post-commit draft failure", async t => {
  let broken = false;
  const f = fixture(t, { readDraft: () => { if (broken) throw Error("form unavailable"); return draft(); } });
  f.storage.onAfterChange(() => { broken = true; });
  assert.equal(await f.controller.saveQuick(), true);
  assert.equal(f.controller.state().currentDraftChanged, true);
  assert.equal(f.storage.current().entries.length, 1);
  assert.equal(await f.controller.exportFile(), true);
  assert.equal(f.downloads[0].text, f.storage.current().entries[0].fileText);
});

test("quick save refreshes old metadata but never silently retries a new write conflict", async t => {
  const f = fixture(t);
  await f.controller.refresh();
  f.storage.set(stored(1, prepared.text));
  assert.equal(await f.controller.saveQuick(), true);
  assert.equal(f.storage.current().entries.length, 2);
  f.storage.onChange(() => { f.storage.set(stored(3, prepared.text)); });
  assert.equal(await f.controller.saveQuick(), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_STALE");
  assert.equal(f.storage.current().entries.length, 3);
  assert.equal(f.controller.state().metadata, null);
});

test("two deliberate clicks with the same timestamp keep distinct IDs", async t => {
  const f = fixture(t);
  assert.equal(await f.controller.saveQuick(), true);
  assert.equal(await f.controller.saveQuick(), true);
  const [first, second] = f.storage.current().entries;
  assert.equal(first.label, second.label);
  assert.notEqual(first.id, second.id);
});

test("an invalid generated time never opens storage", async t => {
  const f = fixture(t, { now: () => "not a date" });
  assert.equal(await f.controller.saveQuick(), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_TIME");
  assert.deepEqual(f.storage.calls, []);
});
