import test from "node:test";
import assert from "node:assert/strict";
import { prepareCheckpointCollection, decodeCheckpointCollection, reviewCheckpointImport,
  describeCheckpointImport, createCheckpointCollectionReader, CHECKPOINT_TRANSFER_LIMIT } from "../src/checkpoint-transfer.js";
import { emptyCheckpointDocument, mutateCheckpoints, CheckpointError } from "../src/checkpoint-model.js";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { stored, id, LATER, preparedDraft, memoryStorage } from "./helpers/checkpoint-fixtures.js";
import { clone, draft, fileObject, gate, tick } from "./helpers/workspace-fixtures.js";

const matches = code => error => error.code === code;
const validFile = await preparedDraft();
const collection = count => stored(count, validFile.text);
const pack = async count => (await prepareCheckpointCollection(collection(count))).text;

test("collection export round trips all five snapshots and archive metadata", async () => {
  const input = collection(5);
  input.entries[2].archived = true;
  input.entries[2].label = "保管済みの控え";
  input.entries[2].updatedAt = LATER;
  const prepared = await prepareCheckpointCollection(input);
  const decoded = await decodeCheckpointCollection(prepared.text);
  assert.deepEqual(decoded.entries, input.entries);
  assert.equal(decoded.checksumVerified, true);
  assert.equal(decoded.authenticated, false);
  assert.equal(prepared.byteLength, Buffer.byteLength(prepared.text));
  assert.equal(prepared.filename, "ThreeCore-saved-checkpoints.json");
});

test("empty collection remains a valid portable backup", async () => {
  const prepared = await prepareCheckpointCollection(emptyCheckpointDocument());
  assert.deepEqual((await decodeCheckpointCollection(prepared.text)).entries, []);
});

test("collection digest ignores local revision but binds names and archive states", async () => {
  const input = collection(1);
  const first = await prepareCheckpointCollection(input);
  input.revision += 5;
  const same = await prepareCheckpointCollection(input);
  assert.equal(same.digest, first.digest);
  input.entries[0].label = "renamed";
  assert.notEqual((await prepareCheckpointCollection(input)).digest, first.digest);
  input.entries[0].archived = true;
  assert.notEqual((await prepareCheckpointCollection(input)).digest, first.digest);
});

test("outer whitespace is harmless but embedded workspace bytes stay exact", async () => {
  const packed = await pack(1);
  const compact = JSON.stringify(JSON.parse(packed));
  assert.deepEqual((await decodeCheckpointCollection(compact)).entries, collection(1).entries);
  const modified = JSON.parse(packed);
  modified.entries[0].fileText += "\n";
  await assert.rejects(decodeCheckpointCollection(JSON.stringify(modified)), matches("CHECKPOINT_TRANSFER_CHECKSUM"));
});

for (const field of ["schema", "algorithm", "digest", "entries"]) {
  test("collection rejects missing envelope field: " + field, async () => {
    const payload = JSON.parse(await pack(1));
    delete payload[field];
    await assert.rejects(decodeCheckpointCollection(JSON.stringify(payload)), matches("CHECKPOINT_TRANSFER_SCHEMA"));
  });
}

for (const [field, value] of [
  ["schema", "other"], ["algorithm", "MD5"], ["digest", "00"], ["digest", "A".repeat(64)],
  ["entries", null], ["entries", {}],
]) {
  test("collection rejects invalid envelope " + field + "=" + JSON.stringify(value), async () => {
    const payload = JSON.parse(await pack(1));
    payload[field] = value;
    await assert.rejects(decodeCheckpointCollection(JSON.stringify(payload)));
  });
}

test("collection rejects unrecognized envelope fields", async () => {
  const payload = JSON.parse(await pack(1));
  payload.privateKey = "not a key";
  await assert.rejects(decodeCheckpointCollection(JSON.stringify(payload)), matches("CHECKPOINT_TRANSFER_SCHEMA"));
});

for (const value of ["null", "[]", "true", "{broken"]) {
  test("collection does not accept a non-envelope JSON document " + value, async () => {
    await assert.rejects(decodeCheckpointCollection(value));
  });
}

