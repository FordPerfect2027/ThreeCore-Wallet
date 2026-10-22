import test from "node:test";
import assert from "node:assert/strict";
import { CHECKPOINT_SCHEMA, CHECKPOINT_LIMIT, CHECKPOINT_TOTAL_BYTES, CheckpointError,
  emptyCheckpointDocument, validateCheckpointDocument, checkpointMetadata, mutateCheckpoints,
  checkpointLabel, checkpointTime, checkpointId } from "../src/checkpoint-model.js";
import { TIME, LATER, EARLIER, id, stored, saveOperation } from "./helpers/checkpoint-fixtures.js";
import { clone } from "./helpers/workspace-fixtures.js";

test("local checkpoint model begins with an empty versioned document", () => {
  assert.deepEqual(emptyCheckpointDocument(), { schema: CHECKPOINT_SCHEMA, revision: 0, entries: [] });
  assert.equal(CHECKPOINT_LIMIT, 5);
  assert.ok(Object.isFrozen(emptyCheckpointDocument().entries));
});

test("saving a checkpoint allocates a new identity without overwriting an old label", () => {
  const before = stored();
  const operation = { ...saveOperation(2), label: before.entries[0].label };
  const after = mutateCheckpoints(before, 1, operation);
  assert.equal(after.entries.length, 2);
  assert.equal(after.revision, 2);
  assert.equal(after.entries[0].id, id(1));
  assert.equal(after.entries[1].id, id(2));
  assert.equal(before.entries.length, 1);
});

test("duplicate checkpoint IDs fail even when the label is different", () => {
  assert.throws(() => mutateCheckpoints(stored(), 1, saveOperation(1)), { code: "CHECKPOINT_DUPLICATE" });
});

test("full storage never evicts or replaces the oldest entry", () => {
  const before = stored(5);
  const snapshot = clone(before);
  assert.throws(() => mutateCheckpoints(before, 5, saveOperation(6)), { code: "CHECKPOINT_CAPACITY" });
  assert.deepEqual(before, snapshot);
});

test("archived checkpoints count toward the same fixed capacity", () => {
  const before = mutateCheckpoints(stored(5), 5, { kind: "archive", id: id(1), time: LATER });
  assert.equal(checkpointMetadata(before).remaining, 0);
  assert.throws(() => mutateCheckpoints(before, 6, saveOperation(6)), { code: "CHECKPOINT_CAPACITY" });
});

test("archive and unarchive preserve the complete backup bytes and original timestamp", () => {
  const before = stored();
  const archived = mutateCheckpoints(before, 1, { kind: "archive", id: id(1), time: LATER });
  assert.equal(archived.entries[0].archived, true);
  assert.equal(archived.entries[0].createdAt, TIME);
  assert.equal(archived.entries[0].updatedAt, LATER);
  const restored = mutateCheckpoints(archived, 2, { kind: "unarchive", id: id(1), time: LATER });
  assert.equal(restored.entries[0].archived, false);
  assert.equal(restored.entries[0].fileText, before.entries[0].fileText);
});

test("renaming affects only metadata and keeps backup identity unchanged", () => {
  const before = stored();
  const after = mutateCheckpoints(before, 1, { kind: "rename", id: id(1), label: "  before upgrade  ", time: LATER });
  assert.equal(after.entries[0].label, "before upgrade");
  assert.equal(after.entries[0].fileText, before.entries[0].fileText);
  assert.equal(after.entries[0].id, id(1));
});

test("PC clock rollback cannot move the update timestamp before its current value", () => {
  const before = stored();
  const after = mutateCheckpoints(before, 1, { kind: "rename", id: id(1), label: "renamed", time: EARLIER });
  assert.equal(after.entries[0].updatedAt, TIME);
});

for (const operation of [
  { kind: "rename", id: id(1), label: "控え 1", time: LATER },
  { kind: "unarchive", id: id(1), time: LATER },
]) {
  test("a no-op does not create a revision: " + operation.kind, () => {
    assert.equal(mutateCheckpoints(stored(), 1, operation).revision, 1);
  });
}

test("permanent removal only accepts a specifically confirmed archived entry", () => {
  const active = stored();
  assert.throws(() => mutateCheckpoints(active, 1, { kind: "purge", id: id(1), confirmed: true }),
    { code: "CHECKPOINT_CONFIRMATION" });
  const archived = mutateCheckpoints(active, 1, { kind: "archive", id: id(1), time: LATER });
  assert.throws(() => mutateCheckpoints(archived, 2, { kind: "purge", id: id(1), confirmed: false }),
    { code: "CHECKPOINT_CONFIRMATION" });
  const after = mutateCheckpoints(archived, 2, { kind: "purge", id: id(1), confirmed: true });
  assert.equal(after.entries.length, 0);
  assert.equal(after.revision, 3);
});

for (const revision of [-1, 0, 2, "1", NaN, Infinity]) {
  test("stale or malformed expected revision cannot write: " + revision, () => {
    assert.throws(() => mutateCheckpoints(stored(), revision, saveOperation(2)), { code: "CHECKPOINT_STALE" });
  });
}

test("revision overflow refuses a write without losing existing records", () => {
  const before = stored();
  before.revision = Number.MAX_SAFE_INTEGER;
  assert.throws(() => mutateCheckpoints(before, before.revision, saveOperation(2)), { code: "CHECKPOINT_REVISION" });
  assert.equal(before.entries.length, 1);
});

test("metadata reports total bytes and excludes all stored observation text", () => {
  const summary = checkpointMetadata(stored(2, "秘密"));
  assert.equal(summary.totalBytes, 12);
  assert.equal(summary.count, 2);
  assert.equal(summary.remaining, 3);
  assert.ok(!JSON.stringify(summary).includes("秘密"));
  assert.ok(Object.isFrozen(summary.entries[0]));
});

