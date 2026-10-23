import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  preparePeriodLibraryFile, decodePeriodLibraryFile, readPeriodLibraryFile,
  reviewPeriodLibraryImport, PERIOD_LIBRARY_FILE_LIMIT,
} from "../src/period-library-file.js";
import { library, entry, sampleLibrary, clone, code, fileFrom, checkpoint } from "./helpers/period-library-fixtures.js";

test("portable backup retains archived and blocked records with an explicit checksum limitation", async () => {
  const original = sampleLibrary();
  const prepared = await preparePeriodLibraryFile(original);
  assert.equal(prepared.authenticated, false);
  assert.equal(prepared.encrypted, false);
  assert.equal(prepared.mimeType, "application/json;charset=utf-8");
  assert.equal(prepared.byteLength, new TextEncoder().encode(prepared.text).byteLength);
  assert.ok(prepared.text.endsWith("\n"));
  const decoded = await decodePeriodLibraryFile(prepared.text);
  assert.equal(decoded.document.revision, 0);
  assert.equal(original.revision, 4);
  assert.deepEqual(decoded.document.entries, original.entries);
  assert.equal(decoded.checksumVerified, true);
  assert.equal(decoded.authenticated, false);
});

test("empty libraries have valid portable backups", async () => {
  const result = await decodePeriodLibraryFile((await preparePeriodLibraryFile(library())).text);
  assert.deepEqual(result.document.entries, []);
});

test("canonical digest is insensitive to JSON object field order and whitespace", async () => {
  const result = await preparePeriodLibraryFile(sampleLibrary());
  const envelope = JSON.parse(result.text);
  const reversed = {
    document: {
      entries: envelope.document.entries.map(row => ({
        draft: row.draft, requiresNewPlan: row.requiresNewPlan, archived: row.archived,
        updatedAt: row.updatedAt, createdAt: row.createdAt, label: row.label, id: row.id,
      })),
      revision: 0,
      schema: envelope.document.schema,
    },
    digest: envelope.digest,
    algorithm: envelope.algorithm,
    schema: envelope.schema,
  };
  const decoded = await decodePeriodLibraryFile(JSON.stringify(reversed, null, 2));
  assert.equal(decoded.digest, result.digest);
  assert.deepEqual(decoded.document.entries, sampleLibrary().entries);
});

test("backup round trip uses precise integer strings without floating point conversion", async () => {
  const source = clone(entry());
  source.draft.earlier.balanceBaseUnits = "90071992547409931234567890";
  const result = await decodePeriodLibraryFile((await preparePeriodLibraryFile(library([source]))).text);
  assert.equal(result.document.entries[0].draft.earlier.balanceBaseUnits, "90071992547409931234567890");
});

for (const field of ["label", "archived", "requiresNewPlan"]) {
  test("unrecomputed checksum detects a changed " + field, async () => {
    const value = JSON.parse((await preparePeriodLibraryFile(sampleLibrary())).text);
    value.document.entries[0][field] = field === "label" ? "Edited" : true;
    await assert.rejects(decodePeriodLibraryFile(JSON.stringify(value)), code("PERIOD_CHECKSUM"));
  });
}

test("a recomputed checksum does not claim to authenticate record authorship", async () => {
  const altered = clone(sampleLibrary());
  altered.entries[0].label = "Someone else can generate this";
  const result = await decodePeriodLibraryFile((await preparePeriodLibraryFile(altered)).text);
  assert.equal(result.checksumVerified, true);
  assert.equal(result.authenticated, false);
});

for (const [field, value] of [
  ["schema", "threecore.period-file.v1"], ["algorithm", "MD5"],
  ["digest", "f".repeat(63)], ["digest", "F".repeat(64)], ["digest", null],
]) {
  test("incompatible backup header fails: " + field + "/" + value, async () => {
    const envelope = JSON.parse((await preparePeriodLibraryFile(library())).text);
    envelope[field] = value;
    await assert.rejects(decodePeriodLibraryFile(JSON.stringify(envelope)), code("PERIOD_LIBRARY_FILE_SCHEMA"));
  });
}

test("storage revision cannot masquerade as a portable revision", async () => {
  const envelope = JSON.parse((await preparePeriodLibraryFile(library())).text);
  envelope.document.revision = 8;
  await assert.rejects(decodePeriodLibraryFile(JSON.stringify(envelope)), code("PERIOD_LIBRARY_FILE_SCHEMA"));
});

test("unexpected envelope fields fail before digest evaluation", async () => {
  const value = JSON.parse((await preparePeriodLibraryFile(library())).text);
  value.authorizedByWallet = true;
  let calls = 0;
  await assert.rejects(decodePeriodLibraryFile(JSON.stringify(value), { subtle: {
    digest() { calls++; throw Error("Should not be used"); },
  } }), code("PERIOD_SHAPE"));
  assert.equal(calls, 0);
});

