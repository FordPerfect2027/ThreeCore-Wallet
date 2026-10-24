import test from "node:test";
import assert from "node:assert/strict";
import { ENCRYPTED_ARCHIVE_SCHEMA, ENCRYPTED_ARCHIVE_LIMIT, ENCRYPTED_ARCHIVE_FILENAME,
  decodeEncryptedArchive, prepareEncryptedArchive, describeLibraryMerge } from "../src/encrypted-library-archive.js";
import { emptyEncryptedLibrary, mutateEncryptedLibrary, validateEncryptedLibrary,
  ENCRYPTED_LIBRARY_SCHEMA } from "../src/encrypted-library-model.js";
import { createEncryptedLibraryController } from "../src/encrypted-library-controller.js";
import { envelope, entry, library, clone, memoryStorage, gate, tick, code } from "./helpers/encrypted-library-fixtures.js";

const file = text => new File([text], "synthetic-encrypted-library.json", { type: "application/json" });
const encode = value => JSON.stringify({ schema: ENCRYPTED_ARCHIVE_SCHEMA, entries: value.entries });

test("portable archive has a separate version, name and explicit maximum size", () => {
  assert.equal(ENCRYPTED_ARCHIVE_SCHEMA, "threecore-encrypted-library-archive-v1");
  assert.equal(ENCRYPTED_ARCHIVE_FILENAME, "ThreeCore-encrypted-library.json");
  assert.equal(ENCRYPTED_ARCHIVE_LIMIT, 32 * 1024 * 1024);
});

test("archive roundtrip retains ciphertext and metadata but not database revision", async () => {
  const current = await library([1, 2, 3]);
  const prepared = await prepareEncryptedArchive(current);
  const result = await decodeEncryptedArchive(prepared.text);
  assert.deepEqual(result.entries, current.entries);
  assert.equal(result.revision, 0);
  assert.equal(result.schema, ENCRYPTED_LIBRARY_SCHEMA);
  assert.equal(prepared.filename, ENCRYPTED_ARCHIVE_FILENAME);
  assert.equal(prepared.byteLength, new TextEncoder().encode(prepared.text).length);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.entries));
});

test("an empty archive is valid and cannot imply clearing a destination", async () => {
  const empty = emptyEncryptedLibrary(), before = await library([1]);
  const imported = await decodeEncryptedArchive((await prepareEncryptedArchive(empty)).text);
  const after = mutateEncryptedLibrary(before, before, { kind: "merge", entries: imported.entries });
  assert.deepEqual(after, before);
});

test("export refuses an existing corruption before producing an archive", async () => {
  const value = clone(await library([1]));
  value.entries[0].id = "0".repeat(64);
  await assert.rejects(prepareEncryptedArchive(value), code("LIBRARY_INTEGRITY"));
});

for (const value of [null, undefined, 0, {}, [], "", "{}", "[]", "null", "false", "\ufeff{}",
  '{"schema":"threecore-encrypted-library-archive-v0","entries":[]}',
  '{"schema":"threecore-workspace-v1","cards":[]}',
]) {
  test("archive parser refuses unsupported input " + JSON.stringify(value), async () => {
    await assert.rejects(decodeEncryptedArchive(value), code("LIBRARY_FORMAT"));
  });
}

test("single encrypted workspace file is not confused with an archive", async () => {
  await assert.rejects(decodeEncryptedArchive(envelope()), code("LIBRARY_FORMAT"));
});

test("a duplicate root schema cannot conceal another file type", async () => {
  const text = '{"schema":"other","schema":"' + ENCRYPTED_ARCHIVE_SCHEMA + '","entries":[]}';
  await assert.rejects(decodeEncryptedArchive(text), code("LIBRARY_FORMAT"));
});

test("escaped duplicate member names are also refused", async () => {
  const text = '{"schema":"' + ENCRYPTED_ARCHIVE_SCHEMA + '","entries":[],"entr\\u0069es":[]}';
  await assert.rejects(decodeEncryptedArchive(text), code("LIBRARY_FORMAT"));
});

