import test from "node:test";
import assert from "node:assert/strict";
import { createVaultTimeline, VAULT_UNDO_LIMIT, VAULT_UNDO_BYTES } from "../src/transfer-vault-timeline.js";
import { vaultBundle, vaultKey } from "../src/transfer-vault-model.js";
import { bundleFor, controllerFixture, memoryVault } from "./helpers/vault-fixtures.js";
import { deferred, code, clone, fileFromText } from "./helpers/transfer-fixtures.js";
import { prepareVaultFile } from "../src/transfer-vault-file.js";

test("timeline starts empty and performs no implicit backup or restore", () => {
  const timeline = createVaultTimeline();
  assert.deepEqual(timeline.describe(), { undoCount: 0, redoCount: 0, bytes: 0, truncated: false, nextUndoSource: null, nextRedoSource: null });
  assert.throws(() => timeline.back(vaultBundle()), code("TRANSFER_VAULT_UNDO_EMPTY"));
  assert.throws(() => timeline.forward(vaultBundle()), code("TRANSFER_VAULT_UNDO_EMPTY"));
});

for (const source of ["cards", "file", "legacy", "stored"]) {
  test("timeline round-trips a " + source + " replacement exactly", () => {
    const timeline = createVaultTimeline();
    const before = bundleFor(["DAT"]), after = bundleFor();
    timeline.record(before, after, source);
    assert.equal(timeline.describe().nextUndoSource, source);
    assert.equal(vaultKey(timeline.back(after)), vaultKey(before));
    assert.equal(timeline.describe().nextRedoSource, source);
    assert.equal(vaultKey(timeline.forward(before)), vaultKey(after));
    assert.equal(timeline.describe().undoCount, 1);
  });
}

test("multiple undo and redo steps preserve every original observation", () => {
  const timeline = createVaultTimeline();
  const states = [vaultBundle(), bundleFor(["DAT"]), bundleFor(["DAT", "EMA"]), bundleFor()];
  for (let i = 1; i < states.length; i++) timeline.record(states[i - 1], states[i], "file");
  let current = states.at(-1);
  const bytes = timeline.describe().bytes;
  for (let i = states.length - 2; i >= 0; i--) {
    current = timeline.back(current);
    assert.equal(vaultKey(current), vaultKey(states[i]));
  }
  assert.equal(timeline.describe().undoCount, 0);
  assert.equal(timeline.describe().redoCount, 3);
  for (let i = 1; i < states.length; i++) {
    current = timeline.forward(current);
    assert.equal(vaultKey(current), vaultKey(states[i]));
  }
  assert.equal(timeline.describe().bytes, bytes);
});

test("a new branch after undo discards only redo, not the remaining undo steps", () => {
  const timeline = createVaultTimeline();
  const empty = vaultBundle(), one = bundleFor(["DAT"]), two = bundleFor(["DAT", "EMA"]), different = bundleFor(["DAT", "CAWELON"]);
  timeline.record(empty, one, "cards");
  timeline.record(one, two, "file");
  assert.deepEqual(timeline.back(two), one);
  timeline.record(one, different, "legacy");
  assert.equal(timeline.describe().redoCount, 0);
  assert.equal(timeline.describe().undoCount, 2);
  assert.deepEqual(timeline.back(different), one);
  assert.deepEqual(timeline.back(one), empty);
});

test("no-op replacement preserves available redo and does not consume capacity", () => {
  const timeline = createVaultTimeline();
  const empty = vaultBundle(), after = bundleFor();
  timeline.record(empty, after, "file");
  timeline.back(after);
  const before = timeline.describe();
  timeline.record(empty, empty, "cards");
  assert.deepEqual(timeline.describe(), before);
  assert.deepEqual(timeline.forward(empty), after);
});

test("undo refuses a stale working copy instead of discarding an external edit", () => {
  const timeline = createVaultTimeline();
  timeline.record(vaultBundle(), bundleFor(), "cards");
  assert.throws(() => timeline.back(bundleFor(["DAT"])), code("TRANSFER_VAULT_UNDO_STALE"));
  assert.equal(timeline.describe().undoCount, 1);
});

test("redo refuses a stale working copy and keeps the redo operation intact", () => {
  const timeline = createVaultTimeline();
  timeline.record(vaultBundle(), bundleFor(), "cards");
  timeline.back(bundleFor());
  assert.throws(() => timeline.forward(bundleFor(["DAT"])), code("TRANSFER_VAULT_UNDO_STALE"));
  assert.equal(timeline.describe().redoCount, 1);
});

test("recording refuses a disconnected history chain", () => {
  const timeline = createVaultTimeline();
  timeline.record(vaultBundle(), bundleFor(["DAT"]), "cards");
  assert.throws(() => timeline.record(bundleFor(["EMA"]), bundleFor(), "file"), code("TRANSFER_VAULT_UNDO_STALE"));
  assert.equal(timeline.describe().undoCount, 1);
});

test("timeline snapshots are detached from mutable input", () => {
  const before = clone(bundleFor(["DAT"])), after = clone(bundleFor());
  const timeline = createVaultTimeline();
  timeline.record(before, after, "file");
  before.slots[0].archive.records[0].events[0].amountBaseUnits = "2";
  const result = timeline.back(bundleFor());
  assert.notEqual(result.slots[0].archive.records[0].events[0].amountBaseUnits, "2");
  assert.equal(Object.isFrozen(result.slots), true);
});