for (const subtle of [null, {}, { digest: async () => "wrong" }, { digest: async () => new ArrayBuffer(31) },
  { digest: async () => { throw Error("private platform details"); } }]) {
  test("unavailable or malformed digest implementation fails closed", async () => {
    await assert.rejects(preparePeriodLibraryFile(library(), { subtle }), code("PERIOD_CRYPTO"));
  });
}

test("WebCrypto receives exactly canonical document bytes with SHA-256", async () => {
  const calls = [];
  const subtle = { async digest(algorithm, data) {
    calls.push([algorithm, new TextDecoder().decode(data)]);
    return webcrypto.subtle.digest(algorithm, data);
  } };
  const original = library([entry()], 23);
  const result = await preparePeriodLibraryFile(original, { subtle });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "SHA-256");
  assert.equal(JSON.parse(calls[0][1]).revision, 0);
  assert.equal(JSON.parse(calls[0][1]).entries.length, 1);
  assert.match(result.digest, /^[0-9a-f]{64}$/);
});

for (const name of ["../library.json", "folder/library.json", "folder\\library.json", "data.txt", ".json\n", "x".repeat(181) + ".json"]) {
  test("unsafe file name rejected before reading bytes: " + JSON.stringify(name), async () => {
    let reads = 0;
    const file = { name, size: 10, arrayBuffer() { reads++; throw Error("Should not read"); } };
    await assert.rejects(readPeriodLibraryFile(file), code("PERIOD_FILENAME"));
    assert.equal(reads, 0);
  });
}

test("file input accepts uppercase JSON extension and Japanese file names", async () => {
  const prepared = await preparePeriodLibraryFile(sampleLibrary());
  const decoded = await readPeriodLibraryFile(fileFrom(prepared.text, "期間の控え.JSON"));
  assert.equal(decoded.document.entries.length, 4);
});

for (const size of [0, -1, 1.5, "12", NaN, PERIOD_LIBRARY_FILE_LIMIT + 1]) {
  test("file size gate rejects " + size + " before allocation", async () => {
    let reads = 0;
    await assert.rejects(readPeriodLibraryFile({
      name: "data.json", size, arrayBuffer() { reads++; return new ArrayBuffer(0); },
    }), code("PERIOD_LIBRARY_FILE_SIZE"));
    assert.equal(reads, 0);
  });
}

test("changed byte count is not decoded or silently truncated", async () => {
  await assert.rejects(readPeriodLibraryFile({
    name: "data.json", size: 2, arrayBuffer: async () => new ArrayBuffer(1),
  }), code("PERIOD_LIBRARY_FILE_SIZE"));
});

test("invalid UTF-8 is rejected before parsing", async () => {
  await assert.rejects(readPeriodLibraryFile({
    name: "data.json", size: 2, arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer,
  }), code("PERIOD_FILE_ENCODING"));
});

test("file access errors do not expose raw platform text", async () => {
  const failure = await readPeriodLibraryFile({
    name: "data.json", size: 1, arrayBuffer: async () => { throw Error("private path"); },
  }).catch(value => value);
  assert.equal(failure.code, "PERIOD_FILE_READ");
  assert.ok(!String(failure.message).includes("private path"));
});

for (const text of ["", " ", "not-json", "null", "[]", "{}"]) {
  test("empty or malformed envelope cannot become an empty library: " + JSON.stringify(text), async () => {
    await assert.rejects(decodePeriodLibraryFile(text));
  });
}

test("import preview separates duplicates, additions, archive and quarantine counts", () => {
  const incoming = sampleLibrary();
  const before = library([incoming.entries[0]], 8);
  const result = reviewPeriodLibraryImport(before, incoming);
  assert.equal(result.expectedRevision, 8);
  assert.equal(result.additions, 3);
  assert.equal(result.duplicates, 1);
  assert.equal(result.archivedAdditions, 1);
  assert.equal(result.blockedAdditions, 1);
  assert.equal(result.after.count, 4);
  assert.equal(before.entries.length, 1);
});

test("import preview rejects conflict instead of presenting a destructive overwrite option", () => {
  const before = library([entry()]);
  const incoming = library([entry(1, { draft: checkpoint(5) })]);
  assert.throws(() => reviewPeriodLibraryImport(before, incoming), code("PERIOD_LIBRARY_IMPORT_CONFLICT"));
});

test("import preview rejects aggregate capacity overflow atomically", () => {
  const before = library(Array.from({ length: 10 }, (_, i) => entry(i + 1)));
  const incoming = library([entry(11), entry(12), entry(13)]);
  assert.throws(() => reviewPeriodLibraryImport(before, incoming), code("PERIOD_LIBRARY_CAPACITY"));
  assert.equal(before.entries.length, 10);
});