for (const field of ["password", "passphrase", "privateKey", "wallet", "note", "__proto__", "constructor"]) {
  test("archive root cannot include plaintext extras: " + field, async () => {
    const value = { schema: ENCRYPTED_ARCHIVE_SCHEMA, entries: [] };
    Object.defineProperty(value, field, { value: "untrusted secret", enumerable: true });
    await assert.rejects(decodeEncryptedArchive(JSON.stringify(value)), code("LIBRARY_FORMAT"));
  });
}

test("unbounded nesting is rejected before entry validation", async () => {
  const text = '{"schema":"' + ENCRYPTED_ARCHIVE_SCHEMA + '","entries":' + "[".repeat(100) + "0" + "]".repeat(100) + '}';
  await assert.rejects(decodeEncryptedArchive(text), code("LIBRARY_FORMAT"));
});

for (const replacement of [null, {}, "secret", 1]) {
  test("archive entries must be a bounded dense array " + JSON.stringify(replacement), async () => {
    await assert.rejects(decodeEncryptedArchive(JSON.stringify({ schema: ENCRYPTED_ARCHIVE_SCHEMA,
      entries: replacement })));
  });
}

test("an eleven-entry archive is rejected, including otherwise valid envelopes", async () => {
  const entries = [];
  for (let i = 1; i <= 11; i++) entries.push(await entry(i));
  await assert.rejects(decodeEncryptedArchive(JSON.stringify({ schema: ENCRYPTED_ARCHIVE_SCHEMA, entries })), code("LIBRARY_CAPACITY"));
});

test("duplicate IDs inside an archive are refused instead of hiding one version", async () => {
  const value = await entry();
  await assert.rejects(decodeEncryptedArchive(JSON.stringify({ schema: ENCRYPTED_ARCHIVE_SCHEMA,
    entries: [value, value] })), code("LIBRARY_FORMAT"));
});

test("one corrupted record invalidates the entire imported archive", async () => {
  const value = clone(await library([1, 2, 3]));
  value.entries[2].id = "a".repeat(64);
  await assert.rejects(decodeEncryptedArchive(encode(value)), code("LIBRARY_INTEGRITY"));
});

test("formatted outer JSON is accepted while inner envelopes remain canonical", async () => {
  const value = await library([1]);
  const text = JSON.stringify({ entries: value.entries, schema: ENCRYPTED_ARCHIVE_SCHEMA }, null, 2);
  assert.deepEqual((await decodeEncryptedArchive(text)).entries, value.entries);
  const changed = clone(value);
  changed.entries[0].text = JSON.stringify(JSON.parse(changed.entries[0].text), null, 2);
  changed.entries[0].bytes = changed.entries[0].text.length;
  await assert.rejects(decodeEncryptedArchive(encode(changed)), code("LIBRARY_FORMAT"));
});

test("merge plan separates new records from exact ciphertext duplicates", async () => {
  const before = await library([1, 2]), incoming = await library([2, 3]);
  const plan = describeLibraryMerge(before, incoming);
  assert.deepEqual(plan, { added: 1, duplicates: 1,
    addedBytes: incoming.entries[1].bytes, total: 3, incoming: 2 });
  assert(Object.isFrozen(plan));
  assert(!JSON.stringify(plan).includes("ciphertext"));
});

test("merge appends new records and preserves all original timestamps/order", async () => {
  const before = await library([1, 2]), incoming = clone(await library([2, 3]));
  incoming.entries[0].savedAt++;
  const merged = mutateEncryptedLibrary(before, before, { kind: "merge", entries: incoming.entries });
  assert.deepEqual(merged.entries.slice(0, 2), before.entries);
  assert.deepEqual(merged.entries[2], incoming.entries[1]);
  assert.equal(merged.revision, before.revision + 1);
});

test("merge duplicate-only archive does not advance revision", async () => {
  const before = await library([1, 2]);
  assert.deepEqual(mutateEncryptedLibrary(before, before, { kind: "merge", entries: before.entries }), before);
});

