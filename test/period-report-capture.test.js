import test from "node:test";
import assert from "node:assert/strict";
import { validateReportSelection, validatePeriodReportInput } from "../src/period-report-model.js";
import { validateReportEventQuery } from "../src/period-report-query.js";
import { validateReconciliationWorkspace } from "../src/reconciliation-model.js";
import { validateReconciliationQuery } from "../src/reconciliation-query.js";
import { reportInput, selection } from "./helpers/period-report-fixtures.js";
import { workspace } from "./helpers/reconciliation-fixtures.js";
const ownOnly = value => new Proxy(value, { get() { throw Error("Unexpected live report read"); } });

test("period report selection uses captured source IDs", () => {
  const input = selection();
  assert.deepEqual(validateReportSelection(ownOnly(input)), input);
});
test("period report uses captured envelope and all three source slots", () => {
  const input = reportInput();
  assert.deepEqual(validatePeriodReportInput(ownOnly({ ...input, slots: ownOnly(input.slots.map(row => ownOnly({ ...row }))) })), input);
});
test("period report event query preserves captured search and paging", () => {
  const input = { agent: "DAT", direction: "all", search: "", page: 0 };
  assert.deepEqual(validateReportEventQuery(ownOnly(input)), input);
});
test("reconciliation captures workspace envelope and each agent's evidence slot", () => {
  const input = workspace();
  assert.deepEqual(validateReconciliationWorkspace(ownOnly({ ...input, slots: ownOnly(input.slots.map(row => ownOnly({ ...row }))) })), input);
});
test("reconciliation slot accessors are rejected without execution", () => {
  const input = workspace(), slots = [...input.slots]; let invoked = false;
  Object.defineProperty(slots, "0", { get() { invoked = true; return input.slots[0]; }, enumerable: true });
  assert.throws(() => validateReconciliationWorkspace({ ...input, slots }), { code: "RECONCILIATION_SLOTS" });
  assert.equal(invoked, false);
});
test("reconciliation refuses decorated slot arrays rather than silently ignoring fields", () => {
  const input = workspace(), slots = [...input.slots]; slots.extra = "unused";
  assert.throws(() => validateReconciliationWorkspace({ ...input, slots }), { code: "RECONCILIATION_SLOTS" });
});
test("reconciliation query does not invoke live fields or spread", () => {
  const input = { agent: "all", direction: "all", search: "", page: 0 };
  assert.deepEqual(validateReconciliationQuery(ownOnly(input)), input);
});
test("a reconciliation page cannot exceed the validated bound after capture", () => {
  const input = { agent: "all", direction: "all", search: "", page: 0 }; let reads = 0;
  const changing = new Proxy(input, { get(target, key, receiver) {
    return key === "page" ? ++reads <= 3 ? 0 : Number.MAX_SAFE_INTEGER : Reflect.get(target, key, receiver);
  } });
  assert.equal(validateReconciliationQuery(changing).page, 0); assert.equal(reads, 0);
});
