import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { encryptWorkspaceBackup, decryptWorkspaceBackup } from "../src/secure-backup-crypto.js";
import { prepareEncryptedArchive, decodeEncryptedArchive } from "../src/encrypted-library-archive.js";
import { emptyEncryptedLibrary, prepareLibraryEntry, mutateEncryptedLibrary } from "../src/encrypted-library-model.js";
import { prepareCheckpointCollection, decodeCheckpointCollection } from "../src/checkpoint-transfer.js";
import { prepareVaultCollection, decodeVaultCollection } from "../src/transfer-vault-collection.js";
import { emptyVaultDocument, mutateVaultDocument } from "../src/transfer-vault-model.js";
import { bundleFor, saveOperation } from "./helpers/vault-fixtures.js";
import { getDocumentExportGuard, offerWalletDownload } from "../examples/export-download.js";
import { bundle } from "./helpers/workspace-fixtures.js";
import { stored, preparedDraft } from "./helpers/checkpoint-fixtures.js";
import { browserFixture, PRIVATE, assertPrivate } from "./helpers/export-fixtures.js";

const password = PRIVATE + "-only-a-test-passphrase";
let encrypted;
const sample = () => encrypted ??= encryptWorkspaceBackup(bundle(), password, { crypto: webcrypto });

async function transport(input) {
  const f = browserFixture();
  const guard = getDocumentExportGuard(f.document);
  const receipt = offerWalletDownload({ document: f.document, prepared: input });
  const bytes = new Uint8Array(await f.blobs[0].arrayBuffer());
  const status = guard.state();
  assert.equal(receipt.downloadComplete, false);
  assert.deepEqual(bytes, new TextEncoder().encode(input.text));
  assert.equal(status.reservedBytes, bytes.length);
  assertPrivate(assert, status);
  assertPrivate(assert, receipt);
  assert.equal(f.body.children.length, 0);
  guard.clear();
  assert.equal(f.liveURLs.size, 0);
  assert.equal(guard.state().reservedBytes, 0);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

test("real encrypted workspace remains decryptable after the guarded download boundary", async () => {
  const input = await sample();
  const actual = await transport(input);
  assert.equal(actual, input.text);
  assert(!actual.includes(password));
  assert(!actual.includes("nativeBalanceBaseUnits"));
  assert(!actual.includes("0x111111"));
  const restored = await decryptWorkspaceBackup(actual, password, { crypto: webcrypto });
  assert.equal(restored.passwordAuthenticated, true);
  assert.equal(restored.ownerVerified, false);
  assert(restored.text.includes("DAT"));
  assert(restored.text.includes("EMA"));
  assert(restored.text.includes("CAWELON"));
});

test("guarded encrypted library preserves its verified envelope without adding plaintext", async () => {
  const input = await sample();
  const entry = await prepareLibraryEntry(input.text, { now: () => 1792820000000 });
  const empty = emptyEncryptedLibrary();
  const library = mutateEncryptedLibrary(empty, empty, { kind: "add", entry });
  const exported = await prepareEncryptedArchive(library);
  const transported = await transport(exported);
  const decoded = await decodeEncryptedArchive(transported);
  assert.equal(decoded.entries.length, 1);
  assert.equal(decoded.entries[0].text, input.text);
  assert(!transported.includes(password));
  assert(!transported.includes("nativeBalanceBaseUnits"));
});

test("guarded checkpoint collection preserves Unicode notes and archive state byte-for-byte", async () => {
  const file = await preparedDraft();
  const input = stored(2, file.text);
  input.entries[1].label = "後日の確認用";
  input.entries[1].archived = true;
  const exported = await prepareCheckpointCollection(input);
  const transported = await transport(exported);
  const decoded = await decodeCheckpointCollection(transported);
  assert.equal(decoded.entries[1].label, input.entries[1].label);
  assert.equal(decoded.entries[1].archived, true);
  assert.equal(decoded.authenticated, false);
});

test("saved vault collection remains a valid guarded portable file", async () => {
  const empty = emptyVaultDocument();
  const source = mutateVaultDocument(empty, empty.revision, saveOperation(bundleFor(), 1));
  const exported = await prepareVaultCollection(source);
  const transported = await transport(exported);
  const decoded = await decodeVaultCollection(transported);
  assert.equal(decoded.document.entries.length, 1);
  assert.deepEqual(decoded.document.entries, source.entries);
  assert.equal(decoded.authenticated, false);
});

test("rejected encrypted export cannot allocate a replacement plaintext fallback", async () => {
  const f = browserFixture(), input = await sample();
  const guard = getDocumentExportGuard(f.document);
  assert.throws(() => guard.offer({ ...input, filename: "../private.json" }), { code: "EXPORT_NAME" });
  assert.equal(f.blobs.length, 0);
  assert.equal(f.liveURLs.size, 0);
  assert.equal(guard.state().rejected, 1);
  assert.equal(guard.state().offered, 0);
  assertPrivate(assert, guard.state());
});

test("failed encrypted handoff retains no data in its public error or status", async () => {
  const f = browserFixture(), input = await sample();
  f.throwAt("click");
  const guard = getDocumentExportGuard(f.document);
  assert.throws(() => guard.offer(input), error => {
    assert.equal(error.code, "EXPORT_FAILED");
    assert.equal(error.message, "EXPORT_FAILED");
    assert(!error.message.includes(password));
    return true;
  });
  assert.equal(f.liveURLs.size, 0);
  assert.equal(f.body.children.length, 0);
  assertPrivate(assert, guard.state());
});
