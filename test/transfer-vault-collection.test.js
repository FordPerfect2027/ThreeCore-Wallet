import test from "node:test";
import assert from "node:assert/strict";
import { prepareVaultCollection, decodeVaultCollection, readVaultCollection, reviewVaultCollection,
  vaultCollectionReviewText, VAULT_COLLECTION_LIMIT } from "../src/transfer-vault-collection.js";
import { emptyVaultDocument, mutateVaultDocument, vaultKey } from "../src/transfer-vault-model.js";
import { controllerFixture, memoryVault, bundleFor, saveOperation, id, TIME } from "./helpers/vault-fixtures.js";
import { fileFromText, code, deferred, clone } from "./helpers/transfer-fixtures.js";

function collection(count = 2) {
  let value = emptyVaultDocument();
  for (let n = 1; n <= count; n++) value = mutateVaultDocument(value, value.revision, saveOperation(bundleFor(), n, "Saved " + n));
  if (count) value = mutateVaultDocument(value, value.revision, { kind: "archive", id: id(1), time: TIME });
  return value;
}

test("collection export includes active and archived data with portable revision zero", async () => {
  const before = collection(), file = await prepareVaultCollection(before);
  const decoded = await decodeVaultCollection(file.text);
  assert.equal(decoded.document.revision, 0);
  assert.equal(before.revision, 3);
  assert.equal(decoded.document.entries.length, 2);
  assert.equal(decoded.document.entries[0].archived, true);
  assert.deepEqual(decoded.document.entries, before.entries);
  assert.equal(decoded.authenticated, false);
});

test("collection checksum covers label, dates, archived state and observations", async () => {
  const original = await prepareVaultCollection(collection());
  for (const change of [
    value => { value.document.entries[0].label = "Changed"; },
    value => { value.document.entries[0].archived = false; },
    value => { value.document.entries[0].updatedAt = "2026-10-24T00:00:00.000Z"; },
    value => { value.document.entries[0].bundle.slots[0].archive.records[0].events[0].amountBaseUnits = "0"; },
  ]) {
    const value = JSON.parse(original.text);
    change(value);
    await assert.rejects(decodeVaultCollection(JSON.stringify(value)), code("TRANSFER_CHECKSUM_MISMATCH"));
  }
});

test("collection review is additive, idempotent and explicit about archived additions", () => {
  const incoming = collection();
  const review = reviewVaultCollection(emptyVaultDocument(), incoming);
  assert.equal(review.additions, 2);
  assert.equal(review.archivedAdditions, 1);
  assert.equal(review.duplicates, 0);
  const result = mutateVaultDocument(emptyVaultDocument(), 0, { kind: "import", entries: review.entries });
  assert.equal(result.revision, 1);
  const again = reviewVaultCollection(result, incoming);
  assert.equal(again.additions, 0);
  assert.equal(again.duplicates, 2);
  assert.equal(mutateVaultDocument(result, 1, { kind: "import", entries: again.entries }).revision, 1);
  assert.match(vaultCollectionReviewText(review), /既存の記録は上書きしません/);
});

for (const change of [
  row => { row.label = "Same id, different name"; },
  row => { row.archived = !row.archived; },
  row => { row.updatedAt = "2026-10-24T00:00:00.000Z"; },
  row => { row.bundle = bundleFor(["DAT"]); },
]) {
  test("collection identifier collisions reject differences without overwriting", () => {
    const before = collection(), incoming = clone(before);
    change(incoming.entries[0]);
    assert.throws(() => reviewVaultCollection(before, incoming), code("TRANSFER_VAULT_IMPORT_CONFLICT"));
    assert.equal(before.entries[0].label, "Saved 1");
  });
}

test("collection capacity is checked for the combined destination", () => {
  const before = collection(5);
  const extra = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation(bundleFor(), 99));
  assert.throws(() => reviewVaultCollection(before, extra), code("TRANSFER_VAULT_CAPACITY"));
  assert.equal(before.entries.length, 5);
});

test("portable revision cannot be used to reset a destination update number", () => {
  const before = { ...collection(1), revision: 101 };
  const extra = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation(bundleFor(), 99));
  const review = reviewVaultCollection(before, extra);
  assert.equal(review.expectedRevision, 101);
  const merged = mutateVaultDocument(before, 101, { kind: "import", entries: review.entries });
  assert.equal(merged.revision, 102);
});

test("collection reader rejects nonzero portable revision and unsupported fields", async () => {
  const prepared = await prepareVaultCollection(collection());
  for (const change of [
    value => { value.document.revision = 7; },
    value => { value.algorithm = "none"; },
    value => { value.schema = "unknown"; },
    value => { value.digest = "z".repeat(64); },
  ]) {
    const value = JSON.parse(prepared.text);
    change(value);
    await assert.rejects(decodeVaultCollection(JSON.stringify(value)), code("TRANSFER_VAULT_COLLECTION_SCHEMA"));
  }
  const value = JSON.parse(prepared.text);
  value.accountPermission = true;
  await assert.rejects(decodeVaultCollection(JSON.stringify(value)), code("TRANSFER_SHAPE"));
});

