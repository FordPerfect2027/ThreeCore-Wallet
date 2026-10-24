import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ENCRYPTED_LIBRARY_SCHEMA, ENCRYPTED_LIBRARY_CODES, ENCRYPTED_LIBRARY_COUNT,
  ENCRYPTED_LIBRARY_BYTES, EncryptedLibraryError, libraryId, libraryErrorCode,
  canonicalLibraryText, validateLibraryEntry, emptyEncryptedLibrary,
  validateEncryptedLibrary, sameEncryptedLibrary, mutateEncryptedLibrary,
  encryptedLibrarySummary, encryptedTextDigest, prepareLibraryEntry,
  verifyLibraryEntry, verifyEncryptedLibrary,
} from "../src/encrypted-library-model.js";
import { envelope, entry, library, clone, code, gate } from "./helpers/encrypted-library-fixtures.js";

test("library starts with an immutable versioned empty document", () => {
  const value = emptyEncryptedLibrary();
  assert.deepEqual(value, { schema: ENCRYPTED_LIBRARY_SCHEMA, revision: 0, entries: [] });
  assert(Object.isFrozen(value));
  assert(Object.isFrozen(value.entries));
  assert.deepEqual(validateEncryptedLibrary(value), value);
});

test("library limits bound retained ciphertext and number of records", () => {
  assert.equal(ENCRYPTED_LIBRARY_COUNT, 10);
  assert.equal(ENCRYPTED_LIBRARY_BYTES, 24 * 1024 * 1024);
});

test("canonical ciphertext strips formatting without changing the envelope", () => {
  const text = envelope();
  const parsed = JSON.parse(text);
  const reordered = { ciphertext: parsed.ciphertext, cipher: parsed.cipher,
    kdf: parsed.kdf, schema: parsed.schema };
  assert.equal(canonicalLibraryText(JSON.stringify(reordered, null, 2)), text);
});

for (const value of [null, undefined, 1, {}, [], "", "{}", "[]", '{"passphrase":"secret"}',
  '{"schema":"threecore-workspace-v1","accounts":[]}', '{"schema":"threecore-encrypted-workspace-v1"}']) {
  test("plaintext or non-envelope input is refused: " + JSON.stringify(value), () => {
    assert.throws(() => canonicalLibraryText(value), code("LIBRARY_FORMAT"));
  });
}

for (const field of ["passphrase", "privateKey", "address", "balance", "label", "__proto__"]) {
  test("envelope cannot carry an extra plaintext field: " + field, () => {
    const value = JSON.parse(envelope());
    Object.defineProperty(value, field, { value: "sensitive", enumerable: true });
    assert.throws(() => canonicalLibraryText(JSON.stringify(value)), code("LIBRARY_FORMAT"));
  });
}

test("duplicate envelope keys are refused before canonicalization", () => {
  const text = envelope().replace('{"schema":', '{"schema":"ignored","schema":');
  assert.throws(() => canonicalLibraryText(text), code("LIBRARY_FORMAT"));
});

for (const value of [null, 1, "", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), "0x" + "a".repeat(64)]) {
  test("content ID requires exact lowercase SHA-256 text: " + String(value).slice(0, 12), () => {
    assert.throws(() => libraryId(value), code("LIBRARY_SELECTION"));
  });
}

test("native digest matches an independent Node hash of canonical ciphertext", async () => {
  const text = envelope(7);
  const result = await encryptedTextDigest(text);
  assert.equal(result, createHash("sha256").update(text).digest("hex"));
  assert.equal(await encryptedTextDigest(JSON.stringify(JSON.parse(text), null, 2)), result);
});

test("different salts and ciphertext produce different library identities", async () => {
  assert.notEqual(await encryptedTextDigest(envelope(1)), await encryptedTextDigest(envelope(2)));
});

test("digest input buffer is wiped when native work finishes", async () => {
  let captured;
  const crypto = { subtle: { async digest(algorithm, bytes) {
    assert.equal(algorithm, "SHA-256");
    assert(bytes.some(byte => byte !== 0));
    captured = bytes;
    return new Uint8Array(32).fill(5).buffer;
  } } };
  assert.equal(await encryptedTextDigest(envelope(), { crypto }), "05".repeat(32));
  assert(captured.every(byte => byte === 0));
});

test("digest input buffer is wiped after a rejected native operation", async () => {
  let captured;
  await assert.rejects(encryptedTextDigest(envelope(), { crypto: { subtle: {
    digest(algorithm, bytes) { captured = bytes; return Promise.reject(Error("sensitive")); },
  } } }), code("LIBRARY_CRYPTO"));
  assert(captured.every(byte => byte === 0));
});

for (const crypto of [null, {}, { subtle: {} }, { subtle: { digest: 1 } },
  { subtle: { digest: async () => "fake" } }, { subtle: { digest: async () => new ArrayBuffer(31) } }]) {
  test("unavailable or malformed crypto fails closed " + JSON.stringify(crypto), async () => {
    await assert.rejects(encryptedTextDigest(envelope(), { crypto }), code("LIBRARY_CRYPTO"));
  });
}

