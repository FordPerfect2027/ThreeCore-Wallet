import test from "node:test";
import assert from "node:assert/strict";
import { validateEncryptedLibrary, validateLibraryEntry, sameEncryptedLibrary,
  emptyEncryptedLibrary, mutateEncryptedLibrary } from "../src/encrypted-library-model.js";
import { library, entry, clone, code } from "./helpers/encrypted-library-fixtures.js";

test("mutable input is not marked trusted by a prior successful validation", async () => {
  const input = clone(await library([1]));
  const snapshot = validateEncryptedLibrary(input);
  input.entries[0].text = "private unencrypted data";
  input.entries[0].bytes = input.entries[0].text.length;
  assert.throws(() => validateEncryptedLibrary(input), code("LIBRARY_FORMAT"));
  assert.notEqual(snapshot.entries[0].text, input.entries[0].text);
});

test("freezing a forged object does not make it trusted", async () => {
  const input = clone(await library([1]));
  input.entries[0].text = '{"privateKey":"never-accepted"}';
  input.entries[0].bytes = input.entries[0].text.length;
  Object.freeze(input.entries[0]);
  Object.freeze(input.entries);
  Object.freeze(input);
  assert.throws(() => validateEncryptedLibrary(input), code("LIBRARY_FORMAT"));
});

test("validated internal snapshots can be reused without reparsing or copying ciphertext", async () => {
  const original = await library([1, 2]);
  assert.equal(validateEncryptedLibrary(original), original);
  assert.equal(validateLibraryEntry(original.entries[0]), original.entries[0]);
  assert.equal(sameEncryptedLibrary(original, clone(original)), true);
});

test("structured-clone-shaped values must be independently validated again", async () => {
  const original = await library([1]);
  const fromDatabase = structuredClone(original);
  const snapshot = validateEncryptedLibrary(fromDatabase);
  assert.notEqual(snapshot, fromDatabase);
  assert.notEqual(snapshot.entries[0], fromDatabase.entries[0]);
  fromDatabase.entries[0].savedAt++;
  assert.notEqual(snapshot.entries[0].savedAt, fromDatabase.entries[0].savedAt);
});

test("all nested cached values are actually immutable", async () => {
  const snapshot = await library([1]);
  assert.throws(() => { snapshot.revision++; }, TypeError);
  assert.throws(() => { snapshot.entries.push(snapshot.entries[0]); }, TypeError);
  assert.throws(() => { snapshot.entries[0].savedAt++; }, TypeError);
  assert.throws(() => { snapshot.entries[0].text = "changed"; }, TypeError);
});

test("caller array references cannot mutate an already prepared atomic merge", async () => {
  const original = await library([1]), incoming = clone((await library([2, 3])).entries);
  const snapshot = mutateEncryptedLibrary(original, original, { kind: "merge", entries: incoming });
  incoming[0].savedAt++;
  incoming.pop();
  assert.equal(snapshot.entries.length, 3);
  assert.notEqual(snapshot.entries[1].savedAt, incoming[0].savedAt);
});

test("seeded operation history preserves every accepted record and all rejected-operation snapshots", async () => {
  // Independent reference map checks conservation and order across mixed actions.
  const candidates = [];
  for (let i = 1; i <= 12; i++) candidates.push(await entry(i));
  let current = emptyEncryptedLibrary();
  const expected = new Map();
  let seed = 0x1a2b3c4d;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  let accepted = 0, rejected = 0;
  for (let step = 0; step < 160; step++) {
    const candidate = candidates[next() % candidates.length];
    const remove = next() % 5 === 0;
    const before = current;
    if (remove && !expected.has(candidate.id)) {
      assert.throws(() => mutateEncryptedLibrary(current, current, { kind: "remove", id: candidate.id }), code("LIBRARY_SELECTION"));
      rejected++;
    } else if (!remove && expected.size === 10 && !expected.has(candidate.id)) {
      assert.throws(() => mutateEncryptedLibrary(current, current, { kind: "add", entry: candidate }), code("LIBRARY_CAPACITY"));
      rejected++;
    } else {
      const oldSize = expected.size;
      if (remove) expected.delete(candidate.id);
      else expected.set(candidate.id, expected.get(candidate.id) ?? candidate);
      current = mutateEncryptedLibrary(current, current, remove
        ? { kind: "remove", id: candidate.id } : { kind: "add", entry: candidate });
      assert.equal(current.revision, before.revision + (expected.size !== oldSize ? 1 : 0));
      accepted++;
    }
    assert.deepEqual(current.entries, [...expected.values()]);
    assert.equal(new Set(current.entries.map(entry => entry.id)).size, current.entries.length);
  }
  assert(accepted > 0 && rejected > 0);
});

test("stale operations remain stale across multiple later changes including removals", async () => {
  let current = await library([1]), stale = current;
  const second = await entry(2), third = await entry(3);
  current = mutateEncryptedLibrary(current, current, { kind: "add", entry: second });
  current = mutateEncryptedLibrary(current, current, { kind: "remove", id: second.id });
  // Same entry set as the stale snapshot, but the review predates committed changes.
  assert.deepEqual(current.entries, stale.entries);
  assert.throws(() => mutateEncryptedLibrary(current, stale, { kind: "add", entry: third }), code("LIBRARY_CONFLICT"));
  assert.throws(() => mutateEncryptedLibrary(current, stale, { kind: "merge", entries: [third] }), code("LIBRARY_CONFLICT"));
});

test("a batch validates all entries before returning any mutation", async () => {
  const current = await library([1]), valid = await entry(2), invalid = clone(await entry(3));
  invalid.bytes--;
  const text = JSON.stringify(current);
  assert.throws(() => mutateEncryptedLibrary(current, current,
    { kind: "merge", entries: [valid, invalid] }), code("LIBRARY_FORMAT"));
  assert.equal(JSON.stringify(current), text);
});

test("empty destination comparison distinguishes missing content from a later cleared state", async () => {
  const empty = emptyEncryptedLibrary(), record = await entry();
  const filled = mutateEncryptedLibrary(empty, empty, { kind: "add", entry: record });
  const cleared = mutateEncryptedLibrary(filled, filled, { kind: "remove", id: record.id });
  assert.equal(cleared.entries.length, 0);
  assert.equal(sameEncryptedLibrary(empty, cleared), false);
});
