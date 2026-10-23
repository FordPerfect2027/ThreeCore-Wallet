import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  prepareReconciliationFile, decodeReconciliationFile, readReconciliationFile, readReconciliationInput,
  RECONCILIATION_FILE_SCHEMA, RECONCILIATION_FILE_LIMIT,
} from "../src/reconciliation-file.js";
import { emptyReconciliationWorkspace, reconciliationKey } from "../src/reconciliation-model.js";
import { prepareTokenIdentityFile } from "../src/token-identity-report.js";
import { prepareTransferArchive } from "../src/transfer-archive-file.js";
import { prepareTransferDownload } from "../src/transfer-file.js";
import { prepareVaultFile } from "../src/transfer-vault-file.js";
import { vaultBundle } from "../src/transfer-vault-model.js";
import { workspace, scenario, previewWorkspace, fileFrom, clone, bytes, deferred, errorCode } from "./helpers/reconciliation-fixtures.js";

test("checksummed workspace roundtrip keeps all original evidence, no conclusions", async () => {
  const before = previewWorkspace();
  const encoded = await prepareReconciliationFile(before);
  const envelope = JSON.parse(encoded.text);
  assert.equal(envelope.schema, RECONCILIATION_FILE_SCHEMA);
  assert.deepEqual(Object.keys(envelope), ["schema", "algorithm", "digest", "workspace"]);
  assert.match(encoded.digest, /^[a-f0-9]{64}$/);
  assert.equal(encoded.filename, "ThreeCore-balance-reconciliation.json");
  assert.equal(encoded.byteLength, bytes(encoded.text).length);
  const restored = await readReconciliationFile(fileFrom(encoded.text));
  assert.deepEqual(restored.workspace, before);
  assert.equal(restored.authenticated, false);
  assert.equal(restored.checksumVerified, true);
  assert.ok(Object.isFrozen(restored.workspace.slots[0].archive.records[0].events));
});

test("empty and partial workspaces can be saved and restored", async () => {
  for (const value of [emptyReconciliationWorkspace(), workspace([scenario("EMA", { later: null, archive: null })])]) {
    const file = await prepareReconciliationFile(value);
    const restored = await decodeReconciliationFile(file.text);
    assert.equal(reconciliationKey(restored.workspace), reconciliationKey(value));
  }
});

test("canonical checksum does not depend on envelope whitespace or key order", async () => {
  const file = await prepareReconciliationFile(workspace());
  const parsed = JSON.parse(file.text);
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));
  assert.equal((await decodeReconciliationFile(reordered)).digest, file.digest);
});

test("tampering is rejected before a workspace is returned", async () => {
  const file = await prepareReconciliationFile(workspace());
  const parsed = JSON.parse(file.text);
  parsed.workspace.slots[0].later.balanceBaseUnits = "1";
  await assert.rejects(decodeReconciliationFile(JSON.stringify(parsed)), errorCode("RECONCILIATION_CHECKSUM"));
});

for (const [field, value] of [["schema", "future"], ["algorithm", "MD5"], ["digest", "f".repeat(63)],
  ["digest", "F".repeat(64)], ["digest", 7]]) test("file rejects invalid " + field + " " + String(value).slice(0, 10), async () => {
  const parsed = JSON.parse((await prepareReconciliationFile(workspace())).text);
  parsed[field] = value;
  await assert.rejects(decodeReconciliationFile(JSON.stringify(parsed)), errorCode("RECONCILIATION_FILE_SCHEMA"));
});

for (const field of ["schema", "algorithm", "digest", "workspace"]) test("file rejects missing " + field, async () => {
  const parsed = JSON.parse((await prepareReconciliationFile(workspace())).text);
  delete parsed[field];
  await assert.rejects(decodeReconciliationFile(JSON.stringify(parsed)), errorCode("RECONCILIATION_SHAPE"));
});

test("file rejects embedded report even if evidence checksum is valid", async () => {
  const parsed = JSON.parse((await prepareReconciliationFile(workspace())).text);
  parsed.report = { status: "arithmetic-agreement", verified: true };
  await assert.rejects(decodeReconciliationFile(JSON.stringify(parsed)), errorCode("RECONCILIATION_SHAPE"));
});

for (const text of ["{", "undefined", "null", "[]", "123", '"text"']) test("file rejects JSON structure " + text, async () => {
  await assert.rejects(decodeReconciliationFile(text));
});

for (const text of ["", null, 1, "a".repeat(RECONCILIATION_FILE_LIMIT + 1)]) test("bounded file rejects size/type " + typeof text, async () => {
  await assert.rejects(decodeReconciliationFile(text), errorCode("RECONCILIATION_FILE_SIZE"));
});

test("byte bound also catches multi-byte UTF-8 text before parsing", async () => {
  await assert.rejects(decodeReconciliationFile("あ".repeat(Math.floor(RECONCILIATION_FILE_LIMIT / 3) + 1)), errorCode("RECONCILIATION_FILE_SIZE"));
});

for (const name of ["", "a.txt", "../a.json", "a/b.json", "a\\b.json", "a\u0000.json", "x".repeat(181) + ".json"]) {
  test("file rejects unsafe name " + JSON.stringify(name).slice(0, 30), async () => {
    await assert.rejects(readReconciliationFile({ ...fileFrom("{}"), name }), errorCode("RECONCILIATION_FILENAME"));
  });
}

