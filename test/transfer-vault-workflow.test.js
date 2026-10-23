import test from "node:test";
import assert from "node:assert/strict";
import { controllerFixture, memoryVault, bundleFor, archiveFor, id, TIME, saveOperation } from "./helpers/vault-fixtures.js";
import { fileFromText, code, OTHER } from "./helpers/transfer-fixtures.js";
import { VAULT_AGENTS, vaultBundle, vaultKey, captureTransferArchive, emptyVaultDocument, mutateVaultDocument } from "../src/transfer-vault-model.js";
import { prepareVaultFile, decodeVaultFile } from "../src/transfer-vault-file.js";
import { prepareVaultCollection, decodeVaultCollection } from "../src/transfer-vault-collection.js";
import { summarizeVaultActivity, queryVaultActivity } from "../src/transfer-vault-analytics.js";

async function importBundle(controller, bundle, merge = false) {
  const file = await prepareVaultFile(bundle);
  assert.equal(await controller.load(fileFromText(file.text), merge), true);
  assert.equal(await controller.apply(controller.state.review.id, { acknowledgeRemoval: true }), true);
}

for (const chainId of [8453, 84532]) {
  for (const agent of VAULT_AGENTS) {
    test(`whole workflow retains ${agent} history on ${chainId} through backup, restore, undo and export`, async () => {
      const original = bundleFor([agent], { chainId, amount: "12345678901234567890123456789" });
      const source = controllerFixture();
      await importBundle(source.controller, original);
      await source.save("Original " + agent);
      assert.equal(await source.controller.editSelected("archive"), true);
      const backup = await source.controller.prepareCollection();
      assert.ok(backup);
      const sourceBytes = JSON.stringify(source.storage.value);
      source.controller.dispose();

      const destination = controllerFixture();
      assert.equal(await destination.controller.refresh(), true);
      assert.equal(await destination.controller.loadCollection(fileFromText(backup.text)), true);
      const review = destination.controller.state.collectionReview;
      assert.equal(review.additions, 1);
      assert.equal(review.archivedAdditions, 1);
      assert.equal(await destination.controller.applyCollection(review.id), true);
      assert.equal(destination.controller.state.hasRecords, false);
      assert.equal(destination.controller.select(id(1)), true);
      assert.equal(await destination.controller.inspectSelected(), false);
      assert.equal(await destination.controller.editSelected("unarchive"), true);
      assert.equal(await destination.controller.inspectSelected(), true);
      assert.equal(await destination.controller.apply(destination.controller.state.review.id), true);
      assert.equal(vaultKey(destination.controller.state.working), vaultKey(original));
      const persisted = JSON.stringify(destination.storage.value);
      assert.equal(destination.controller.undo(), true);
      assert.equal(destination.controller.state.hasRecords, false);
      assert.equal(destination.controller.redo(), true);
      assert.equal(JSON.stringify(destination.storage.value), persisted);
      const exported = await destination.controller.prepare();
      assert.equal(vaultKey((await decodeVaultFile(exported.text)).bundle), vaultKey(original));
      assert.equal(JSON.stringify(source.storage.value), sourceBytes);
      assert.equal(destination.staged.length, 0);
      const summary = summarizeVaultActivity(destination.controller.state.working).find(row => row.present);
      assert.equal(summary.receivedBaseUnits, "12345678901234567890123456789");
      assert.equal(summary.isBalance, false);
      destination.controller.dispose();
    });
  }
}

test("one poisoned token rejects the whole collection without partially saving the other two", async () => {
  const source = controllerFixture();
  await source.capture(); await source.save();
  const backup = await source.controller.prepareCollection();
  const envelope = JSON.parse(backup.text);
  envelope.document.entries[0].bundle.slots[2].archive.records[0].context.account = "0x123";
  const destination = controllerFixture();
  await destination.capture(); await destination.save("Destination");
  const prior = JSON.stringify(destination.storage.value);
  const working = vaultKey(destination.controller.state.working);
  assert.equal(await destination.controller.loadCollection(fileFromText(JSON.stringify(envelope))), false);
  assert.equal(destination.controller.state.collectionReview, null);
  assert.equal(JSON.stringify(destination.storage.value), prior);
  assert.equal(vaultKey(destination.controller.state.working), working);
  source.controller.dispose(); destination.controller.dispose();
});

test("external removal of a saved entry clears the saved flag after explicit refresh", async () => {
  const f = controllerFixture();
  await f.capture(); await f.save();
  assert.equal(f.controller.state.saved, true);
  let current = f.storage.value;
  current = mutateVaultDocument(current, current.revision, { kind: "archive", id: id(1), time: TIME });
  current = mutateVaultDocument(current, current.revision, { kind: "purge", id: id(1), confirmed: true });
  f.storage.replace(current);
  await f.controller.refresh();
  assert.equal(f.controller.state.saved, false);
  assert.equal(f.controller.state.hasRecords, true);
  assert.equal(f.controller.state.metadata.count, 0);
  f.controller.dispose();
});

test("purging one of two identical backups does not clear the remaining saved copy", async () => {
  const f = controllerFixture();
  await f.capture(); await f.save("First"); await f.save("Second");
  await f.controller.editSelected("archive");
  await f.controller.editSelected("purge", true);
  assert.equal(f.controller.state.saved, true);
  assert.equal(f.controller.state.metadata.count, 1);
  assert.equal(f.storage.value.entries[0].id, id(1));
  f.controller.dispose();
});