test("collection file import validates byte size, UTF-8 and JSON before storage", async () => {
  let reads = 0;
  await assert.rejects(readVaultCollection({ name: "all.json", size: VAULT_COLLECTION_LIMIT + 1,
    arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } }), code("TRANSFER_VAULT_COLLECTION_SIZE"));
  assert.equal(reads, 0);
  await assert.rejects(readVaultCollection(fileFromText("broken")), code("TRANSFER_FILE_JSON"));
  await assert.rejects(readVaultCollection({ name: "all.json", size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }), code("TRANSFER_FILE_ENCODING"));
  await assert.rejects(readVaultCollection({ name: "all.json", size: 1, arrayBuffer: async () => new ArrayBuffer(2) }), code("TRANSFER_VAULT_COLLECTION_SIZE"));
});

test("empty collections do not produce a misleading backup download", async () => {
  await assert.rejects(prepareVaultCollection(emptyVaultDocument()), code("TRANSFER_VAULT_EMPTY"));
});

test("collection restore requires opening storage, preview and a separate commit", async () => {
  const f = controllerFixture();
  const file = fileFromText((await prepareVaultCollection(collection())).text);
  assert.equal(await f.controller.loadCollection(file), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_REFRESH_REQUIRED");
  await f.controller.refresh();
  assert.equal(await f.controller.loadCollection(file), true);
  assert.equal(f.storage.value.entries.length, 0);
  assert.equal(f.controller.state.collectionReview.additions, 2);
  assert.equal(await f.controller.applyCollection(f.controller.state.collectionReview.id), true);
  assert.equal(f.storage.value.entries.length, 2);
  assert.equal(f.storage.value.entries[0].archived, true);
  assert.equal(f.controller.state.hasRecords, false);
  assert.equal(f.staged.length, 0);
});

test("collection restore does not replace the current working copy", async () => {
  const f = controllerFixture();
  f.setCards(bundleFor(["DAT"]));
  await f.capture();
  const key = vaultKey(f.controller.state.working);
  await f.controller.refresh();
  await f.controller.loadCollection(fileFromText((await prepareVaultCollection(collection())).text));
  await f.controller.applyCollection(f.controller.state.collectionReview.id);
  assert.equal(vaultKey(f.controller.state.working), key);
});

test("collection restore refuses concurrent edits at the commit boundary", async () => {
  const f = controllerFixture();
  await f.controller.refresh();
  await f.controller.loadCollection(fileFromText((await prepareVaultCollection(collection())).text));
  const reviewId = f.controller.state.collectionReview.id;
  f.storage.replace(mutateVaultDocument(f.storage.value, 0, saveOperation(bundleFor(), 99)));
  assert.equal(await f.controller.applyCollection(reviewId), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_STALE");
  assert.equal(f.storage.value.entries.length, 1);
  assert.equal(f.storage.value.entries[0].id, id(99));
});

test("cancelled collection preview and late file decoding never mutate storage", async () => {
  const pending = deferred();
  const file = fileFromText((await prepareVaultCollection(collection())).text);
  const f = controllerFixture();
  await f.controller.refresh();
  const loading = f.controller.loadCollection({ ...file, arrayBuffer: () => pending.promise });
  f.controller.cancel();
  pending.resolve(await file.arrayBuffer());
  assert.equal(await loading, false);
  assert.equal(f.controller.state.collectionReview, null);
  assert.equal(f.storage.value.entries.length, 0);
});

test("collection save cancellation aborts before imported entries commit", async () => {
  const pending = deferred();
  const f = controllerFixture({ storage: memoryVault(undefined, { beforeChange: () => pending.promise }) });
  await f.controller.refresh();
  await f.controller.loadCollection(fileFromText((await prepareVaultCollection(collection())).text));
  const importing = f.controller.applyCollection(f.controller.state.collectionReview.id);
  f.controller.cancel();
  pending.resolve();
  assert.equal(await importing, false);
  assert.equal(f.storage.value.entries.length, 0);
});

test("exporting the collection rechecks storage rather than using a stale cached list", async () => {
  const f = controllerFixture({ storage: memoryVault(collection()) });
  await f.controller.refresh();
  f.storage.replace(mutateVaultDocument(f.storage.value, f.storage.value.revision, { kind: "rename", id: id(2), label: "Changed", time: TIME }));
  assert.equal(await f.controller.prepareCollection(), null);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_STALE");
  await f.controller.refresh();
  const file = await f.controller.prepareCollection();
  assert.equal(JSON.parse(file.text).document.entries[1].label, "Changed");
});

test("changing selection or refreshing invalidates an old collection preview", async () => {
  const f = controllerFixture({ storage: memoryVault(collection(1)) });
  await f.controller.refresh();
  const file = fileFromText((await prepareVaultCollection(collection())).text);
  await f.controller.loadCollection(file);
  const reviewId = f.controller.state.collectionReview.id;
  f.controller.select(id(1));
  assert.equal(f.controller.state.collectionReview, null);
  assert.equal(await f.controller.applyCollection(reviewId), false);
  assert.equal(f.storage.value.entries.length, 1);
});
