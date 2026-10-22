import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { CheckpointError, mutateCheckpoints } from "../src/checkpoint-model.js";
import { workspaceDraftKey } from "../src/workspace-format.js";
import { decodeWorkspaceFile } from "../src/workspace-file.js";
import { draft, clone, gate, tick, CONTRACTS } from "./helpers/workspace-fixtures.js";
import { TIME, LATER, id, stored, memoryStorage, preparedDraft } from "./helpers/checkpoint-fixtures.js";

function fixture(options = {}) {
  const storage = options.storage ?? memoryStorage();
  let current = draft();
  let counter = 0;
  const changes = [], stages = [], downloads = [];
  const controller = createCheckpointController({ storage,
    readDraft: () => current, onStage: value => stages.push(value),
    download: value => downloads.push(value), onChange: value => changes.push(value),
    now: () => TIME, createId: () => id(++counter), ...options });
  return { controller, storage, changes, stages, downloads,
    current: () => current, edit: action => action(current),
    replace: value => { current = value; },
    save: async () => { await controller.refresh(); return controller.save("Checkpoint"); },
  };
}

test("checkpoint controller performs no persistence or read when created", () => {
  const f = fixture();
  assert.deepEqual(f.storage.calls, []);
  assert.equal(f.controller.state().phase, "idle");
  assert.equal(f.controller.state().metadata, null);
  assert.equal(f.stages.length, 0);
});

test("save requires an explicit refresh before writing", async () => {
  const f = fixture();
  assert.equal(await f.controller.save("name"), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_REFRESH_REQUIRED");
  assert.deepEqual(f.storage.calls, []);
});

test("refresh loads metadata without touching the current draft", async () => {
  const f = fixture();
  const before = workspaceDraftKey(f.current());
  assert.equal(await f.controller.refresh(), true);
  assert.equal(f.controller.state().metadata.count, 0);
  assert.equal(workspaceDraftKey(f.current()), before);
  assert.equal(f.stages.length, 0);
});

test("explicit save records a verified file and selects the newly created checkpoint", async () => {
  const f = fixture();
  assert.equal(await f.save(), true);
  const saved = f.storage.current().entries[0];
  assert.equal(saved.label, "Checkpoint");
  assert.equal(saved.id, id(1));
  const decoded = await decodeWorkspaceFile(new TextEncoder().encode(saved.fileText));
  assert.equal(decoded.workspace.entries.length, 3);
  assert.equal(f.controller.state().selectedId, id(1));
  assert.equal(f.controller.state().canStage, false);
  assert.equal(f.controller.state().metadata.count, 1);
});

test("two saves allocate independent snapshots even when their names match", async () => {
  const f = fixture();
  await f.save();
  f.edit(value => { value[0].tokens = CONTRACTS[1]; });
  await f.controller.save("Checkpoint");
  const entries = f.storage.current().entries;
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].id, entries[1].id);
  assert.notEqual(entries[0].fileText, entries[1].fileText);
});

test("inspect verifies checksum and shows historical data without staging restoration", async () => {
  const f = fixture();
  await f.save();
  assert.equal(await f.controller.inspect(), true);
  assert.match(f.controller.state().inspection, /保存履歴: 合計 3件/);
  assert.match(f.controller.state().inspection, /現在の残高・接続・所有・安全性を証明しません/);
  assert.equal(f.controller.state().checksumVerified, true);
  assert.equal(f.stages.length, 0);
});

test("stage requires verified inspection then only copies an import proposal", async () => {
  const f = fixture();
  await f.save();
  assert.equal(await f.controller.stage(), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_INSPECTION_REQUIRED");
  await f.controller.inspect();
  const before = workspaceDraftKey(f.current());
  assert.equal(await f.controller.stage(), true);
  assert.equal(f.stages.length, 1);
  assert.equal(JSON.parse(f.stages[0]).schema, "threecore-wallet-workspace-v1");
  assert.equal(workspaceDraftKey(f.current()), before);
});

test("selection changes invalidate inspection and staging permission", async () => {
  const f = fixture();
  await f.save();
  await f.controller.save("second");
  await f.controller.inspect();
  f.controller.select(id(1));
  assert.equal(f.controller.state().canStage, false);
  assert.equal(f.controller.state().inspection, "");
  assert.equal(await f.controller.stage(), false);
});

test("archive keeps bytes but prevents staging until explicitly unarchived", async () => {
  const f = fixture();
  await f.save();
  const before = f.storage.current().entries[0].fileText;
  await f.controller.archive();
  await f.controller.inspect();
  assert.equal(f.controller.state().selectedArchived, true);
  assert.equal(f.controller.state().canStage, false);
  assert.equal(await f.controller.stage(), false);
  assert.equal(f.storage.current().entries[0].fileText, before);
  await f.controller.unarchive();
  assert.equal(f.controller.state().checksumVerified, false);
  await f.controller.inspect();
  assert.equal(f.controller.state().canStage, true);
});

test("rename retains observation bytes and clears old inspection", async () => {
  const f = fixture();
  await f.save();
  await f.controller.inspect();
  const before = f.storage.current().entries[0].fileText;
  await f.controller.rename("after review");
  assert.equal(f.storage.current().entries[0].label, "after review");
  assert.equal(f.storage.current().entries[0].fileText, before);
  assert.equal(f.controller.state().checksumVerified, false);
});

test("export uses the exact verified stored file rather than current unsaved edits", async () => {
  const f = fixture();
  await f.save();
  const saved = f.storage.current().entries[0].fileText;
  f.edit(value => { value[0].tokens = CONTRACTS[1]; });
  assert.equal(await f.controller.exportFile(), true);
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].text, saved);
  assert.match(f.downloads[0].filename, /^ThreeCore-checkpoint-/);
});

