import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareVaultCollection } from "../src/transfer-vault-collection.js";
import { prepareVaultFile } from "../src/transfer-vault-file.js";
import { emptyVaultDocument, mutateVaultDocument } from "../src/transfer-vault-model.js";
import { bundleFor, saveOperation, id, TIME } from "./helpers/vault-fixtures.js";
import { runSavedFileInspection } from "../scripts/inspect-wallet-saved-file.js";
import { inspectWalletSavedText, walletSavedInspectionText, compareWalletSavedInspections,
  walletSavedComparisonText, inspectWalletSavedTextBatch, encodeWalletSavedTextBatchCsv,
  prepareWalletSavedBundle, reviewWalletSavedBundle, walletSavedFileTargetCode,
  walletSavedFileTargetMessage } from "../src/file-read-status.js";

const bundle = bundleFor();
let document = emptyVaultDocument();
for (let n = 1; n <= 2; n++) document = mutateVaultDocument(document, document.revision,
  saveOperation(bundle, n, "Private vault label " + n));
document = mutateVaultDocument(document, document.revision, { kind: "archive", id: id(1), time: TIME });
const original = await prepareVaultCollection(document);
const hash = text => createHash("sha256").update(text).digest("hex");

test("collection guide verifies active and archived records without exporting private values or deduplicating references", async () => {
  const result = await inspectWalletSavedText(original.text);
  assert.equal(result.target, "transfer-vault-collection");
  assert.equal(result.validation, "validated-original");
  assert.equal(result.checksumVerified, true);
  assert.equal(result.sourceDigest, JSON.parse(original.text).digest);
  assert.equal(result.textDigest, hash(original.text));
  assert.equal(result.scope.vaultEntryReferences, 2);
  assert.equal(result.scope.archivedVaultEntryReferences, 1);
  assert.equal(result.scope.archiveReferences, 6);
  assert.equal(result.scope.transferRecordReferences, 6);
  assert.equal(result.scope.eventReferences, 6);
  assert.deepEqual(result.scope.agents, ["DAT", "EMA", "CAWELON"]);
  assert.equal(result.scope.repeatedReferencesMayExist, true);
  assert.equal(result.scope.draftReferences, null);
  for (const key of ["automaticallyImported", "restorable", "liveChainRechecked", "authenticated", "authorizesExecution"])
    assert.equal(result[key], false);
  assert(Object.isFrozen(result.scope));
  const display = walletSavedInspectionText(result);
  assert.match(display, /保管一覧の保存記録の参照 2件/);
  assert.match(display, /うち非表示保管の参照 1件/);
  assert.match(result.destinationMessage, /PC内の保存一覧.*保存一覧の保全JSONを開く/);
  for (const privateValue of ["Private vault label", id(1), TIME,
    bundle.slots[0].archive.records[0].context.account, "1000000000000000001"])
    assert(!(JSON.stringify(result) + display).includes(privateValue));
});

test("collection and working-bundle restore routes are distinct", async () => {
  const schema = JSON.parse(original.text).schema;
  const wrongControl = walletSavedFileTargetCode(schema, "period");
  assert.equal(wrongControl, "FILE_USE_TRANSFER_VAULT_COLLECTION");
  assert.match(walletSavedFileTargetMessage(wrongControl), /保存一覧の保全JSONを開く/);
  const working = await inspectWalletSavedText((await prepareVaultFile(bundle)).text);
  assert.equal(working.target, "transfer-vault");
  assert.equal(Object.hasOwn(working.scope, "vaultEntryReferences"), false);
});

test("collection guide rejects altered metadata, nested observations, invalid shape and duplicate identities", async () => {
  for (const change of [
    value => { value.digest = "0".repeat(64); },
    value => { value.document.entries[0].label = "Changed"; },
    value => { value.document.entries[0].bundle.slots[0].archive.records[0].events[0].amountBaseUnits = "0"; },
    value => { value.document.entries[1].id = value.document.entries[0].id; },
    value => { value.document.revision = 1; },
    value => { value.authorizesExecution = true; },
  ]) {
    const value = JSON.parse(original.text); change(value);
    await assert.rejects(inspectWalletSavedText(JSON.stringify(value)));
  }
});

test("collection comparisons detect metadata changes even when observation counts match", async () => {
  const before = await inspectWalletSavedText(original.text);
  const renamed = mutateVaultDocument(document, document.revision,
    { kind: "rename", id: id(2), label: "A different private name", time: TIME });
  const after = await inspectWalletSavedText((await prepareVaultCollection(renamed)).text);
  const comparison = compareWalletSavedInspections(before, after);
  assert.equal(comparison.kind, "changed-original");
  assert.equal(comparison.unchangedScopeWithChangedOriginal, true);
  const archived = mutateVaultDocument(document, document.revision, { kind: "archive", id: id(2), time: TIME });
  const changedCount = compareWalletSavedInspections(before,
    await inspectWalletSavedText((await prepareVaultCollection(archived)).text));
  assert.deepEqual(changedCount.scopeChanges, [{ field: "archivedVaultEntryReferences", before: 1, after: 2, difference: 1 }]);
  assert.match(walletSavedComparisonText(changedCount), /うち非表示保管の参照: 1 → 2/);
});

test("collection comparison bundle and batch CSV retain counts and verify the original bytes", async () => {
  const compact = JSON.stringify(JSON.parse(original.text));
  const prepared = await prepareWalletSavedBundle(original.text, compact);
  const review = await reviewWalletSavedBundle(prepared.text);
  assert.equal(review.comparisonMatchesRecomputation, true);
  assert.equal(review.comparison.kind, "format-only");
  assert.equal(review.comparison.sameOriginal, true);
  const batch = await inspectWalletSavedTextBatch([{ name: "collection.json", text: original.text }]);
  assert.equal(batch.allOriginalsValidated, true);
  assert.equal(batch.summary.validatedOriginals, 1);
  const csv = encodeWalletSavedTextBatchCsv(batch);
  assert(csv.includes('"vaultEntryReferences"'));
  assert(csv.includes('"archivedVaultEntryReferences"'));
  assert(!csv.includes("Private vault label"));
  assert(!csv.includes("undefined"));
});

test("collection verification cannot survive cancellation while checksum work is pending", async () => {
  const abort = new AbortController();
  let entered, release;
  const gate = new Promise(resolve => { entered = resolve; });
  const subtle = { digest(...args) { entered(); return new Promise(resolve => {
    release = () => resolve(crypto.subtle.digest(...args));
  }); } };
  const pending = inspectWalletSavedText(original.text, { signal: abort.signal, subtle });
  await gate; abort.abort();
  await assert.rejects(pending);
  release();
});

test("generic local-file checker accepts a collection and leaves its source untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "threecore-collection-guide-"));
  try {
    const path = join(dir, "backup.json"); await writeFile(path, original.text);
    let output = "", errors = "";
    const exitCode = await runSavedFileInspection([path, "--json"], {
      stdout: { write: value => { output += value; } }, stderr: { write: value => { errors += value; } },
    });
    assert.equal(exitCode, 0); assert.equal(errors, "");
    const result = JSON.parse(output);
    assert.equal(result.target, "transfer-vault-collection");
    assert.equal(result.textDigest, hash(original.text));
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(path, "utf8"), original.text);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
