import test from "node:test";
import assert from "node:assert/strict";
import { validateTransferArchive } from "../src/transfer-archive.js";
import { validateVaultBundle, validateVaultDocument, vaultBundle, emptyVaultDocument, mutateVaultDocument, vaultArray } from "../src/transfer-vault-model.js";
import { validateActivityQuery } from "../src/transfer-vault-analytics.js";
import { validateTransferQuery } from "../src/transfer-view.js";
import { archiveFor, bundleFor, saveOperation, TIME } from "./helpers/vault-fixtures.js";

const ownOnly = value => new Proxy(value, { get() { throw Error("Unexpected live data read"); } });

test("history archive captures its envelope and records before sorting", () => {
  const input = archiveFor();
  assert.deepEqual(validateTransferArchive(ownOnly({ ...input, records: ownOnly([...input.records]) })), input);
});

test("archive array cannot replace all observed events through its own map method", () => {
  const input = archiveFor(); let invoked = false;
  const records = [...input.records];
  records.map = () => { invoked = true; return [{ ...input.records[0], events: [] }]; };
  assert.throws(() => validateTransferArchive({ ...input, records }), { code: "TRANSFER_ARCHIVE_LIMIT" });
  assert.equal(invoked, false);
});

test("archive array accessors fail without running", () => {
  const input = archiveFor(); let invoked = false;
  const records = [];
  Object.defineProperty(records, "0", { get() { invoked = true; return input.records[0]; }, enumerable: true });
  assert.throws(() => validateTransferArchive({ ...input, records }), { code: "TRANSFER_ARCHIVE_LIMIT" });
  assert.equal(invoked, false);
});

test("vault array helper returns a detached immutable data snapshot", () => {
  const source = [null], result = vaultArray(source, 3);
  source[0] = "changed";
  assert.deepEqual(result, [null]); assert(Object.isFrozen(result));
});

test("vault bundle captures all three slots and their own agent labels", () => {
  const input = bundleFor();
  const value = ownOnly({ ...input, slots: ownOnly(input.slots.map(slot => ownOnly({ ...slot }))) });
  assert.deepEqual(validateVaultBundle(value), input);
});

test("vault bundle constructor never reads input array methods or indexes live", () => {
  const archives = [archiveFor(), null, null];
  assert.deepEqual(vaultBundle(ownOnly(archives)), vaultBundle(archives));
});

test("vault stored document uses captured revision, entries and row flags", () => {
  const input = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
  assert.deepEqual(validateVaultDocument(ownOnly({ ...input, entries: ownOnly(input.entries.map(row => ownOnly({ ...row }))) })), input);
});

test("vault save mutation uses the exact captured operation", () => {
  const operation = saveOperation();
  assert.deepEqual(mutateVaultDocument(emptyVaultDocument(), 0, ownOnly(operation)),
    mutateVaultDocument(emptyVaultDocument(), 0, operation));
});

test("vault rename does not substitute a second label during mutation", () => {
  const input = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
  const operation = { kind: "rename", id: input.entries[0].id, label: "Reviewed name", time: TIME };
  assert.equal(mutateVaultDocument(input, 1, ownOnly(operation)).entries[0].label, operation.label);
});

test("vault mutation rejects an operation whose kind changes during descriptor capture", () => {
  const input = saveOperation(); let reads = 0;
  const changing = new Proxy(input, { getOwnPropertyDescriptor(target, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    return key === "kind" && ++reads > 1 ? { ...descriptor, value: "purge" } : descriptor;
  } });
  assert.throws(() => mutateVaultDocument(emptyVaultDocument(), 0, changing), { code: "TRANSFER_VAULT_OPERATION" });
});

test("vault mutation maps a revoked operation to its public operation error", () => {
  const { proxy, revoke } = Proxy.revocable(saveOperation(), {}); revoke();
  assert.throws(() => mutateVaultDocument(emptyVaultDocument(), 0, proxy), { code: "TRANSFER_VAULT_OPERATION" });
});

test("history and activity queries retain bounded own values without live spreads", () => {
  const single = { direction: "all", search: "", order: "newest", page: 0, pageSize: 10 };
  const all = { ...single, agent: "all" };
  assert.deepEqual(validateTransferQuery(ownOnly(single)), single);
  assert.deepEqual(validateActivityQuery(ownOnly(all)), all);
});

for (const [name, validate, query] of [
  ["history", validateTransferQuery, { direction: "all", search: "", order: "newest", page: 0, pageSize: 10 }],
  ["vault activity", validateActivityQuery, { agent: "all", direction: "all", search: "", order: "newest", page: 0, pageSize: 10 }],
]) {
  test(name + " page size cannot become unbounded after validation", () => {
    let reads = 0;
    const input = new Proxy(query, { get(target, key, receiver) {
      return key === "pageSize" ? ++reads <= 3 ? 10 : Number.MAX_SAFE_INTEGER : Reflect.get(target, key, receiver);
    } });
    assert.equal(validate(input).pageSize, 10); assert.equal(reads, 0);
  });
}