test("explicit purge confirmation is required even after archiving", async () => {
  const f = fixture();
  await f.save();
  assert.equal(await f.controller.purge(true), false);
  await f.controller.archive();
  assert.equal(await f.controller.purge(false), false);
  assert.equal(f.storage.current().entries.length, 1);
  assert.equal(await f.controller.purge(true), true);
  assert.equal(f.storage.current().entries.length, 0);
  assert.equal(f.controller.state().selectedId, null);
});

for (const method of ["inspect", "stage", "exportFile", "archive", "unarchive", "purge", "rename"]) {
  test("missing selection never performs " + method, async () => {
    const f = fixture();
    await f.controller.refresh();
    assert.equal(await f.controller[method](), false);
    assert.equal(f.controller.state().errorCode, "CHECKPOINT_SELECTION");
    assert.deepEqual(f.storage.calls, ["read"]);
  });
}

test("a second tab's mutation rejects stale save without losing its new checkpoint", async () => {
  const shared = memoryStorage();
  const a = fixture({ storage: shared, createId: () => id(1) });
  const b = fixture({ storage: shared, createId: () => id(2) });
  await a.controller.refresh();
  await b.controller.refresh();
  assert.equal(await a.controller.save("first tab"), true);
  assert.equal(await b.controller.save("second tab"), false);
  assert.equal(b.controller.state().errorCode, "CHECKPOINT_STALE");
  assert.equal(b.controller.state().metadata, null);
  assert.equal(shared.current().entries.length, 1);
  await b.controller.refresh();
  assert.equal(await b.controller.save("second tab"), true);
  assert.equal(shared.current().entries.length, 2);
});

for (const method of ["inspect", "stage", "exportFile"]) {
  test("a changed stored revision invalidates selected action " + method, async () => {
    const f = fixture();
    await f.save();
    await f.controller.inspect();
    f.storage.set(mutateCheckpoints(f.storage.current(), 1, { kind: "rename", id: id(1), label: "another tab", time: LATER }));
    assert.equal(await f.controller[method](), false);
    assert.equal(f.controller.state().errorCode, "CHECKPOINT_STALE");
    assert.equal(f.stages.length, 0);
    assert.equal(f.downloads.length, 0);
  });
}

for (const method of ["rename", "archive", "purge"]) {
  test("stale metadata action cannot overwrite another writer: " + method, async () => {
    const f = fixture();
    await f.save();
    f.storage.set(mutateCheckpoints(f.storage.current(), 1, { kind: "archive", id: id(1), time: LATER }));
    assert.equal(await f.controller[method](method === "rename" ? "new" : true), false);
    assert.equal(f.controller.state().errorCode, "CHECKPOINT_STALE");
    assert.equal(f.storage.current().entries[0].archived, true);
  });
}

test("corrupt checksum is visible as an error without restoring or exporting anything", async () => {
  const prepared = await preparedDraft();
  const content = JSON.parse(prepared.text);
  content.digest = "f".repeat(64);
  const f = fixture({ storage: memoryStorage(stored(1, JSON.stringify(content))) });
  await f.controller.refresh();
  f.controller.select(id(1));
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.controller.state().errorCode, "WORKSPACE_CHECKSUM");
  assert.equal(await f.controller.exportFile(), false);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.stages.length, 0);
});

test("corrupt content can be archived without pretending it has passed inspection", async () => {
  const f = fixture({ storage: memoryStorage(stored(1, "{}")) });
  await f.controller.refresh();
  f.controller.select(id(1));
  assert.equal(await f.controller.archive(), true);
  assert.equal(f.controller.state().checksumVerified, false);
  assert.equal(f.storage.current().entries[0].fileText, "{}");
});

