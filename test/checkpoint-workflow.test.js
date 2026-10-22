import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { prepareCheckpointCollection } from "../src/checkpoint-transfer.js";
import { workspaceDraftKey, workspaceToDraft } from "../src/workspace-format.js";
import { decodeWorkspaceFile } from "../src/workspace-file.js";
import { summarizeWorkspace } from "../src/workspace-overview.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, clone, gate, tick, OPTIONS } from "./helpers/workspace-fixtures.js";
import { memoryStorage, stored, id, TIME, preparedDraft } from "./helpers/checkpoint-fixtures.js";

function session(initial = draft({ populated: false, accounts: false }), storage = memoryStorage()) {
  let current = clone(initial);
  let failOnce = false;
  let writes = 0;
  const document = { createElement: tag => new Element(tag) };
  const parent = new Element("main");
  const readDraft = () => clone(current);
  const workspace = mountWorkspacePanel({
    document, parent, readDraft, download: () => {},
    writeDraft: value => {
      writes++;
      current[0] = clone(value[0]);
      if (failOnce) { failOnce = false; throw Error("Synthetic interrupted restore"); }
      current = clone(value);
    },
  });
  let counter = 100 + storage.current().entries.length;
  const checkpoint = createCheckpointController({
    storage, readDraft, now: () => TIME, createId: () => id(++counter),
    onStage: text => workspace.stageText(text), download: () => {},
  });
  const field = name => parent.find("workspace-" + name);
  const check = name => {
    field(name).checked = true;
    field(name).dispatchEvent(new Event("change"));
  };
  return {
    readDraft, storage, checkpoint, workspace, field, check,
    writes: () => writes, failRestore: () => { failOnce = true; },
    edit: change => { change(current); workspace.invalidate(); checkpoint.invalidateDraft(); },
    async stageFirst() {
      await checkpoint.refresh();
      checkpoint.select(storage.current().entries[0].id);
      assert.equal(await checkpoint.inspect(), true);
      assert.equal(await checkpoint.stage(), true);
    },
    apply() {
      field("preview").click();
      check("confirmed");
      field("apply").click();
    },
    dispose() { checkpoint.dispose(); workspace.dispose(); },
  };
}

test("saved checkpoint stages into the real workspace panel without an implicit apply", async () => {
  const prepared = await preparedDraft();
  const f = session(undefined, memoryStorage(stored(1, prepared.text)));
  const original = workspaceDraftKey(f.readDraft());
  await f.stageFirst();
  assert.equal(workspaceDraftKey(f.readDraft()), original);
  assert.equal(f.writes(), 0);
  assert.equal(f.field("apply").disabled, true);
  f.apply();
  assert.equal(summarizeWorkspace(f.readDraft()).totalObservations, 3);
  assert.equal(summarizeWorkspace(f.readDraft()).configured, 3);
  assert.equal(f.writes(), 1);
  f.dispose();
});

test("failed restore rolls back the screen and preserves the saved checkpoint", async () => {
  const prepared = await preparedDraft();
  const storage = memoryStorage(stored(1, prepared.text));
  const f = session(undefined, storage);
  const original = workspaceDraftKey(f.readDraft());
  const storedBefore = storage.current();
  await f.stageFirst();
  f.failRestore();
  f.apply();
  assert.equal(workspaceDraftKey(f.readDraft()), original);
  assert.deepEqual(storage.current(), storedBefore);
  assert.match(f.field("status").textContent, /戻/);
  assert.equal(f.writes(), 2);
  f.dispose();
});

test("restoration undo changes current forms without mutating persistent snapshots", async () => {
  const prepared = await preparedDraft();
  const f = session(undefined, memoryStorage(stored(1, prepared.text)));
  const original = workspaceDraftKey(f.readDraft());
  await f.stageFirst();
  f.apply();
  assert.equal(summarizeWorkspace(f.readDraft()).totalObservations, 3);
  f.field("undo-preview").click();
  f.check("undo-confirmed");
  f.field("undo-apply").click();
  assert.equal(workspaceDraftKey(f.readDraft()), original);
  assert.equal(f.storage.current().entries[0].fileText, prepared.text);
  f.dispose();
});

test("history-only restore from a checkpoint preserves unfinished account input", async () => {
  const prepared = await preparedDraft();
  const f = session(undefined, memoryStorage(stored(1, prepared.text)));
  f.edit(value => { value[0].account = "unfinished"; });
  await f.stageFirst();
  f.field("settings").checked = false;
  f.field("settings").dispatchEvent(new Event("change"));
  f.apply();
  assert.equal(f.readDraft()[0].account, "unfinished");
  assert.equal(summarizeWorkspace(f.readDraft()).totalObservations, 3);
  f.dispose();
});