test("collection rejects name tampering before releasing any entries", async () => {
  const payload = JSON.parse(await pack(3));
  payload.entries[2].label = "tampered";
  await assert.rejects(decodeCheckpointCollection(JSON.stringify(payload)), matches("CHECKPOINT_TRANSFER_CHECKSUM"));
});

test("collection export validates inner workspace files, even in archived snapshots", async () => {
  const input = collection(3);
  input.entries[2].fileText = "{}";
  input.entries[2].archived = true;
  await assert.rejects(prepareCheckpointCollection(input));
});

test("a recomputed collection checksum cannot make an invalid workspace importable", async () => {
  const payload = JSON.parse(await pack(2));
  payload.entries[1].fileText = "{}";
  const canonical = JSON.stringify({ schema: "threecore-local-checkpoints-v1", revision: 0, entries: payload.entries });
  payload.digest = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(canonical))).toString("hex");
  await assert.rejects(decodeCheckpointCollection(JSON.stringify(payload)));
});

test("collection digest requires available SHA-256 support", async () => {
  await assert.rejects(prepareCheckpointCollection(emptyCheckpointDocument(), { subtle: null }), matches("CHECKPOINT_CRYPTO"));
  await assert.rejects(decodeCheckpointCollection(await pack(0), { subtle: {} }), matches("CHECKPOINT_CRYPTO"));
});

test("collection rejects malformed crypto output", async () => {
  await assert.rejects(prepareCheckpointCollection(emptyCheckpointDocument(), {
    subtle: { digest: async () => new Uint8Array(2) },
  }), matches("CHECKPOINT_CRYPTO"));
});

test("collection input is bounded before parsing", async () => {
  await assert.rejects(decodeCheckpointCollection(""), matches("CHECKPOINT_TRANSFER_SIZE"));
  await assert.rejects(decodeCheckpointCollection(null), matches("CHECKPOINT_TRANSFER_SIZE"));
  await assert.rejects(decodeCheckpointCollection(" ".repeat(CHECKPOINT_TRANSFER_LIMIT + 1)), matches("CHECKPOINT_TRANSFER_SIZE"));
});

test("import appends independent IDs and preserves source ordering", () => {
  const current = collection(1);
  const incoming = collection(3).entries;
  const result = mutateCheckpoints(current, current.revision, { kind: "import", entries: incoming });
  assert.deepEqual(result.entries.map(row => row.id), [id(1), id(2), id(3)]);
  assert.equal(result.revision, current.revision + 1);
  assert.deepEqual(current, collection(1));
});

test("reimport is idempotent and preserves existing names and archive state", () => {
  const original = collection(1);
  const incoming = clone(original.entries);
  original.entries[0].label = "Local label";
  original.entries[0].archived = true;
  const result = mutateCheckpoints(original, original.revision, { kind: "import", entries: incoming });
  assert.equal(result.revision, original.revision);
  assert.deepEqual(result.entries, original.entries);
});

test("ID conflict rejects the whole batch without adding earlier rows", () => {
  const current = collection(2);
  const incoming = collection(3).entries.reverse();
  incoming.find(row => row.id === id(1)).fileText = "different";
  assert.throws(() => mutateCheckpoints(current, 2, { kind: "import", entries: incoming }), matches("CHECKPOINT_CONFLICT"));
  assert.equal(current.entries.length, 2);
});

test("batch capacity includes archived entries and rejects all additions", () => {
  const current = collection(4);
  current.entries.forEach(row => { row.archived = true; });
  const incoming = collection(2).entries.map((row, index) => ({ ...row, id: id(index + 10) }));
  assert.throws(() => mutateCheckpoints(current, 4, { kind: "import", entries: incoming }), matches("CHECKPOINT_CAPACITY"));
  assert.equal(current.entries.length, 4);
});

test("duplicate source IDs are rejected instead of silently deduplicated", () => {
  const incoming = collection(1).entries;
  incoming.push(clone(incoming[0]));
  assert.throws(() => reviewCheckpointImport(emptyCheckpointDocument(), incoming), matches("CHECKPOINT_DUPLICATE"));
});