test("draft changes during hash preparation prevent saving a stale snapshot", async () => {
  const pending = gate();
  const f = fixture({ subtle: { digest: () => pending.promise } });
  await f.controller.refresh();
  const saving = f.controller.save("pending");
  f.edit(value => { value[0].account = CONTRACTS[0]; });
  pending.resolve(new Uint8Array(32).buffer);
  assert.equal(await saving, false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_DRAFT_CHANGED");
  assert.equal(f.storage.current().entries.length, 0);
});

test("draft changes while waiting for the storage transaction prevent the commit", async () => {
  const pending = gate();
  const f = fixture();
  await f.controller.refresh();
  f.storage.onChange(() => pending.promise);
  const saving = f.controller.save("waiting");
  await tick();
  f.edit(value => { value[2].tokens = CONTRACTS[0]; });
  pending.resolve();
  assert.equal(await saving, false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_DRAFT_CHANGED");
  assert.equal(f.storage.current().entries.length, 0);
});

test("edits after the transaction committed are reported without pretending the save was cancelled", async () => {
  const f = fixture();
  f.storage.onAfterChange(() => f.edit(value => { value[1].tokens = CONTRACTS[0]; }));
  assert.equal(await f.save(), true);
  assert.equal(f.controller.state().currentDraftChanged, true);
  assert.equal(f.storage.current().entries.length, 1);
});

test("double click cannot create duplicate pending saves", async () => {
  const pending = gate();
  const f = fixture();
  await f.controller.refresh();
  f.storage.onChange(() => pending.promise);
  const saving = f.controller.save("one");
  assert.equal(await f.controller.save("two"), false);
  assert.equal(f.controller.state().busy, true);
  pending.resolve();
  assert.equal(await saving, true);
  assert.equal(f.storage.current().entries.length, 1);
});

test("busy selection cannot redirect a pending inspection", async () => {
  const pending = gate();
  const f = fixture();
  await f.save();
  await f.controller.save("second");
  f.storage.onRead(() => pending.promise);
  const checking = f.controller.inspect();
  assert.equal(f.controller.select(id(1)), false);
  pending.resolve();
  await checking;
  assert.equal(f.controller.state().selectedId, id(2));
  assert.match(f.controller.state().inspection, /控え: second/);
});

test("dispose during delayed read prevents late publication", async () => {
  const pending = gate();
  const f = fixture();
  f.storage.onRead(() => pending.promise);
  const reading = f.controller.refresh();
  const events = f.changes.length;
  f.controller.dispose();
  pending.resolve();
  assert.equal(await reading, false);
  assert.equal(f.changes.length, events);
  assert.equal(f.controller.state().disposed, true);
});

test("dispose during pending save cannot write a checkpoint later", async () => {
  const pending = gate();
  const f = fixture();
  await f.controller.refresh();
  f.storage.onChange(() => pending.promise);
  const saving = f.controller.save("cancelled");
  await tick();
  f.controller.dispose();
  pending.resolve();
  assert.equal(await saving, false);
  assert.equal(f.storage.current().entries.length, 0);
});

test("quota failure preserves previous checkpoints and allows a later explicit refresh", async () => {
  const f = fixture();
  await f.save();
  const before = f.storage.current();
  f.storage.onChange(() => { throw new CheckpointError("CHECKPOINT_QUOTA"); });
  assert.equal(await f.controller.save("will fail"), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_QUOTA");
  assert.deepEqual(f.storage.current(), before);
  assert.equal(await f.controller.refresh(), true);
});

test("invalid current settings cannot be serialized into a stored checkpoint", async () => {
  const f = fixture();
  await f.controller.refresh();
  f.edit(value => { value[0].account = "unfinished"; });
  assert.equal(await f.controller.save("invalid"), false);
  assert.equal(f.storage.current().entries.length, 0);
});

test("controller keeps full stored payload out of state notifications", async () => {
  const f = fixture();
  await f.save();
  assert.ok(!JSON.stringify(f.controller.state()).includes("fileText"));
  assert.ok(!JSON.stringify(f.changes).includes("nativeBalanceBaseUnits"));
});

test("unexpected adapter failure does not echo private exception text into state", async () => {
  const f = fixture();
  f.storage.onRead(() => { throw Error("secret diagnostic contents"); });
  await f.controller.refresh();
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_ACTION");
  assert.ok(!JSON.stringify(f.controller.state()).includes("secret diagnostic"));
});

test("empty and malformed names fail before committing storage", async () => {
  const f = fixture();
  await f.controller.refresh();
  assert.equal(await f.controller.save("  "), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_LABEL");
  assert.deepEqual(f.storage.calls, ["read"]);
});

test("duplicate generated IDs do not replace an existing checkpoint", async () => {
  const f = fixture({ createId: () => id(1) });
  await f.save();
  assert.equal(await f.controller.save("another"), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_DUPLICATE");
  assert.equal(f.storage.current().entries[0].label, "Checkpoint");
});

test("stage callbacks that fail do not claim that a restoration proposal was opened", async () => {
  const f = fixture({ onStage: () => { throw Error("cannot stage"); } });
  await f.save();
  await f.controller.inspect();
  assert.equal(await f.controller.stage(), false);
  assert.equal(f.controller.state().lastAction, null);
});

test("download failures leave the saved record intact", async () => {
  const f = fixture({ download: () => { throw Error("blocked download"); } });
  await f.save();
  assert.equal(await f.controller.exportFile(), false);
  assert.equal(f.storage.current().entries.length, 1);
});

test("model-level corrupt document from storage is rejected without repairing it", async () => {
  const f = fixture({ storage: { read: async () => ({ schema: "unknown" }), change: () => assert.fail(), close() {} } });
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.controller.state().metadata, null);
});

test("disposing a controller repeatedly closes the repository once", () => {
  const f = fixture();
  f.controller.dispose();
  f.controller.dispose();
  assert.deepEqual(f.storage.calls, ["close"]);
});
