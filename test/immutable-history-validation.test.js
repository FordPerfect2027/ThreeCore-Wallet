import test from "node:test";
import assert from "node:assert/strict";
import { validateTransferSnapshot } from "../src/transfer-codec.js";
import { validateTransferArchive, addTransferArchiveRecord } from "../src/transfer-archive.js";
import { validateReconciliationWorkspace } from "../src/reconciliation-model.js";
import { validateTokenObservation } from "../src/token-identity-model.js";
import { scenario, workspace, clone, context, record, event, hash } from "./helpers/reconciliation-fixtures.js";
const slot = scenario(), stored = slot.archive;
const cases = [
  ["snapshot", stored.records[0], validateTransferSnapshot, value => { value.completeHistory = true; }, value => { value.events[0].amountBaseUnits = "-1"; }],
  ["archive", stored, validateTransferArchive, value => { value.completeHistory = true; }, value => { value.records[0].events[0].amountBaseUnits = "-1"; }],
  ["reconciliation", workspace([slot]), validateReconciliationWorkspace, value => { value.readOnly = false; }, value => { value.slots[0].earlier.balanceBaseUnits = "-1"; }],
  ["observation", slot.earlier, validateTokenObservation, value => { value.securityAudit = true; }, value => { value.metadata.decimals = -1; }],
];
function assertDeepFrozen(value) {
  if (value && typeof value === "object") {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertDeepFrozen(child);
  }
}
for (const [name, source, validate, invalidate, invalidateChild] of cases) {
  test(name + " reuses only its own fully validated immutable snapshot", () => {
    const own = validate(clone(source)); assertDeepFrozen(own);
    for (let i = 0; i < 20; i++) assert.equal(validate(own), own);
    const external = Object.freeze(clone(source)); assert.notEqual(validate(external), external);
    assert.deepEqual(validate(external), own);
  });
  test(name + " mutable caller input is never cached as valid", () => {
    const input = clone(source), own = validate(input), before = JSON.stringify(own);
    invalidate(input); assert.throws(() => validate(input)); assert.equal(JSON.stringify(own), before);
  });
  test(name + " a frozen wrapper cannot hide changed nested data", () => {
    const input = Object.freeze(clone(source)); validate(input);
    invalidateChild(input); assert.throws(() => validate(input));
  });
  test(name + " proxies and revoked proxies do not inherit snapshot identity", () => {
    const own = validate(clone(source)); let traps = 0;
    assert.throws(() => validate(new Proxy(own, { getOwnPropertyDescriptor() { traps++; throw Error("PRIVATE_PROXY"); } })),
      error => !error.message.includes("PRIVATE_PROXY"));
    assert.ok(traps > 0); const revoked = Proxy.revocable(own, {}); revoked.revoke();
    assert.throws(() => validate(revoked.proxy)); assert.equal(validate(own), own);
  });
}
test("individually valid cached records still undergo cross-record context, duplicate and overlap checks", () => {
  const first = validateTransferSnapshot(record(30, 42, [event({ blockNumber: "35", blockHash: hash(35) }, 1)]));
  const archive = addTransferArchiveRecord(null, first);
  assert.throws(() => addTransferArchiveRecord(archive, first), error => error.code === "TRANSFER_ARCHIVE_DUPLICATE_RANGE");
  const another = validateTransferSnapshot(record(43, 44, [], context("EMA")));
  assert.throws(() => addTransferArchiveRecord(archive, another), error => error.code === "TRANSFER_ARCHIVE_CONTEXT");
  const overlap = validateTransferSnapshot(record(34, 43, []));
  assert.throws(() => addTransferArchiveRecord(archive, overlap), error => error.code === "TRANSFER_ARCHIVE_OVERLAP");
  assert.equal(validateTransferArchive(archive), archive);
});
test("cached observations retain metadata mismatch and missing-code facts", () => {
  const mismatch = clone(slot.earlier); mismatch.metadata.name = "Different token";
  const own = validateTokenObservation(mismatch); assert.equal(own.metadata.name, "Different token");
  const missing = validateTokenObservation({ ...slot.earlier, hasCode: false, metadata: null, balanceBaseUnits: null });
  assert.equal(validateTokenObservation(missing), missing); assert.equal(missing.balanceBaseUnits, null);
});