test("review exposes only metadata and does not mutate either collection", () => {
  const current = collection(1);
  const incoming = collection(3).entries;
  const before = JSON.stringify({ current, incoming });
  const review = reviewCheckpointImport(current, incoming);
  assert.equal(review.beforeCount, 1);
  assert.equal(review.afterCount, 3);
  assert.equal(review.added.length, 2);
  assert.deepEqual(review.skipped, [id(1)]);
  assert.equal(review.removesExisting, false);
  assert.equal(review.added[0].fileText, undefined);
  assert.equal(JSON.stringify({ current, incoming }), before);
  assert.match(describeCheckpointImport(review), /1 → 3/);
  assert.match(describeCheckpointImport(review), /上書き・削除しません/);
});

test("decoded portable data cannot be mutated after verification", async () => {
  const decoded = await decodeCheckpointCollection(await pack(1));
  assert.throws(() => { decoded.entries[0].label = "changed"; }, TypeError);
  assert.throws(() => decoded.entries.push({}), TypeError);
});

function controllerFixture(options = {}) {
  const storage = options.storage ?? memoryStorage();
  const downloads = [];
  const controller = createCheckpointController({
    storage, readDraft: () => draft(),
    onStage: () => { throw Error("Import must never stage wallet restoration"); },
    download: result => downloads.push(result), ...options,
  });
  return { storage, controller, downloads };
}

test("review is read-only and apply requires the identical reviewed text", async () => {
  const f = controllerFixture();
  await f.controller.refresh();
  const text = await pack(2);
  assert.equal(await f.controller.reviewImport(text), true);
  assert.equal(f.storage.current().entries.length, 0);
  assert.equal(f.controller.state().canImport, true);
  assert.equal(await f.controller.applyImport(text + "\n"), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_IMPORT_REVIEW");
  assert.equal(f.storage.current().entries.length, 0);
});

test("apply imports once and consumes the review", async () => {
  const f = controllerFixture();
  await f.controller.refresh();
  const text = await pack(2);
  await f.controller.reviewImport(text);
  assert.equal(await f.controller.applyImport(text), true);
  assert.equal(f.storage.current().entries.length, 2);
  assert.equal(f.controller.state().canImport, false);
  assert.equal(await f.controller.applyImport(text), false);
  assert.equal(f.storage.current().revision, 1);
});

test("an intervening external edit invalidates an import without partial results", async () => {
  const f = controllerFixture();
  await f.controller.refresh();
  const text = await pack(2);
  await f.controller.reviewImport(text);
  f.storage.set(collection(1));
  assert.equal(await f.controller.applyImport(text), false);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_STALE");
  assert.equal(f.storage.current().entries.length, 1);
  assert.equal(f.controller.state().metadata, null);
});

test("explicit cancellation removes the import proposal", async () => {
  const f = controllerFixture();
  await f.controller.refresh();
  const text = await pack(1);
  await f.controller.reviewImport(text);
  f.controller.cancelImport();
  assert.equal(f.controller.state().canImport, false);
  assert.equal(f.controller.state().importDescription, "");
  assert.equal(await f.controller.applyImport(text), false);
});

test("cancellation during checksum calculation suppresses late review publication", async () => {
  const pending = gate();
  const f = controllerFixture({ subtle: { digest: (...args) => pending.promise.then(() => crypto.subtle.digest(...args)) } });
  await f.controller.refresh();
  const promise = f.controller.reviewImport(await pack(1));
  await tick();
  f.controller.cancelImport();
  pending.resolve();
  assert.equal(await promise, false);
  assert.equal(f.controller.state().canImport, false);
  assert.equal(f.storage.current().entries.length, 0);
});

test("refresh discards a previously reviewed import", async () => {
  const f = controllerFixture();
  await f.controller.refresh();
  await f.controller.reviewImport(await pack(1));
  await f.controller.refresh();
  assert.equal(f.controller.state().canImport, false);
});

test("quota failure preserves existing snapshots and clears the proposal", async () => {
  const f = controllerFixture({ storage: memoryStorage(collection(1)) });
  await f.controller.refresh();
  const text = await pack(2);
  await f.controller.reviewImport(text);
  f.storage.onChange(async () => { throw new CheckpointError("CHECKPOINT_QUOTA"); });
  assert.equal(await f.controller.applyImport(text), false);
  assert.equal(f.storage.current().entries.length, 1);
  assert.equal(f.controller.state().canImport, false);
});

test("export collection rereads storage and detects another tab's mutation", async () => {
  const f = controllerFixture({ storage: memoryStorage(collection(1)) });
  await f.controller.refresh();
  f.storage.set(collection(2));
  assert.equal(await f.controller.exportCollection(), false);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.controller.state().errorCode, "CHECKPOINT_STALE");
});

