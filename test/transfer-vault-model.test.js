import test from "node:test";
import assert from "node:assert/strict";
import { VAULT_AGENTS, VAULT_BUNDLE_SCHEMA, VAULT_DOCUMENT_SCHEMA, vaultArray, vaultBundle, vaultHasRecords, vaultKey,
  validateVaultBundle, captureTransferArchive, describeVaultBundle, reviewVaultReplacement, mergeVaultBundles,
  emptyVaultDocument, validateVaultDocument, mutateVaultDocument, vaultMetadata, vaultLabel, vaultTime, vaultId } from "../src/transfer-vault-model.js";
import { addTransferArchiveRecord } from "../src/transfer-archive.js";
import { clone, code, context, snapshot, OTHER } from "./helpers/transfer-fixtures.js";
import { archiveFor, bundleFor, corruptBundle, id, saveOperation, TIME } from "./helpers/vault-fixtures.js";

test("vault bundle records absence explicitly for all three agents", () => {
  const empty = vaultBundle();
  assert.equal(empty.schema, VAULT_BUNDLE_SCHEMA);
  assert.deepEqual(empty.slots.map(row => row.agent), VAULT_AGENTS);
  assert.equal(vaultHasRecords(empty), false);
  assert.equal(Object.isFrozen(empty.slots), true);
  assert.deepEqual(describeVaultBundle(empty), VAULT_AGENTS.map(agent => ({ agent, present: false })));
});

for (const agent of VAULT_AGENTS) {
  for (const chainId of [8453, 84532]) {
    test(`vault preserves ${agent} on ${chainId} without another token's amounts`, () => {
      const input = bundleFor([agent], { chainId });
      const result = validateVaultBundle(input);
      const row = describeVaultBundle(result).find(row => row.agent === agent);
      assert.equal(row.present, true);
      assert.equal(row.context.chainId, chainId);
      assert.equal(row.uniqueEvents, 1);
      assert.equal(row.completeHistory, false);
      assert.equal(row.independentlyVerified, false);
      assert.equal(vaultHasRecords(result), true);
      assert.equal(Object.isFrozen(result.slots[VAULT_AGENTS.indexOf(agent)].archive.records), true);
    });
  }
}

const invalidBundles = [
  ["unknown root field", value => { value.password = "unwanted"; }, "TRANSFER_SHAPE"],
  ["schema", value => { value.schema = "wrong"; }, "TRANSFER_VAULT_SCHEMA"],
  ["signing capability", value => { value.readOnly = false; }, "TRANSFER_VAULT_SCHEMA"],
  ["completeness claim", value => { value.completeHistory = true; }, "TRANSFER_VAULT_SCHEMA"],
  ["reordered agents", value => { value.slots.reverse(); }, "TRANSFER_VAULT_SLOTS"],
  ["missing agent", value => { value.slots.pop(); }, "TRANSFER_VAULT_SLOTS"],
  ["extra agent", value => { value.slots.push(value.slots[0]); }, "TRANSFER_VAULT_ARRAY"],
  ["duplicate agent", value => { value.slots[1] = value.slots[0]; }, "TRANSFER_VAULT_SLOTS"],
  ["wrong token in slot", value => { value.slots[0].archive = value.slots[1].archive; }, "TRANSFER_VAULT_CONTEXT"],
  ["extra authority in slot", value => { value.slots[0].provider = "rpc"; }, "TRANSFER_SHAPE"],
  ["missing archive sentinel", value => { delete value.slots[0].archive; }, "TRANSFER_SHAPE"],
  ["unknown archive field", value => { value.slots[0].archive.autoConnect = true; }, "TRANSFER_SHAPE"],
  ["bad public address", value => { value.slots[0].archive.records[0].context.account = "0x11"; }, "TRANSFER_ADDRESS"],
  ["wrong chain", value => { value.slots[0].archive.records[0].context.chainId = 1; }, "TRANSFER_CONTEXT"],
  ["duplicate ranges", value => { value.slots[0].archive.records.push(value.slots[0].archive.records[0]); }, "TRANSFER_ARCHIVE_DUPLICATE_RANGE"],
  ["unsupported array property", value => { value.slots.extra = true; }, "TRANSFER_VAULT_ARRAY"],
];
for (const [name, mutate, expected] of invalidBundles) {
  test("vault refuses " + name, () => {
    assert.throws(() => validateVaultBundle(corruptBundle(mutate)), code(expected));
  });
}

