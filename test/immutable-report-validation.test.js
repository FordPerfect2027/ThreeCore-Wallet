import test from "node:test";
import assert from "node:assert/strict";
import { validatePeriodDraft } from "../src/period-draft.js";
import { validatePeriodReportInput } from "../src/period-report-model.js";
import { validateReportHistory } from "../src/report-history-model.js";
import { validateReportSet } from "../src/report-set-model.js";
import { sequenceHistory, sequenceSet, clone } from "./helpers/report-set-fixtures.js";
const history = sequenceHistory(), set = sequenceSet(history), report = set.entries[0].report;
const cases = [
  ["period draft", report.slots[0].entry.draft, validatePeriodDraft, value => { value.readOnly = false; }, value => { value.records[0].events[0].amountBaseUnits = "-1"; }],
  ["period report", report, validatePeriodReportInput, value => { value.historicalOnly = false; }, value => { value.slots[0].entry.draft.readOnly = false; }],
  ["report history", history, validateReportHistory, value => { value.revision = -1; }, value => { value.entries[0].report.historicalOnly = false; }],
  ["report set", set, validateReportSet, value => { value.historicalOnly = false; }, value => { value.entries[0].report.historicalOnly = false; }],
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
    const external = Object.freeze(clone(source));
    assert.notEqual(validate(external), external);
    assert.deepEqual(validate(external), own);
  });
  test(name + " never trusts a previously observed mutable caller object", () => {
    const input = clone(source), snapshot = validate(input), before = JSON.stringify(snapshot);
    invalidate(input); assert.throws(() => validate(input));
    assert.equal(JSON.stringify(snapshot), before);
  });
  test(name + " a frozen outer object cannot conceal invalid mutable nested evidence", () => {
    const input = Object.freeze(clone(source));
    validate(input); invalidateChild(input); assert.throws(() => validate(input));
  });
  test(name + " proxy wrappers cannot borrow validated object identity", () => {
    const own = validate(clone(source)); let traps = 0;
    const wrapper = new Proxy(own, { getOwnPropertyDescriptor() { traps++; throw Error("PRIVATE_PROXY"); } });
    assert.throws(() => validate(wrapper), error => !error.message.includes("PRIVATE_PROXY"));
    assert.ok(traps > 0);
    const revoked = Proxy.revocable(own, {}); revoked.revoke(); assert.throws(() => validate(revoked.proxy));
    assert.equal(validate(own), own);
  });
}