test("entry count cap drops oldest undo steps with an explicit truncated flag", () => {
  const timeline = createVaultTimeline({ maxEntries: 2 });
  const states = [vaultBundle(), bundleFor(["DAT"]), bundleFor(["DAT", "EMA"]), bundleFor()];
  for (let i = 1; i < states.length; i++) timeline.record(states[i - 1], states[i], "file");
  assert.equal(timeline.describe().undoCount, 2);
  assert.equal(timeline.describe().truncated, true);
  assert.deepEqual(timeline.back(states[3]), states[2]);
  assert.deepEqual(timeline.back(states[2]), states[1]);
  assert.throws(() => timeline.back(states[1]), code("TRANSFER_VAULT_UNDO_EMPTY"));
});

test("oversized undo snapshot is omitted without rejecting the user operation", () => {
  const timeline = createVaultTimeline({ maxBytes: 1 });
  const description = timeline.record(vaultBundle(), bundleFor(), "file");
  assert.equal(description.undoCount, 0);
  assert.equal(description.bytes, 0);
  assert.equal(description.truncated, true);
});

test("byte budget trims old history and bounds both undo and redo memory", () => {
  const empty = vaultBundle(), first = bundleFor(["DAT"]), second = bundleFor(["DAT", "EMA"]);
  const width = new TextEncoder().encode(vaultKey(first) + vaultKey(second)).byteLength;
  const timeline = createVaultTimeline({ maxBytes: width });
  timeline.record(empty, first, "cards");
  timeline.record(first, second, "file");
  assert.equal(timeline.describe().undoCount, 1);
  assert.equal(timeline.describe().bytes, width);
  timeline.back(second);
  assert.equal(timeline.describe().bytes, width);
  timeline.forward(first);
  assert.equal(timeline.describe().bytes, width);
});

for (const options of [{ maxEntries: 0 }, { maxEntries: 6 }, { maxEntries: 1.1 }, { maxBytes: 0 }, { maxBytes: Infinity }, { maxBytes: VAULT_UNDO_BYTES + 1 }]) {
  test("invalid undo budget " + JSON.stringify(options), () => {
    assert.throws(() => createVaultTimeline(options), code("TRANSFER_VAULT_UNDO_OPTIONS"));
  });
}

test("timeline refuses unknown sources and clears all references on disposal", () => {
  const timeline = createVaultTimeline();
  assert.throws(() => timeline.record(vaultBundle(), bundleFor(), "rpc"), code("TRANSFER_VAULT_UNDO_SOURCE"));
  timeline.record(vaultBundle(), bundleFor(), "cards");
  timeline.clear();
  assert.equal(timeline.describe().bytes, 0);
  assert.equal(timeline.describe().truncated, false);
});

test("controller undo affects only working data, not saved entries or card configuration", async () => {
  const f = controllerFixture();
  await f.capture();
  await f.save();
  assert.equal(f.controller.state.timeline.undoCount, 1);
  assert.equal(f.controller.undo(), true);
  assert.equal(f.controller.state.hasRecords, false);
  assert.equal(f.storage.value.entries.length, 1);
  assert.equal(f.staged.length, 0);
  assert.equal(f.controller.redo(), true);
  assert.equal(f.controller.state.hasRecords, true);
  assert.equal(f.controller.state.saved, true);
  assert.equal(f.storage.value.revision, 1);
});

test("undo invalidates pending file preview but does not erase the downloaded file", async () => {
  const f = controllerFixture();
  await f.capture();
  const prepared = await prepareVaultFile(bundleFor(["DAT"]));
  await f.controller.load(fileFromText(prepared.text));
  const previewId = f.controller.state.review.id;
  assert.equal(f.controller.undo(), true);
  assert.equal(f.controller.state.review, null);
  assert.equal(await f.controller.apply(previewId, { acknowledgeRemoval: true }), false);
  assert.equal(JSON.parse(prepared.text).bundle.slots[0].agent, "DAT");
});

test("undo and redo are blocked during a pending storage commit", async () => {
  const pending = deferred();
  const f = controllerFixture({ storage: memoryVault(undefined, { beforeChange: () => pending.promise }) });
  await f.capture();
  await f.controller.refresh();
  const saving = f.controller.save("Guarded");
  assert.equal(f.controller.undo(), false);
  assert.equal(f.controller.redo(), false);
  pending.resolve();
  assert.equal(await saving, true);
  assert.equal(f.controller.undo(), true);
  assert.equal(f.storage.value.entries.length, 1);
});

test("a later replacement can be undone even when it changes account or removes tokens", async () => {
  const f = controllerFixture();
  await f.capture();
  const original = vaultKey(f.controller.state.working);
  const prepared = await prepareVaultFile(bundleFor(["EMA"]));
  await f.controller.load(fileFromText(prepared.text));
  await f.controller.apply(f.controller.state.review.id, { acknowledgeRemoval: true });
  assert.equal(f.controller.state.working.slots[0].archive, null);
  f.controller.undo();
  assert.equal(vaultKey(f.controller.state.working), original);
  f.controller.redo();
  assert.equal(f.controller.state.working.slots[0].archive, null);
});

test("controller disposal clears volatile timeline without touching stored snapshots", async () => {
  const f = controllerFixture();
  await f.capture();
  await f.save();
  f.controller.dispose();
  assert.equal(f.controller.state.timeline.undoCount, 0);
  assert.equal(f.controller.state.timeline.bytes, 0);
  assert.equal(f.controller.undo(), false);
  assert.equal(f.controller.redo(), false);
  assert.equal(f.storage.value.entries.length, 1);
});