test("entry contains exactly the ciphertext and bounded management metadata", async () => {
  const value = await entry();
  assert.deepEqual(Object.keys(value).sort(), ["bytes", "id", "savedAt", "text"]);
  assert.equal(value.bytes, value.text.length);
  assert(Object.isFrozen(value));
  assert.deepEqual(await verifyLibraryEntry(value), value);
});

for (const field of ["id", "savedAt", "bytes", "text"]) {
  test("entry refuses missing field " + field, async () => {
    const value = clone(await entry());
    delete value[field];
    assert.throws(() => validateLibraryEntry(value));
  });
  test("entry refuses accessors without invoking " + field, async () => {
    const value = clone(await entry());
    let invoked = false;
    Object.defineProperty(value, field, { get() { invoked = true; throw Error("secret"); } });
    assert.throws(() => validateLibraryEntry(value), code("LIBRARY_FORMAT"));
    assert.equal(invoked, false);
  });
}

for (const value of [-1, 0, NaN, Infinity, 1.5, "1", Number.MAX_SAFE_INTEGER]) {
  test("entry rejects invalid save timestamp " + value, async () => {
    const input = { ...await entry(), savedAt: value };
    assert.throws(() => validateLibraryEntry(input), code("LIBRARY_FORMAT"));
  });
}

test("declared envelope bytes cannot conceal truncation or padding", async () => {
  const value = await entry();
  assert.throws(() => validateLibraryEntry({ ...value, bytes: value.bytes - 1 }), code("LIBRARY_FORMAT"));
  assert.throws(() => validateLibraryEntry({ ...value, bytes: value.bytes + 1 }), code("LIBRARY_FORMAT"));
  assert.throws(() => validateLibraryEntry({ ...value, text: value.text + " " }), code("LIBRARY_FORMAT"));
});

test("additional metadata, including a passphrase, is refused rather than persisted", async () => {
  const value = await entry();
  assert.throws(() => validateLibraryEntry({ ...value, password: "never-store" }), code("LIBRARY_FORMAT"));
});

test("entry verification rejects ciphertext modified with an unchanged ID", async () => {
  const a = await entry(1), b = await entry(2);
  await assert.rejects(verifyLibraryEntry({ ...b, id: a.id }), code("LIBRARY_INTEGRITY"));
});