for (const size of [0, -1, 0.5, "2", NaN, Infinity, RECONCILIATION_FILE_LIMIT + 1]) test("file rejects advertised size " + size, async () => {
  let read = false;
  await assert.rejects(readReconciliationFile({ name: "a.json", size, arrayBuffer() { read = true; } }), errorCode("RECONCILIATION_FILE_SIZE"));
  assert.equal(read, false);
});

test("file rejects truncated, substituted, throwing and non-UTF8 buffers", async () => {
  await assert.rejects(readReconciliationFile({ name: "a.json", size: 10, arrayBuffer: async () => new ArrayBuffer(9) }), errorCode("RECONCILIATION_FILE_SIZE"));
  await assert.rejects(readReconciliationFile({ name: "a.json", size: 2, arrayBuffer: async () => new Uint8Array(2) }), errorCode("RECONCILIATION_FILE_SIZE"));
  await assert.rejects(readReconciliationFile({ name: "a.json", size: 2, arrayBuffer: async () => { throw Error("secret path"); } }), errorCode("RECONCILIATION_FILE_READ"));
  await assert.rejects(readReconciliationFile({ name: "a.json", size: 2, arrayBuffer: async () => Uint8Array.of(0xc0, 0xaf).buffer }), errorCode("RECONCILIATION_FILE_ENCODING"));
});

for (const subtle of [null, {}, { digest: async () => { throw Error("crypto failed"); } },
  { digest: async () => new ArrayBuffer(31) }, { digest: async () => new Uint8Array(32) }]) {
  test("crypto fails closed " + String(subtle?.digest), async () => {
    await assert.rejects(prepareReconciliationFile(workspace(), { subtle }), errorCode("RECONCILIATION_CRYPTO"));
  });
}

test("prepare snapshots input before awaiting crypto", async () => {
  const input = clone(workspace());
  const gate = deferred();
  const subtle = { async digest(...args) { await gate.promise; return webcrypto.subtle.digest(...args); } };
  const pending = prepareReconciliationFile(input, { subtle });
  input.slots[0].later.balanceBaseUnits = "0";
  gate.resolve();
  const encoded = await pending;
  const decoded = await decodeReconciliationFile(encoded.text);
  assert.notEqual(decoded.workspace.slots[0].later.balanceBaseUnits, "0");
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const kind of ["earlier", "later"]) test(`legacy ${agent} ${kind} identity file requires explicit slot selection`, async () => {
    const before = emptyReconciliationWorkspace();
    const observation = scenario(agent)[kind];
    const file = await prepareTokenIdentityFile(observation);
    const after = await readReconciliationInput(fileFrom(file.text), kind, agent, before);
    const slot = after.slots.find(row => row.agent === agent);
    assert.deepEqual(slot[kind], observation);
    assert.equal(slot[kind === "earlier" ? "later" : "earlier"], null);
    assert.equal(before.slots.find(row => row.agent === agent)[kind], null);
  });
}

test("archive and single-snapshot imports retain their original file checks", async () => {
  const before = emptyReconciliationWorkspace();
  const slot = scenario();
  for (const [kind, file] of [["archive", await prepareTransferArchive(slot.archive)],
    ["snapshot", await prepareTransferDownload(slot.archive.records[0])]]) {
    const after = await readReconciliationInput(fileFrom(file.text), kind, "DAT", before);
    assert.deepEqual(after.slots[0].archive, slot.archive);
    assert.equal(after.slots[0].earlier, null);
  }
});

test("vault import targets all archive slots but never overwrites balances", async () => {
  const before = previewWorkspace();
  const bundle = vaultBundle([null, scenario("EMA").archive, null]);
  const file = await prepareVaultFile(bundle);
  const after = await readReconciliationInput(fileFrom(file.text), "vault", "DAT", before);
  assert.equal(after.slots[0].archive, null);
  assert.equal(after.slots[2].archive, null);
  assert.deepEqual(after.slots[1].archive, bundle.slots[1].archive);
  assert.deepEqual(after.slots.map(slot => slot.earlier), before.slots.map(slot => slot.earlier));
  assert.deepEqual(after.slots.map(slot => slot.later), before.slots.map(slot => slot.later));
});

test("workspace import replaces whole draft only in returned candidate", async () => {
  const before = workspace();
  const file = await prepareReconciliationFile(previewWorkspace());
  const after = await readReconciliationInput(fileFrom(file.text), "workspace", "EMA", before);
  assert.deepEqual(after, previewWorkspace());
  assert.equal(before.slots[1].earlier, null);
});

test("cross-token, wrong-kind and unknown-kind files are rejected", async () => {
  const identity = await prepareTokenIdentityFile(scenario("EMA").earlier);
  await assert.rejects(readReconciliationInput(fileFrom(identity.text), "earlier", "DAT", workspace()), errorCode("RECONCILIATION_SLOT_AGENT"));
  await assert.rejects(readReconciliationInput(fileFrom(identity.text), "archive", "EMA", workspace()));
  await assert.rejects(readReconciliationInput(fileFrom(identity.text), "unknown", "EMA", workspace()), errorCode("RECONCILIATION_FILE_KIND"));
});