test("merge plan refuses an ID collision with different ciphertext", async () => {
  const before = await library([1]), incoming = clone(await library([2]));
  incoming.entries[0].id = before.entries[0].id;
  assert.throws(() => describeLibraryMerge(before, incoming), code("LIBRARY_INTEGRITY"));
  assert.throws(() => mutateEncryptedLibrary(before, before, { kind: "merge", entries: incoming.entries }), code("LIBRARY_INTEGRITY"));
});

test("merge capacity failure leaves all existing records untouched", async () => {
  const before = await library([1, 2, 3, 4, 5, 6, 7, 8]), incoming = await library([9, 10, 11]);
  const text = JSON.stringify(before);
  assert.throws(() => mutateEncryptedLibrary(before, before, { kind: "merge", entries: incoming.entries }), code("LIBRARY_CAPACITY"));
  assert.equal(JSON.stringify(before), text);
});

test("merge rejects stale destination even if imported records are all duplicates", async () => {
  const before = await library([1]), current = await library([1, 2]);
  assert.throws(() => mutateEncryptedLibrary(current, before, { kind: "merge", entries: before.entries }), code("LIBRARY_CONFLICT"));
});

test("archive decode cancellation stops before the next entry digest", async () => {
  const incoming = await library([1, 2]);
  let allowed = true, calls = 0;
  const pending = gate();
  const decoding = decodeEncryptedArchive(encode(incoming), {
    guard: () => allowed, crypto: { subtle: { digest() { calls++; return pending.promise; } } },
  });
  allowed = false;
  pending.resolve(Uint8Array.from(incoming.entries[0].id.match(/../g), item => parseInt(item, 16)).buffer);
  await assert.rejects(decoding, code("LIBRARY_CANCELLED"));
  assert.equal(calls, 1);
});

function controllerFixture(t, options = {}, initial = emptyEncryptedLibrary()) {
  const storage = options.storage ?? memoryStorage(initial);
  const controller = createEncryptedLibraryController({ storage, ...options });
  t.after(() => controller.dispose());
  return { storage, controller };
}

test("native File import needs explicit review and appends without replacement", async t => {
  const incoming = await library([2, 3]);
  const f = controllerFixture(t, {}, await library([1, 2]));
  assert(await f.controller.prepareImport(file(encode(incoming))));
  const review = f.controller.state().review;
  assert.equal(review.kind, "merge");
  assert.equal(review.merge.added, 1);
  assert.equal(review.merge.duplicates, 1);
  assert.equal(f.storage.calls.writes, 0);
  assert(await f.controller.confirm(review.ticket, true));
  assert.equal(f.storage.snapshot().entries.length, 3);
  assert.equal(f.controller.state().result, "merged");
  assert.equal(f.controller.state().selected, null);
});

test("import supplies a bounded size and abort signal to the reader", async t => {
  let received;
  const value = await library([1]);
  const f = controllerFixture(t, { readText: async (file, options) => {
    received = options;
    return encode(value);
  } });
  await f.controller.prepareImport({});
  assert.equal(received.maxBytes, ENCRYPTED_ARCHIVE_LIMIT);
  assert(received.signal instanceof AbortSignal);
});