for (const action of ["save", "rename", "archive", "unarchive", "purge"]) {
  test(`competing tab ${action} never overwrites a newly saved record`, async () => {
    const adapter = memoryVault();
    const f = controllerFixture({ storage: adapter });
    await f.capture(); await f.save();
    if (["unarchive", "purge"].includes(action)) await f.controller.editSelected("archive");
    const current = adapter.value;
    adapter.replace(mutateVaultDocument(current, current.revision, saveOperation(bundleFor(["EMA"]), 99, "Other tab")));
    const expected = JSON.stringify(adapter.value);
    const working = vaultKey(f.controller.state.working);
    const result = action === "save" ? await f.controller.save("Another") :
      await f.controller.editSelected(action, action === "rename" ? "Rename" : true);
    assert.equal(result, false);
    assert.equal(f.controller.state.error, "TRANSFER_VAULT_STALE");
    assert.equal(f.controller.state.metadata, null);
    assert.equal(JSON.stringify(adapter.value), expected);
    assert.equal(vaultKey(f.controller.state.working), working);
    await f.controller.refresh();
    assert.equal(f.controller.state.metadata.count, 2);
    f.controller.dispose();
  });
}

test("twelve original periods survive one bundled file with gaps intact and no invented coverage", async () => {
  let archive = null;
  for (let i = 0; i < 12; i++) {
    archive = captureTransferArchive(archive, archiveFor("DAT", { start: i * 20 + 1, end: i * 20 + 10, count: 2 }).records[0]);
  }
  const original = vaultBundle([archive, null, null]);
  const file = await prepareVaultFile(original);
  const restored = (await decodeVaultFile(file.text)).bundle;
  const summary = summarizeVaultActivity(restored)[0];
  assert.equal(summary.coverage.records, 12);
  assert.equal(summary.coverage.requestedBlocks, "120");
  assert.equal(summary.coverage.gaps.length, 11);
  assert.equal(summary.coverage.completeHistory, false);
  assert.equal(summary.events, 24);
  assert.equal(summary.receivedBaseUnits, String(24n * 1000000000000000001n));
  const query = { agent: "DAT", direction: "incoming", search: "", order: "oldest", page: 1, pageSize: 20 };
  assert.equal(queryVaultActivity(restored, query).rows.length, 4);
  assert.throws(() => captureTransferArchive(restored.slots[0].archive,
    archiveFor("DAT", { start: 260, end: 269 }).records[0]), code("TRANSFER_ARCHIVE_LIMIT"));
  assert.equal(vaultKey(original), vaultKey(restored));
});

test("the same block and transaction identifiers in different assets remain separate", async () => {
  const original = bundleFor(undefined, { count: 3, amount: "7" });
  const file = await prepareVaultFile(original);
  const restored = (await decodeVaultFile(file.text)).bundle;
  const rows = queryVaultActivity(restored).rows;
  assert.equal(rows.length, 9);
  for (const agent of VAULT_AGENTS) {
    assert.equal(rows.filter(row => row.agent === agent).length, 3);
    const summary = summarizeVaultActivity(restored).find(row => row.agent === agent);
    assert.equal(summary.receivedBaseUnits, "21");
    assert.equal(summary.transactions, 3);
  }
});

test("account replacement does not alter backups and can be undone before another file export", async () => {
  const f = controllerFixture();
  await f.capture(); await f.save();
  const original = vaultKey(f.controller.state.working);
  const persisted = JSON.stringify(f.storage.value);
  await importBundle(f.controller, bundleFor(["DAT"], { account: OTHER }));
  assert.notEqual(vaultKey(f.controller.state.working), original);
  assert.equal(f.controller.state.saved, false);
  assert.equal(f.controller.undo(), true);
  assert.equal(f.controller.state.saved, true);
  const file = await f.controller.prepare();
  assert.equal(vaultKey((await decodeVaultFile(file.text)).bundle), original);
  assert.equal(JSON.stringify(f.storage.value), persisted);
  assert.equal(f.staged.length, 0);
  f.controller.dispose();
});

test("a collection backup remains self-contained after later local metadata changes", async () => {
  let document = emptyVaultDocument();
  for (let n = 1; n <= 5; n++) {
    document = mutateVaultDocument(document, document.revision, saveOperation(bundleFor([VAULT_AGENTS[(n - 1) % 3]]), n, "Record " + n));
  }
  const file = await prepareVaultCollection(document);
  const snapshot = JSON.stringify(document.entries);
  for (let n = 1; n <= 5; n++) {
    document = mutateVaultDocument(document, document.revision, { kind: "rename", id: id(n), label: "Changed " + n, time: TIME });
    document = mutateVaultDocument(document, document.revision, { kind: "archive", id: id(n), time: TIME });
  }
  const restored = (await decodeVaultCollection(file.text)).document;
  assert.equal(restored.revision, 0);
  assert.equal(JSON.stringify(restored.entries), snapshot);
  assert.ok(document.entries.every(entry => entry.archived));
  assert.ok(restored.entries.every(entry => !entry.archived));
});

test("restoring a selected record detects metadata changes made between review and apply", async () => {
  const f = controllerFixture();
  await f.capture(); await f.save();
  await f.controller.inspectSelected();
  const reviewId = f.controller.state.review.id;
  const key = vaultKey(f.controller.state.working);
  const current = f.storage.value;
  f.storage.replace(mutateVaultDocument(current, current.revision, { kind: "rename", id: id(1), label: "Other window", time: TIME }));
  assert.equal(await f.controller.apply(reviewId), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_STALE");
  assert.equal(vaultKey(f.controller.state.working), key);
  assert.equal(f.controller.state.timeline.undoCount, 1);
  f.controller.dispose();
});