test("two save and restore cycles do not multiply historical observations", async () => {
  const source = session(draft());
  await source.checkpoint.refresh();
  assert.equal(await source.checkpoint.save("First"), true);
  const saved = source.storage.current();
  const second = session(undefined, memoryStorage(saved));
  await second.stageFirst();
  second.apply();
  assert.equal(await second.checkpoint.save("Second"), true);
  const third = session(second.readDraft(), memoryStorage(second.storage.current()));
  await third.stageFirst();
  third.apply();
  assert.equal(summarizeWorkspace(third.readDraft()).totalObservations, 3);
  assert.equal(third.storage.current().entries.length, 2);
  source.dispose();
  second.dispose();
  third.dispose();
});

test("corrupt stage input leaves a valid workspace preview intact", async () => {
  const prepared = await preparedDraft();
  const f = session(undefined, memoryStorage(stored(1, prepared.text)));
  await f.stageFirst();
  f.field("preview").click();
  f.check("confirmed");
  const reviewedText = f.field("json").value;
  assert.equal(f.field("apply").disabled, false);
  assert.throws(() => f.workspace.stageText("{damaged"));
  assert.equal(f.field("json").value, reviewedText);
  assert.equal(f.field("apply").disabled, false);
  f.field("apply").click();
  assert.equal(summarizeWorkspace(f.readDraft()).configured, 3);
  f.dispose();
});

test("a new valid stage clears old options confirmation before applying another checkpoint", async () => {
  const first = await preparedDraft({ block: "42" });
  const second = await preparedDraft({ block: "99" });
  const f = session(undefined, memoryStorage(stored(1, first.text)));
  await f.stageFirst();
  f.field("preview").click();
  f.check("confirmed");
  const decoded = await decodeWorkspaceFile(new TextEncoder().encode(second.text));
  f.workspace.stageText(decoded.text);
  assert.equal(f.field("confirmed").checked, false);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.writes(), 0);
  f.apply();
  assert.deepEqual(f.readDraft(), workspaceToDraft(decoded.workspace));
  f.dispose();
});

test("editing the live screen after staging cannot reuse stale restore approval", async () => {
  const prepared = await preparedDraft();
  const f = session(undefined, memoryStorage(stored(1, prepared.text)));
  await f.stageFirst();
  f.field("preview").click();
  f.check("confirmed");
  f.edit(value => { value[0].tokens = ""; });
  assert.equal(f.field("apply").disabled, true);
  f.field("apply").click();
  assert.equal(f.writes(), 0);
  f.dispose();
});

test("cancelled queued collection apply does not write or publish a successful import", async () => {
  const storage = memoryStorage();
  const f = session(undefined, storage);
  await f.checkpoint.refresh();
  const text = (await prepareCheckpointCollection(stored(1, (await preparedDraft()).text))).text;
  await f.checkpoint.reviewImport(text);
  const pending = gate();
  storage.onChange(() => pending.promise);
  const applying = f.checkpoint.applyImport(text);
  assert.equal(f.checkpoint.state().activeAction, "importApply");
  f.checkpoint.cancelImport();
  pending.resolve();
  assert.equal(await applying, false);
  assert.equal(storage.current().entries.length, 0);
  assert.equal(f.checkpoint.state().lastAction, null);
  assert.equal(f.checkpoint.state().errorCode, "CHECKPOINT_CANCELLED");
  f.dispose();
});

test("disposing while a collection transaction waits cannot revive the closed session", async () => {
  const storage = memoryStorage();
  const f = session(undefined, storage);
  await f.checkpoint.refresh();
  const text = (await prepareCheckpointCollection(stored(1, (await preparedDraft()).text))).text;
  await f.checkpoint.reviewImport(text);
  const pending = gate();
  storage.onChange(() => pending.promise);
  const applying = f.checkpoint.applyImport(text);
  await tick();
  f.dispose();
  pending.resolve();
  assert.equal(await applying, false);
  assert.equal(storage.current().entries.length, 0);
  assert.equal(f.checkpoint.state().disposed, true);
});

test("disposed workspace refuses a late stage without altering retained input", async () => {
  const f = session();
  const field = f.field("json");
  field.value = "Preserve old text";
  f.workspace.dispose();
  const prepared = await preparedDraft();
  const decoded = await decodeWorkspaceFile(new TextEncoder().encode(prepared.text));
  assert.equal(f.workspace.stageText(decoded.text), false);
  assert.equal(field.value, "Preserve old text");
  f.checkpoint.dispose();
});