test("unsupported file bytes cannot reach storage reads or writes", async t => {
  const f = controllerFixture(t);
  assert.equal(await f.controller.prepareImport(file("plaintext with private addresses")), false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_FORMAT");
  assert.equal(f.storage.calls.reads, 0);
  assert.equal(f.storage.calls.writes, 0);
});

test("oversized declared file is refused before its reader is invoked", async t => {
  let calls = 0;
  const f = controllerFixture(t);
  const file = { size: ENCRYPTED_ARCHIVE_LIMIT + 1, arrayBuffer() { calls++; return Promise.resolve(new ArrayBuffer(0)); } };
  assert.equal(await f.controller.prepareImport(file), false);
  assert.equal(calls, 0);
  assert.equal(f.storage.calls.writes, 0);
});

test("invalid UTF-8 input cannot be repaired silently into an accepted document", async t => {
  const f = controllerFixture(t);
  const bytes = new Uint8Array([0xc0, 0x80, 0x7b, 0x7d]);
  assert.equal(await f.controller.prepareImport(new File([bytes], "bad.json")), false);
  assert.equal(f.storage.calls.writes, 0);
});

test("archive with too many additions fails before confirmation", async t => {
  const before = await library([1,2,3,4,5,6,7,8,9,10]);
  const f = controllerFixture(t, {}, before);
  assert.equal(await f.controller.prepareImport(file(encode(await library([11])))), false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_CAPACITY");
  assert.deepEqual(f.storage.snapshot(), before);
  assert.equal(f.controller.state().review, null);
});

test("competing destination write invalidates the complete import transaction", async t => {
  const f = controllerFixture(t, {}, await library([1]));
  await f.controller.prepareImport(file(encode(await library([2,3]))));
  const ticket = f.controller.state().review.ticket;
  const changed = await library([1,4]);
  f.storage.replace(changed);
  assert.equal(await f.controller.confirm(ticket, true), false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_CONFLICT");
  assert.deepEqual(f.storage.snapshot(), changed);
});

test("cancelled reader cannot introduce a later import preview", async t => {
  const pending = gate();
  const f = controllerFixture(t, { readText: () => pending.promise });
  const reading = f.controller.prepareImport({});
  f.controller.cancel();
  pending.resolve(encode(await library([1])));
  assert.equal(await reading, false);
  assert.equal(f.controller.state().review, null);
  assert.equal(f.storage.calls.reads, 0);
});

test("hung archive reader has a deadline and cannot claim a completed import", async t => {
  const pending = gate();
  const f = controllerFixture(t, { deadlineMs: 10, readText: () => pending.promise });
  assert.equal(await f.controller.prepareImport({}), false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_TIMEOUT");
  pending.reject(Error("late private reader error"));
  await tick();
  assert.equal(f.storage.calls.writes, 0);
});

test("full archive preparation includes every saved entry and waits for an export action", async t => {
  const initial = await library([1, 2, 3]), f = controllerFixture(t, {}, initial);
  const downloads = [];
  assert.equal(await f.controller.prepareArchive(), true);
  assert.equal(f.controller.state().result, "archive-ready");
  assert.equal(downloads.length, 0);
  assert(f.controller.offer(value => downloads.push(value)));
  assert.equal(downloads[0].filename, ENCRYPTED_ARCHIVE_FILENAME);
  assert.deepEqual((await decodeEncryptedArchive(downloads[0].text)).entries, initial.entries);
  assert.equal(f.storage.calls.writes, 0);
});

test("exporting the empty library is safe and produces a portable empty set", async t => {
  const f = controllerFixture(t), downloads = [];
  assert(await f.controller.prepareArchive());
  f.controller.offer(value => downloads.push(value));
  assert.deepEqual((await decodeEncryptedArchive(downloads[0].text)).entries, []);
});

test("cancel prevents downloading an already prepared whole-library archive", async t => {
  const f = controllerFixture(t, {}, await library([1])), downloads = [];
  await f.controller.prepareArchive();
  f.controller.cancel();
  assert.equal(f.controller.offer(value => downloads.push(value)), false);
  assert.equal(downloads.length, 0);
});

test("corrupt archive export never silently omits the bad record", async t => {
  const initial = clone(await library([1, 2]));
  initial.entries[1].id = "0".repeat(64);
  const f = controllerFixture(t, {}, initial);
  assert.equal(await f.controller.prepareArchive(), false);
  assert.equal(f.controller.state().canExport, false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_INTEGRITY");
  assert.deepEqual(f.storage.snapshot(), initial);
});

test("archive result state excludes plaintext, payloads and per-record filenames", async t => {
  const f = controllerFixture(t, {}, await library([1,2]));
  await f.controller.prepareArchive();
  const state = JSON.stringify(f.controller.state());
  for (const forbidden of ["ciphertext", "AES-GCM", "PBKDF2", "filename", "passphrase"]) {
    assert(!state.includes(forbidden));
  }
});