test("vault root and array accessors are rejected without invoking them", () => {
  let invoked = 0;
  const input = clone(bundleFor());
  Object.defineProperty(input, "slots", { get() { invoked++; return []; } });
  assert.throws(() => validateVaultBundle(input), code("TRANSFER_SHAPE"));
  const array = [null, null, null];
  Object.defineProperty(array, "0", { get() { invoked++; return null; } });
  assert.throws(() => vaultBundle(array), code("TRANSFER_VAULT_ARRAY"));
  assert.equal(invoked, 0);
});

for (const array of [null, {}, "[]", new Array(3), Object.assign([], { hidden: 1 })]) {
  test("vault rejects non-dense slot collection " + JSON.stringify(array), () => {
    assert.throws(() => vaultArray(array, 3), code("TRANSFER_VAULT_ARRAY"));
  });
}

test("canonical copies are isolated from later source mutation", () => {
  const input = clone(bundleFor());
  const stored = validateVaultBundle(input);
  const key = vaultKey(stored);
  input.slots[0].archive.records[0].events[0].amountBaseUnits = "99";
  assert.equal(vaultKey(stored), key);
  assert.notEqual(vaultKey(input), key);
});

test("capture retains an existing archive when no current observation exists", () => {
  const archive = archiveFor();
  assert.deepEqual(captureTransferArchive(archive, null), archive);
  assert.equal(captureTransferArchive(null, null), null);
});

test("capture turns an observation into one original period", () => {
  const row = snapshot();
  const result = captureTransferArchive(null, row);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], row);
});

test("capture deduplicates an identical period but refuses changed values", () => {
  const archive = archiveFor();
  assert.deepEqual(captureTransferArchive(archive, archive.records[0]), archive);
  const changed = clone(archive.records[0]);
  changed.events[0].amountBaseUnits = "7";
  assert.throws(() => captureTransferArchive(archive, changed), code("TRANSFER_VAULT_RANGE_CONFLICT"));
  assert.equal(archive.records.length, 1);
});

test("capture adds a nonoverlapping period without changing the first", () => {
  const first = archiveFor(), next = archiveFor("DAT", { start: 43, end: 55 });
  const result = captureTransferArchive(first, next.records[0]);
  assert.equal(result.records.length, 2);
  assert.equal(first.records.length, 1);
  assert.deepEqual(result.records[0], first.records[0]);
});

test("capture rejects a different account even with valid records", () => {
  assert.throws(() => captureTransferArchive(archiveFor(), archiveFor("DAT", { account: OTHER }).records[0]), code("TRANSFER_VAULT_CONTEXT"));
});

test("additive merge is idempotent and fills only missing slots", () => {
  const first = bundleFor(["DAT"]), second = bundleFor(["EMA", "CAWELON"]);
  const merged = mergeVaultBundles(first, second);
  assert.deepEqual(merged, bundleFor());
  assert.deepEqual(mergeVaultBundles(merged, first), merged);
  assert.equal(first.slots[1].archive, null);
});

test("merge rejects one conflicting token atomically", () => {
  const before = bundleFor(["DAT"]);
  const incoming = bundleFor();
  const conflict = clone(incoming);
  conflict.slots[0].archive.records[0].events[0].amountBaseUnits = "1";
  const key = vaultKey(before);
  assert.throws(() => mergeVaultBundles(before, conflict), code("TRANSFER_VAULT_RANGE_CONFLICT"));
  assert.equal(vaultKey(before), key);
  assert.equal(before.slots[1].archive, null);
});

test("overlapping periods must agree on all events in the overlap", () => {
  const first = archiveFor("DAT", { start: 30, end: 42 });
  const missing = archiveFor("DAT", { start: 40, end: 50, count: 0 });
  assert.throws(() => captureTransferArchive(first, missing.records[0]), code("TRANSFER_ARCHIVE_OVERLAP"));
});

