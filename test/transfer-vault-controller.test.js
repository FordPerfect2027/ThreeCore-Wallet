import test from "node:test";
import assert from "node:assert/strict";
import { createVaultController } from "../src/transfer-vault-controller.js";
import { vaultBundle, vaultKey, mutateVaultDocument, emptyVaultDocument } from "../src/transfer-vault-model.js";
import { prepareVaultFile } from "../src/transfer-vault-file.js";
import { encodeTransferFile } from "../src/transfer-file.js";
import { prepareTransferArchive } from "../src/transfer-archive-file.js";
import { controllerFixture, memoryVault, bundleFor, archiveFor, saveOperation, id, TIME } from "./helpers/vault-fixtures.js";
import { deferred, tick, fileFromText, OTHER, clone } from "./helpers/transfer-fixtures.js";

test("vault controller mount performs no storage or wallet activity", () => {
  const f = controllerFixture();
  assert.equal(f.storage.calls.length, 0);
  assert.equal(f.staged.length, 0);
  assert.equal(f.controller.state.hasRecords, false);
  assert.equal(f.controller.state.metadata, null);
  f.controller.dispose();
  assert.deepEqual(f.storage.calls.map(row => row.method), ["close"]);
});

test("capture requires explicit apply and never auto-saves", async () => {
  const f = controllerFixture();
  assert.equal(f.controller.capture(), true);
  assert.equal(f.controller.state.hasRecords, false);
  assert.equal(f.controller.state.review.changes[0].added, 1);
  assert.equal(await f.controller.apply(f.controller.state.review.id), true);
  assert.equal(f.controller.state.hasRecords, true);
  assert.equal(f.controller.state.saved, false);
  assert.equal(f.storage.calls.length, 0);
});

test("capture detects card changes even without an explicit invalidation event", async () => {
  const f = controllerFixture();
  f.controller.capture();
  const reviewId = f.controller.state.review.id;
  f.setCards(bundleFor(["DAT"]));
  assert.equal(await f.controller.apply(reviewId), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_CARDS_CHANGED");
  assert.equal(f.controller.state.hasRecords, false);
});

test("card invalidation preserves a historical working copy but removes card preview", async () => {
  const f = controllerFixture();
  await f.capture();
  const key = vaultKey(f.controller.state.working);
  f.controller.capture();
  f.controller.invalidateCards();
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.cardsChanged, true);
  assert.equal(vaultKey(f.controller.state.working), key);
});

test("file review remains offline and valid after card input changes", async () => {
  const f = controllerFixture();
  await f.controller.load(fileFromText((await prepareVaultFile(bundleFor())).text));
  const reviewId = f.controller.state.review.id;
  f.controller.invalidateCards();
  assert.equal(f.controller.state.review.id, reviewId);
  assert.equal(await f.controller.apply(reviewId), true);
  assert.equal(f.storage.calls.length, 0);
  assert.equal(f.staged.length, 0);
});