for (const value of ["", " ", "a".repeat(61), "a\nb", "a\rb", "x\u0000", "x\u202e", "x\u2066", 1, null]) {
  test("checkpoint names reject invalid or misleading text: " + JSON.stringify(value), () => {
    assert.throws(() => checkpointLabel(value), { code: "CHECKPOINT_LABEL" });
  });
}

test("plain HTML-like label text is data; no HTML is generated by the model", () => {
  assert.equal(checkpointLabel("<img src=x>"), "<img src=x>");
  assert.equal(checkpointLabel("あ".repeat(60)).length, 60);
});

for (const value of ["2026-02-30T00:00:00.000Z", "2026-10-23", "2026-10-23T00:00:00Z",
  "2026-10-23T00:00:00.000+00:00", "", 1, null]) {
  test("checkpoint timestamps require canonical real UTC dates: " + value, () => {
    assert.throws(() => checkpointTime(value), { code: "CHECKPOINT_TIME" });
  });
}

test("canonical valid leap day is accepted", () => {
  assert.equal(checkpointTime("2024-02-29T12:00:00.000Z"), "2024-02-29T12:00:00.000Z");
});

for (const value of ["", id(1).toUpperCase().replace("11111111", "ABCDEFAB"),
  id(1).replace("-4333", "-3333"), id(1).replace("-8444", "-7444"), "../file", null]) {
  test("checkpoint IDs reject invalid identity forms: " + value, () => {
    assert.throws(() => checkpointId(value), { code: "CHECKPOINT_ID" });
  });
}

for (const field of ["schema", "revision", "entries"]) {
  test("missing document field is rejected: " + field, () => {
    const value = stored();
    delete value[field];
    assert.throws(() => validateCheckpointDocument(value), { code: "CHECKPOINT_SHAPE" });
  });
}

for (const field of ["id", "label", "createdAt", "updatedAt", "archived", "fileText"]) {
  test("missing slot field is rejected: " + field, () => {
    const value = stored();
    delete value.entries[0][field];
    assert.throws(() => validateCheckpointDocument(value), { code: "CHECKPOINT_SHAPE" });
  });
}

test("accessors are rejected without reading them", () => {
  const value = stored();
  let reads = 0;
  Object.defineProperty(value.entries[0], "fileText", { get() { reads++; return "{}"; } });
  assert.throws(() => validateCheckpointDocument(value), { code: "CHECKPOINT_SHAPE" });
  assert.equal(reads, 0);
});

test("array accessors and sparse entries do not become missing backups", () => {
  const value = stored();
  let reads = 0;
  Object.defineProperty(value.entries, "0", { get() { reads++; return {}; } });
  assert.throws(() => validateCheckpointDocument(value), { code: "CHECKPOINT_SHAPE" });
  assert.equal(reads, 0);
  const sparse = stored();
  delete sparse.entries[0];
  assert.throws(() => validateCheckpointDocument(sparse));
});

test("prototype and unknown fields cannot enter the storage document", () => {
  const value = stored();
  value.entries[0].privateKey = "forbidden";
  assert.throws(() => validateCheckpointDocument(value), { code: "CHECKPOINT_SHAPE" });
  const inherited = Object.create(stored());
  assert.throws(() => validateCheckpointDocument(inherited), { code: "CHECKPOINT_SHAPE" });
});

test("duplicate slot identity in storage is treated as corruption", () => {
  const value = stored(2);
  value.entries[1].id = value.entries[0].id;
  assert.throws(() => validateCheckpointDocument(value), { code: "CHECKPOINT_DUPLICATE" });
});

test("stored metadata must already be normalized", () => {
  const value = stored();
  value.entries[0].label = " untrimmed ";
  assert.throws(() => validateCheckpointDocument(value), { code: "CHECKPOINT_SHAPE" });
});

test("single-file and aggregate byte limits are enforced before changing storage", () => {
  const operation = saveOperation(1, "x".repeat(8 * 1024 * 1024 + 1));
  assert.throws(() => mutateCheckpoints(emptyCheckpointDocument(), 0, operation), { code: "CHECKPOINT_FILE" });
  const before = stored(3, "x".repeat(8 * 1024 * 1024));
  assert.equal(checkpointMetadata(before).totalBytes, CHECKPOINT_TOTAL_BYTES);
  assert.throws(() => mutateCheckpoints(before, 3, saveOperation(4)), { code: "CHECKPOINT_CAPACITY" });
});

test("UTF-8 byte sizes prevent multibyte input from bypassing storage bounds", () => {
  const value = "あ".repeat(3 * 1024 * 1024);
  assert.throws(() => mutateCheckpoints(emptyCheckpointDocument(), 0, saveOperation(1, value)), { code: "CHECKPOINT_FILE" });
});

test("model output is deeply frozen and detached from caller-owned input", () => {
  const value = stored();
  const validated = validateCheckpointDocument(value);
  value.entries[0].label = "changed";
  assert.equal(validated.entries[0].label, "控え 1");
  assert.ok(Object.isFrozen(validated.entries[0]));
});

for (const operation of [
  { kind: "purge", id: id(1), confirmed: true, silent: true },
  { kind: "save", ...saveOperation(2), privateKey: "no" },
  { kind: "wipe", id: id(1), time: TIME },
  { kind: "archive", id: id(99), time: TIME },
]) {
  test("unknown or misplaced operations fail: " + JSON.stringify(operation), () => {
    assert.throws(() => mutateCheckpoints(stored(), 1, operation), CheckpointError);
  });
}