test("export collection preserves archive metadata and never invokes restoration", async () => {
  const input = collection(2);
  input.entries[1].archived = true;
  const f = controllerFixture({ storage: memoryStorage(input) });
  await f.controller.refresh();
  assert.equal(await f.controller.exportCollection(), true);
  assert.equal(f.downloads.length, 1);
  assert.deepEqual((await decodeCheckpointCollection(f.downloads[0].text)).entries, input.entries);
});

test("reader loads one bounded UTF-8 JSON file without trusting MIME", async () => {
  const reader = createCheckpointCollectionReader();
  const text = await pack(1);
  assert.equal(await reader.read(fileObject(text, { type: "text/plain", name: "backup.JSON" })), text);
});

for (const name of ["backup.txt", "../backup.json", "C:\\backup.json", "broken\n.json"]) {
  test("reader rejects invalid filename " + JSON.stringify(name), async () => {
    let reads = 0;
    const reader = createCheckpointCollectionReader({ readBytes: async () => { reads++; } });
    await assert.rejects(reader.read({ name, size: 1 }), matches("CHECKPOINT_TRANSFER_FILE"));
    assert.equal(reads, 0);
  });
}

for (const size of [0, -1, 0.5, NaN, CHECKPOINT_TRANSFER_LIMIT + 1]) {
  test("reader rejects declared file size " + size, async () => {
    const reader = createCheckpointCollectionReader({ readBytes: () => { throw Error("Must not read"); } });
    await assert.rejects(reader.read({ name: "backup.json", size }), matches("CHECKPOINT_TRANSFER_SIZE"));
  });
}

test("reader validates actual byte length against the declared size", async () => {
  const reader = createCheckpointCollectionReader({ readBytes: async () => new Uint8Array(2) });
  await assert.rejects(reader.read({ name: "backup.json", size: 1 }), matches("CHECKPOINT_TRANSFER_SIZE"));
});

test("reader rejects ill-formed UTF-8 rather than replacing damaged characters", async () => {
  const reader = createCheckpointCollectionReader({ readBytes: async () => new Uint8Array([0xff]) });
  await assert.rejects(reader.read({ name: "backup.json", size: 1 }), matches("CHECKPOINT_TRANSFER_ENCODING"));
});

test("reader maps filesystem errors without exposing raw error text", async () => {
  const reader = createCheckpointCollectionReader({ readBytes: async () => { throw Error("private path"); } });
  await assert.rejects(reader.read({ name: "backup.json", size: 1 }), matches("CHECKPOINT_TRANSFER_READ"));
});

for (const action of ["cancel", "dispose"]) {
  test("reader suppresses late bytes after " + action, async () => {
    const pending = gate();
    const reader = createCheckpointCollectionReader({ readBytes: () => pending.promise });
    const loading = reader.read({ name: "backup.json", size: 1 });
    reader[action]();
    pending.resolve(new Uint8Array([32]));
    await assert.rejects(loading, matches("CHECKPOINT_CANCELLED"));
  });
}

test("a newer read supersedes an older read", async () => {
  const pending = gate();
  let calls = 0;
  const reader = createCheckpointCollectionReader({ readBytes: () => ++calls === 1 ? pending.promise : new Uint8Array([50]) });
  const first = reader.read({ name: "one.json", size: 1 });
  assert.equal(await reader.read({ name: "two.json", size: 1 }), "2");
  pending.resolve(new Uint8Array([49]));
  await assert.rejects(first, matches("CHECKPOINT_CANCELLED"));
});