for (const revision of [-1, "0", NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  test("document rejects invalid revision " + revision, () => {
    assert.throws(() => validateEncryptedLibrary({ ...emptyEncryptedLibrary(), revision }), code("LIBRARY_FORMAT"));
  });
}

for (const field of ["schema", "revision", "entries"]) {
  test("document rejects accessor " + field + " without invocation", () => {
    const value = clone(emptyEncryptedLibrary());
    let reads = 0;
    Object.defineProperty(value, field, { get() { reads++; return null; } });
    assert.throws(() => validateEncryptedLibrary(value), code("LIBRARY_FORMAT"));
    assert.equal(reads, 0);
  });
}

test("sparse arrays and extra array properties are not accepted as records", async () => {
  const value = clone(await library());
  delete value.entries[0];
  assert.throws(() => validateEncryptedLibrary(value));
  value.entries[0] = await entry();
  value.entries.note = "do not save";
  assert.throws(() => validateEncryptedLibrary(value), code("LIBRARY_CAPACITY"));
});

test("record index accessor is rejected without reading it", () => {
  const entries = [];
  let calls = 0;
  Object.defineProperty(entries, "0", { get() { calls++; return {}; }, enumerable: true });
  assert.throws(() => validateEncryptedLibrary({ ...emptyEncryptedLibrary(), entries }), code("LIBRARY_FORMAT"));
  assert.equal(calls, 0);
});

test("duplicates in an existing document are corruption", async () => {
  const value = await entry();
  assert.throws(() => validateEncryptedLibrary({ ...emptyEncryptedLibrary(), entries: [value, value] }), code("LIBRARY_FORMAT"));
});

test("ten records fit and the eleventh cannot evict previous data", async () => {
  const value = await library([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(value.entries.length, 10);
  const before = JSON.stringify(value);
  const extra = await entry(11);
  assert.throws(() => mutateEncryptedLibrary(value, value, { kind: "add", entry: extra }), code("LIBRARY_CAPACITY"));
  assert.equal(JSON.stringify(value), before);
});

test("add and remove are immutable, ordered and revisioned", async () => {
  const original = emptyEncryptedLibrary(), first = await entry(1), second = await entry(2);
  const a = mutateEncryptedLibrary(original, original, { kind: "add", entry: first });
  const b = mutateEncryptedLibrary(a, a, { kind: "add", entry: second });
  const c = mutateEncryptedLibrary(b, b, { kind: "remove", id: first.id });
  assert.equal(original.entries.length, 0);
  assert.deepEqual(b.entries.map(value => value.id), [first.id, second.id]);
  assert.deepEqual(c.entries.map(value => value.id), [second.id]);
  assert.equal(c.revision, 3);
});

test("duplicate save does not alter revision, timestamp or order", async () => {
  const value = await library([1, 2]);
  const duplicate = { ...value.entries[0], savedAt: 1792900000000 };
  assert.deepEqual(mutateEncryptedLibrary(value, value, { kind: "add", entry: duplicate }), value);
});

test("a colliding ID with different ciphertext fails instead of overwriting", async () => {
  const value = await library([1]);
  const collision = { ...await entry(2), id: value.entries[0].id };
  assert.throws(() => mutateEncryptedLibrary(value, value, { kind: "add", entry: collision }), code("LIBRARY_INTEGRITY"));
});

test("stale revision cannot remove a newly stored record", async () => {
  const before = await library([1]), after = await library([1, 2]);
  assert.throws(() => mutateEncryptedLibrary(after, before, { kind: "remove", id: before.entries[0].id }), code("LIBRARY_CONFLICT"));
});

for (const mutate of [
  value => { value.revision++; },
  value => { value.entries.reverse(); },
  value => { value.entries[0].savedAt++; },
  value => { value.entries.pop(); },
]) {
  test("exact snapshot comparison detects a changed inventory: " + mutate.toString(), async () => {
    const original = await library([1, 2]), changed = clone(original);
    mutate(changed);
    assert.equal(sameEncryptedLibrary(original, changed), false);
    assert.throws(() => mutateEncryptedLibrary(changed, original,
      { kind: "remove", id: original.entries[0].id }), code("LIBRARY_CONFLICT"));
  });
}

test("same revision and ID with changed ciphertext is still stale", async () => {
  const original = await library([1]), replacement = await entry(2);
  const changed = clone(original);
  changed.entries[0] = { ...replacement, id: original.entries[0].id };
  assert.equal(sameEncryptedLibrary(original, changed), false);
});

test("revision overflow refuses modification", async () => {
  const value = { ...await library([1]), revision: Number.MAX_SAFE_INTEGER };
  assert.throws(() => mutateEncryptedLibrary(value, value,
    { kind: "remove", id: value.entries[0].id }), code("LIBRARY_CAPACITY"));
});

for (const operation of [{ kind: "clear" }, { kind: "rename", id: "a".repeat(64) },
  { kind: "remove", id: "a".repeat(64), all: true }, null, {}, []]) {
  test("only exact add/remove operations exist " + JSON.stringify(operation), () => {
    const value = emptyEncryptedLibrary();
    assert.throws(() => mutateEncryptedLibrary(value, value, operation));
  });
}

test("operation kind accessor never executes", () => {
  let calls = 0;
  const operation = { id: "a".repeat(64), get kind() { calls++; return "remove"; } };
  const value = emptyEncryptedLibrary();
  assert.throws(() => mutateEncryptedLibrary(value, value, operation), code("LIBRARY_FORMAT"));
  assert.equal(calls, 0);
});

test("summary excludes ciphertext and uses immutable metadata", async () => {
  const value = await library([1, 2]);
  const summary = encryptedLibrarySummary(value);
  assert.equal(summary.count, 2);
  assert.equal(summary.bytes, value.entries.reduce((sum, entry) => sum + entry.bytes, 0));
  assert(!JSON.stringify(summary).includes("ciphertext"));
  assert(Object.isFrozen(summary.entries[0]));
});

test("verify all records rejects one corrupted entry before accepting the inventory", async () => {
  const value = clone(await library([1, 2, 3]));
  value.entries[1].id = "f".repeat(64);
  await assert.rejects(verifyEncryptedLibrary(value), code("LIBRARY_INTEGRITY"));
});

test("verification honors cancellation both before and after a digest", async () => {
  const value = await library([1, 2]);
  await assert.rejects(verifyEncryptedLibrary(value, { guard: () => false }), code("LIBRARY_CANCELLED"));
  const deferred = gate();
  let allowed = true, calls = 0;
  const checking = verifyEncryptedLibrary(value, { guard: () => allowed,
    crypto: { subtle: { digest() { calls++; return deferred.promise; } } } });
  allowed = false;
  deferred.resolve(Uint8Array.from(value.entries[0].id.match(/../g), item => parseInt(item, 16)).buffer);
  await assert.rejects(checking, code("LIBRARY_CANCELLED"));
  assert.equal(calls, 1);
});

test("safe errors never copy supplied messages or codes", () => {
  assert.equal(new EncryptedLibraryError("secret").message, "LIBRARY_INTERNAL");
  assert.equal(libraryErrorCode(Error("seed phrase")), "LIBRARY_INTERNAL");
  for (const value of ENCRYPTED_LIBRARY_CODES) assert.equal(libraryErrorCode(new EncryptedLibraryError(value)), value);
});