test("replacement review reports removals and account changes explicitly", () => {
  const before = bundleFor(), after = bundleFor(["DAT"], { account: OTHER });
  const review = reviewVaultReplacement(before, after);
  assert.equal(review.removesRecords, true);
  assert.equal(review.changes[0].contextChanged, true);
  assert.equal(review.changes[1].removed, 1);
  assert.equal(review.changes[1].added, 0);
  assert.equal(review.beforeKey, vaultKey(before));
  assert.equal(review.unchanged, false);
});

test("replacement review distinguishes empty, additive, identical and removed data", () => {
  assert.equal(reviewVaultReplacement(vaultBundle(), vaultBundle()).unchanged, true);
  assert.equal(reviewVaultReplacement(vaultBundle(), bundleFor()).removesRecords, false);
  assert.equal(reviewVaultReplacement(bundleFor(), bundleFor()).unchanged, true);
  assert.equal(reviewVaultReplacement(bundleFor(), vaultBundle()).changes.reduce((n, row) => n + row.removed, 0), 3);
});

test("new local document does not share the existing checkpoint schema", () => {
  assert.deepEqual(emptyVaultDocument(), { schema: VAULT_DOCUMENT_SCHEMA, revision: 0, entries: [] });
  assert.equal(vaultMetadata(emptyVaultDocument()).remaining, 5);
});

test("save creates an immutable revision and includes all three histories", () => {
  const before = emptyVaultDocument();
  const after = mutateVaultDocument(before, 0, saveOperation());
  assert.equal(after.revision, 1);
  assert.equal(after.entries[0].id, id(1));
  assert.equal(after.entries[0].createdAt, TIME);
  assert.equal(after.entries[0].archived, false);
  assert.deepEqual(vaultMetadata(after).entries[0].agents, VAULT_AGENTS);
  assert.equal(before.entries.length, 0);
  assert.equal(Object.isFrozen(after.entries[0].bundle), true);
});

for (const expected of [null, -1, 1, 0.5, "0", NaN, Infinity]) {
  test("save rejects stale or invalid revision " + String(expected), () => {
    assert.throws(() => mutateVaultDocument(emptyVaultDocument(), expected, saveOperation()), code("TRANSFER_VAULT_STALE"));
  });
}

test("duplicate identifiers cannot overwrite saved data", () => {
  const saved = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
  assert.throws(() => mutateVaultDocument(saved, 1, saveOperation(bundleFor(["DAT"]))), code("TRANSFER_VAULT_DUPLICATE"));
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].bundle.slots.filter(row => row.archive).length, 3);
});

test("capacity includes archived entries and never evicts an old record", () => {
  let doc = emptyVaultDocument();
  for (let i = 1; i <= 5; i++) doc = mutateVaultDocument(doc, doc.revision, saveOperation(bundleFor(["DAT"]), i));
  doc = mutateVaultDocument(doc, doc.revision, { kind: "archive", id: id(1), time: TIME });
  assert.throws(() => mutateVaultDocument(doc, doc.revision, saveOperation(bundleFor(), 6)), code("TRANSFER_VAULT_CAPACITY"));
  assert.equal(doc.entries[0].id, id(1));
  assert.equal(vaultMetadata(doc).remaining, 0);
});

test("rename trims text, does not alter contents, and clamps backward clock movement", () => {
  const saved = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
  const renamed = mutateVaultDocument(saved, 1, { kind: "rename", id: id(1), label: "  After review  ", time: "2026-10-22T01:00:00.000Z" });
  assert.equal(renamed.entries[0].label, "After review");
  assert.equal(renamed.entries[0].updatedAt, TIME);
  assert.deepEqual(renamed.entries[0].bundle, saved.entries[0].bundle);
  assert.equal(renamed.entries[0].createdAt, TIME);
});