test("removal acknowledgement is required for a replacing import", async () => {
  const f = controllerFixture();
  await f.capture();
  const key = vaultKey(f.controller.state.working);
  const file = fileFromText((await prepareVaultFile(bundleFor(["DAT"]))).text);
  await f.controller.load(file);
  assert.equal(f.controller.state.review.removesRecords, true);
  assert.equal(await f.controller.apply(f.controller.state.review.id), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_CONFIRMATION");
  assert.equal(vaultKey(f.controller.state.working), key);
  await f.controller.load(file);
  assert.equal(await f.controller.apply(f.controller.state.review.id, { acknowledgeRemoval: true }), true);
  assert.equal(f.controller.state.working.slots[1].archive, null);
});

test("additive import preserves other tokens without requiring removal acknowledgement", async () => {
  const f = controllerFixture();
  f.setCards(bundleFor(["DAT"]));
  await f.capture();
  await f.controller.load(fileFromText((await prepareVaultFile(bundleFor(["EMA"]))).text), true);
  assert.equal(f.controller.state.review.removesRecords, false);
  assert.equal(await f.controller.apply(f.controller.state.review.id), true);
  assert.equal(f.controller.state.working.slots.filter(row => row.archive).length, 2);
});

test("replacing a context can be reviewed offline without changing card settings", async () => {
  const f = controllerFixture();
  await f.capture();
  const file = fileFromText((await prepareVaultFile(bundleFor(["DAT"], { account: OTHER }))).text);
  await f.controller.load(file);
  assert.equal(f.controller.state.review.changes[0].contextChanged, true);
  await f.controller.apply(f.controller.state.review.id, { acknowledgeRemoval: true });
  assert.equal(f.staged.length, 0);
  assert.equal(f.controller.state.working.slots[0].archive.records[0].context.account, OTHER);
});

test("failed additive merge preserves all existing token records", async () => {
  const f = controllerFixture();
  await f.capture();
  const key = vaultKey(f.controller.state.working);
  const file = fileFromText((await prepareVaultFile(bundleFor(["DAT"], { amount: "3" }))).text);
  assert.equal(await f.controller.load(file, true), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_RANGE_CONFLICT");
  assert.equal(vaultKey(f.controller.state.working), key);
});

test("save is refused until storage has explicitly been opened", async () => {
  const f = controllerFixture();
  await f.capture();
  assert.equal(await f.controller.save("First"), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_REFRESH_REQUIRED");
  assert.equal(f.storage.calls.length, 0);
});

test("save writes a new full bundle and waits for storage completion", async () => {
  const pending = deferred();
  const storage = memoryVault(undefined, { beforeChange: () => pending.promise });
  const f = controllerFixture({ storage });
  await f.capture();
  await f.controller.refresh();
  const saving = f.controller.save(" First ");
  assert.equal(f.controller.state.busy, true);
  assert.equal(f.controller.state.saved, false);
  assert.equal(storage.value.entries.length, 0);
  pending.resolve();
  assert.equal(await saving, true);
  assert.equal(f.controller.state.saved, true);
  assert.equal(storage.value.entries[0].label, "First");
  assert.equal(storage.value.entries[0].bundle.slots.filter(row => row.archive).length, 3);
});

test("cancel before save commit refuses late persistence and clears busy state", async () => {
  const pending = deferred();
  const storage = memoryVault(undefined, { beforeChange: () => pending.promise });
  const f = controllerFixture({ storage });
  await f.capture();
  await f.controller.refresh();
  const saving = f.controller.save("Cancelled");
  f.controller.cancel();
  assert.equal(storage.calls.at(-1).options.signal.aborted, true);
  pending.resolve();
  assert.equal(await saving, false);
  assert.equal(storage.value.entries.length, 0);
  assert.equal(f.controller.state.busy, false);
  assert.equal(f.controller.state.saved, false);
});

test("dispose prevents deferred storage result from changing UI", async () => {
  const pending = deferred();
  const f = controllerFixture({ storage: memoryVault(undefined, { beforeRead: () => pending.promise }) });
  const loading = f.controller.refresh();
  f.controller.dispose();
  const count = f.states.length;
  pending.resolve();
  assert.equal(await loading, false);
  assert.equal(f.states.length, count);
  assert.equal(f.controller.state.disposed, true);
});

test("concurrent save refuses to overwrite another tab and requires refresh", async () => {
  const f = controllerFixture();
  await f.capture();
  await f.controller.refresh();
  f.storage.replace(mutateVaultDocument(f.storage.value, 0, saveOperation(bundleFor(["DAT"]), 99)));
  assert.equal(await f.controller.save("Stale"), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_STALE");
  assert.equal(f.controller.state.metadata, null);
  assert.equal(f.storage.value.entries.length, 1);
  assert.equal(f.storage.value.entries[0].id, id(99));
  await f.controller.refresh();
  assert.equal(await f.controller.save("Fresh"), true);
  assert.equal(f.storage.value.entries.length, 2);
});

test("double-click while saving cannot allocate a duplicate record", async () => {
  const pending = deferred();
  const f = controllerFixture({ storage: memoryVault(undefined, { beforeChange: () => pending.promise }) });
  await f.capture();
  await f.controller.refresh();
  const first = f.controller.save("Once");
  assert.equal(await f.controller.save("Twice"), false);
  assert.equal(f.controller.capture(), false);
  pending.resolve();
  assert.equal(await first, true);
  assert.equal(f.storage.value.entries.length, 1);
});

test("stored restore requires selection, fresh read, review and explicit apply", async () => {
  const f = controllerFixture();
  await f.capture();
  await f.save();
  assert.equal(await f.controller.inspectSelected(), true);
  assert.equal(f.controller.state.review.source, "stored");
  assert.equal(await f.controller.apply(f.controller.state.review.id), true);
  assert.equal(f.staged.length, 0);
  assert.equal(f.storage.value.entries.length, 1);
});

test("stored review cannot apply if another tab renamed or archived the entry", async () => {
  for (const kind of ["rename", "archive"]) {
    const f = controllerFixture();
    await f.capture();
    await f.save();
    await f.controller.inspectSelected();
    const reviewId = f.controller.state.review.id;
    const operation = { kind, id: id(1), time: TIME, ...(kind === "rename" ? { label: "Changed elsewhere" } : {}) };
    f.storage.replace(mutateVaultDocument(f.storage.value, 1, operation));
    assert.equal(await f.controller.apply(reviewId), false);
    assert.equal(f.controller.state.error, "TRANSFER_VAULT_STALE");
    assert.equal(f.controller.state.metadata, null);
  }
});

test("archived records are exportable but not restorable until unarchived", async () => {
  const f = controllerFixture();
  await f.capture();
  await f.save();
  await f.controller.editSelected("archive");
  assert.equal(f.controller.state.selectedArchived, true);
  assert.equal(await f.controller.inspectSelected(), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_ARCHIVED");
  assert.ok(await f.controller.prepare("json", true));
  await f.controller.editSelected("unarchive");
  assert.equal(await f.controller.inspectSelected(), true);
});

test("rename, archive and purge affect selected entry only", async () => {
  const f = controllerFixture();
  await f.capture();
  await f.save("One");
  await f.controller.save("Two");
  assert.equal(f.controller.select(id(1)), true);
  assert.equal(await f.controller.editSelected("rename", "Renamed"), true);
  await f.controller.editSelected("archive");
  assert.equal(await f.controller.editSelected("purge", false), false);
  assert.equal(f.storage.value.entries.length, 2);
  assert.equal(await f.controller.editSelected("purge", true), true);
  assert.equal(f.storage.value.entries[0].id, id(2));
  assert.equal(f.controller.state.selectedId, null);
});

for (const kind of ["json", "csv", "txt"]) {
  test("working export " + kind + " does not imply browser persistence", async () => {
    const f = controllerFixture();
    await f.capture();
    const file = await f.controller.prepare(kind);
    assert.ok(file.text.length > 100);
    assert.equal(file.filename.endsWith("." + kind), true);
    assert.equal(f.storage.calls.length, 0);
    assert.equal(f.controller.state.saved, false);
  });
}

test("selected export uses selected saved content, not current working copy", async () => {
  const f = controllerFixture();
  f.setCards(bundleFor(["DAT"]));
  await f.capture();
  await f.save();
  f.setCards(bundleFor());
  await f.capture();
  const file = await f.controller.prepare("json", true);
  assert.equal(JSON.parse(file.text).bundle.slots[1].archive, null);
  assert.ok(f.controller.state.working.slots[1].archive);
});

test("cancelled checksum calculation cannot deliver a file", async () => {
  const pending = deferred();
  const f = controllerFixture({ subtle: { digest: () => pending.promise } });
  await f.capture();
  const exporting = f.controller.prepare();
  f.controller.cancel();
  pending.resolve(new ArrayBuffer(32));
  assert.equal(await exporting, null);
});

test("late rejected file reads do not overwrite cancelled or newer reviews", async () => {
  const pending = deferred();
  const f = controllerFixture();
  const loading = f.controller.load({ name: "file.json", size: 1, arrayBuffer: () => pending.promise });
  f.controller.cancel();
  f.controller.capture();
  const reviewId = f.controller.state.review.id;
  pending.reject(Error("private path"));
  assert.equal(await loading, false);
  assert.equal(f.controller.state.review.id, reviewId);
  assert.equal(f.controller.state.error, null);
});

for (const kind of ["snapshot", "archive"]) {
  test("legacy " + kind + " import changes only its own working slot", async () => {
    const f = controllerFixture();
    f.setCards(bundleFor(["DAT"]));
    await f.capture();
    const archive = archiveFor("EMA");
    const text = kind === "snapshot" ? await encodeTransferFile(archive.records[0]) : (await prepareTransferArchive(archive)).text;
    assert.equal(await f.controller.loadLegacy(fileFromText(text), kind, "EMA"), true);
    await f.controller.apply(f.controller.state.review.id);
    assert.ok(f.controller.state.working.slots[0].archive);
    assert.ok(f.controller.state.working.slots[1].archive);
    assert.equal(f.controller.state.working.slots[2].archive, null);
    assert.equal(f.storage.calls.length, 0);
  });
}

test("legacy token mismatch is refused before any working-copy replacement", async () => {
  const f = controllerFixture();
  const file = fileFromText(await encodeTransferFile(archiveFor("DAT").records[0]));
  assert.equal(await f.controller.loadLegacy(file, "snapshot", "EMA"), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_CONTEXT");
  assert.equal(f.controller.state.hasRecords, false);
});

test("stage-card only stages one selected token and checks current-operation guard", async () => {
  const f = controllerFixture();
  await f.capture();
  assert.equal(await f.controller.stageCard("EMA"), true);
  assert.equal(f.staged.length, 1);
  assert.equal(f.staged[0][0], "EMA");
  assert.equal(f.staged[0][1].records[0].context.agent, "EMA");
  assert.equal(f.staged[0][2].current(), false);
  assert.equal(f.storage.calls.length, 0);
});

test("stage-card refusal preserves historical data and does not report success", async () => {
  const f = controllerFixture({ stageArchive: async () => false });
  await f.capture();
  const key = vaultKey(f.controller.state.working);
  assert.equal(await f.controller.stageCard("DAT"), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_CARD_REVIEW");
  assert.equal(vaultKey(f.controller.state.working), key);
});

test("card invalidation cancels a deferred stage operation", async () => {
  const pending = deferred();
  let guard;
  const f = controllerFixture({ stageArchive: (agent, archive, options) => { guard = options.current; return pending.promise; } });
  await f.capture();
  const staging = f.controller.stageCard("DAT");
  assert.equal(guard(), true);
  f.controller.invalidateCards();
  assert.equal(guard(), false);
  pending.resolve(true);
  assert.equal(await staging, false);
});

test("storage and callback errors do not expose provider messages", async () => {
  const storage = memoryVault();
  storage.read = async () => { throw Error("secret path and password"); };
  const f = controllerFixture({ storage, onChange: () => { throw Error("rendering failure"); } });
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_ACTION");
  assert.equal(JSON.stringify(f.controller.state).includes("password"), false);
});

test("host cancellation from progress callback prevents the storage read", async () => {
  let controller;
  const storage = memoryVault();
  controller = createVaultController({ storage, readCards: () => bundleFor(), stageArchive: async () => true,
    onChange: state => { if (state.busy) controller.cancel(); } });
  assert.equal(await controller.refresh(), false);
  assert.equal(storage.calls.length, 0);
});

test("all public actions after dispose are inert", async () => {
  const f = controllerFixture();
  f.controller.dispose();
  const calls = f.storage.calls.length;
  assert.equal(f.controller.capture(), false);
  assert.equal(await f.controller.refresh(), false);
  assert.equal(await f.controller.save("No"), false);
  assert.equal(await f.controller.prepare(), null);
  assert.equal(await f.controller.apply(1), false);
  assert.equal(f.controller.select(id(1)), false);
  assert.equal(await f.controller.stageCard("DAT"), false);
  f.controller.invalidateCards();
  f.controller.cancel();
  f.controller.dispose();
  assert.equal(f.storage.calls.length, calls);
});