test("no-op renames and repeated archive operations retain revision", () => {
  const saved = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
  assert.equal(mutateVaultDocument(saved, 1, { kind: "rename", id: id(1), label: "Local history", time: TIME }).revision, 1);
  const hidden = mutateVaultDocument(saved, 1, { kind: "archive", id: id(1), time: TIME });
  assert.equal(mutateVaultDocument(hidden, 2, { kind: "archive", id: id(1), time: TIME }).revision, 2);
  const restored = mutateVaultDocument(hidden, 2, { kind: "unarchive", id: id(1), time: TIME });
  assert.equal(restored.entries[0].archived, false);
  assert.equal(restored.revision, 3);
});

for (const confirmed of [false, 1, "true", null]) {
  test("purge requires literal true acknowledgement " + String(confirmed), () => {
    let saved = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
    saved = mutateVaultDocument(saved, 1, { kind: "archive", id: id(1), time: TIME });
    assert.throws(() => mutateVaultDocument(saved, 2, { kind: "purge", id: id(1), confirmed }), code("TRANSFER_VAULT_CONFIRMATION"));
  });
}

test("only an archived entry can be purged after explicit confirmation", () => {
  const saved = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
  assert.throws(() => mutateVaultDocument(saved, 1, { kind: "purge", id: id(1), confirmed: true }), code("TRANSFER_VAULT_CONFIRMATION"));
  const archived = mutateVaultDocument(saved, 1, { kind: "archive", id: id(1), time: TIME });
  const removed = mutateVaultDocument(archived, 2, { kind: "purge", id: id(1), confirmed: true });
  assert.equal(removed.entries.length, 0);
  assert.equal(removed.revision, 3);
  assert.equal(saved.entries.length, 1);
});

for (const label of ["", " ", "a".repeat(61), "a\nb", "a\u202eb", 1, null]) {
  test("invalid local label " + JSON.stringify(label), () => assert.throws(() => vaultLabel(label), code("TRANSFER_VAULT_LABEL")));
}
for (const value of ["2026-02-30T00:00:00.000Z", TIME.slice(0, 19) + "Z", "now", null]) {
  test("invalid local timestamp " + value, () => assert.throws(() => vaultTime(value), code("TRANSFER_VAULT_TIME")));
}
for (const value of ["1", id(1).replace("4000", "5000"), id(1).toUpperCase().replace("1000", "ABCD"), null]) {
  test("invalid local identifier " + value, () => assert.throws(() => vaultId(value), code("TRANSFER_VAULT_ID")));
}

test("invalid persisted documents do not get silently reset", () => {
  const saved = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
  const cases = [
    { ...saved, schema: "threecore-local-checkpoints-v1" },
    { ...saved, revision: -1 },
    { ...saved, entries: [saved.entries[0], saved.entries[0]] },
    { ...saved, entries: [{ ...saved.entries[0], label: " untrimmed " }] },
    { ...saved, entries: [{ ...saved.entries[0], archived: "false" }] },
    { ...saved, entries: [{ ...saved.entries[0], updatedAt: "2025-01-01T00:00:00.000Z" }] },
    { ...saved, entries: [{ ...saved.entries[0], bundle: vaultBundle() }] },
  ];
  for (const invalid of cases) assert.throws(() => validateVaultDocument(invalid));
  assert.equal(saved.entries.length, 1);
});

test("unknown operations and accessor kinds never cause mutations", () => {
  let invoked = 0;
  assert.throws(() => mutateVaultDocument(emptyVaultDocument(), 0, { kind: "replace-all" }), code("TRANSFER_VAULT_OPERATION"));
  assert.throws(() => mutateVaultDocument(emptyVaultDocument(), 0, { get kind() { invoked++; return "save"; } }), code("TRANSFER_VAULT_OPERATION"));
  assert.equal(invoked, 0);
});

test("missing saved record and revision exhaustion fail explicitly", () => {
  assert.throws(() => mutateVaultDocument(emptyVaultDocument(), 0, { kind: "archive", id: id(1), time: TIME }), code("TRANSFER_VAULT_MISSING"));
  const fullRevision = { ...emptyVaultDocument(), revision: Number.MAX_SAFE_INTEGER };
  assert.throws(() => mutateVaultDocument(fullRevision, fullRevision.revision, saveOperation()), code("TRANSFER_VAULT_REVISION"));
});
