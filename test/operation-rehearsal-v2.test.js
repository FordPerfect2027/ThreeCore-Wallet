import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExample, rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { evaluateRehearsal as evaluate, validateRehearsal, encodeRehearsal, decodeRehearsal, REHEARSAL_SCHEMA_V2 } from "../src/operation-rehearsal.js";

const clone = (agent = "DAT", scenario = "profit") => JSON.parse(encodeRehearsal(rehearsalExampleV2(agent, scenario)));
const event = (d, kind, fields = {}) => ({ id: kind + "-" + d.events.length, kind,
  agent: d.agent, chainId: d.chainId, account: d.account, ...fields });
const append = (d, kind, fields) => { d.events.push(event(d, kind, fields)); return evaluate(d); };
const rejected = (report, reason) => assert.ok(report.rows.at(-1).reasons.includes(reason));

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test(agent + " v2 reserves exit fees without treating them as an expense", () => {
    const r = evaluate(clone(agent, "pending"));
    assert.equal(r.cash, "899000000"); assert.equal(r.availableCash, "897000000");
    assert.equal(r.reservedExitFees, "2000000"); assert.equal(r.realizedPnl, "-1000000");
    assert.equal(r.positions[0].exitFeeReserve, "2000000");
  });
  test(agent + " v2 settlement releases fee reserve and counts actual fees once", () => {
    const r = evaluate(clone(agent));
    assert.equal(r.cash, "1028000000"); assert.equal(r.realizedPnl, "28000000");
    assert.equal(r.reservedExitFees, "0"); assert.equal(r.fees, "2000000");
    assert.equal(r.positions.length, 0);
  });
  test(agent + " reservation cannot allocate the same profit twice", () => {
    const d = clone(agent);
    const r = append(d, "reserve", { reservationId: "first", amount: "2800000" });
    assert.equal(r.cash, "1028000000"); assert.equal(r.realizedPnl, "28000000");
    assert.equal(r.reservedAllocations, "2800000"); assert.equal(r.availableCash, "1025200000");
    assert.equal(r.proposedOwnTokenBuybackBudget, "0");
    rejected(append(d, "reserve", { reservationId: "second", amount: "1" }), "ALLOCATION_LIMIT");
  });
  test(agent + " released reservation restores remaining budget without increasing profit", () => {
    const d = clone(agent); append(d, "reserve", { reservationId: "first", amount: "2800000" });
    const r = append(d, "release", { reservationId: "first" });
    assert.equal(r.reservedAllocations, "0"); assert.equal(r.proposedOwnTokenBuybackBudget, "2800000");
    assert.equal(r.realizedPnl, "28000000");
    rejected(append(d, "release", { reservationId: "first" }), "NO_RESERVATION");
  });
}
for (const [label, change, expected] of [
  ["entry fees", d => { d.events[0].fee = "3000001"; }, "ENTRY_FEE_LIMIT"],
  ["exit fee ceiling", d => { d.events[0].exitFeeReserve = "5000001"; }, "EXIT_FEE_LIMIT"],
  ["fee reserve cash", d => { d.policy.reserveFloor = "898000000"; }, "RESERVE_FLOOR"],
  ["fee reserve loss budget", d => { d.policy.lossLimit = "102999999"; }, "LOSS_LIMIT"],
]) test(label + " is checked before accepting principal", () => {
  const d = clone("DAT", "pending"); change(d); const r = evaluate(d); rejected(r, expected);
  assert.equal(r.cash, "1000000000"); assert.equal(r.reservedExitFees, "0");
});
test("settlement beyond reserved fee is rejected and the position stays unresolved", () => {
  const d = clone(); d.events[1].fee = "2000001"; const r = evaluate(d);
  rejected(r, "EXIT_FEE_RESERVE_EXCEEDED"); assert.equal(r.outstanding, "100000000");
  assert.equal(r.reservedExitFees, "2000000");
});
test("withdrawal cannot spend reserved exit fees or reserved allocation", () => {
  const d = clone("DAT", "pending");
  rejected(append(d, "withdraw", { amount: "698000000" }), "RESERVE_FLOOR");
  const a = clone(); append(a, "reserve", { reservationId: "r", amount: "2800000" });
  rejected(append(a, "withdraw", { amount: "826000000" }), "RESERVE_FLOOR");
});
test("opening cannot spend money reserved for allocation", () => {
  const a = clone(); append(a, "reserve", { reservationId: "r", amount: "2800000" });
  append(a, "withdraw", { amount: "724000000" });
  const open = { ...a.events[0], id: "next", operationId: "next" };
  a.events.push(open); rejected(evaluate(a), "RESERVE_FLOOR");
});
test("reservation is unavailable for unresolved positions, paused policies and rejected histories", () => {
  const d = clone("DAT", "pending"); rejected(append(d, "reserve", { reservationId: "r", amount: "1" }), "UNSETTLED_POSITIONS");
  const p = clone(); p.policy.paused = true; rejected(append(p, "reserve", { reservationId: "r", amount: "1" }), "PAUSED");
  const r = clone("DAT", "limit"); rejected(append(r, "reserve", { reservationId: "r", amount: "1" }), "REJECTED_RECORDS");
});
test("reservation ids cannot be reused after release; foreign scopes cannot release", () => {
  const d = clone(); append(d, "reserve", { reservationId: "r", amount: "1" });
  const foreign = event(d, "release", { reservationId: "r", agent: "EMA" }); d.events.push(foreign);
  rejected(evaluate(d), "WRONG_AGENT"); assert.equal(evaluate(d).reservedAllocations, "1");
  d.events.pop(); append(d, "release", { reservationId: "r" });
  rejected(append(d, "reserve", { reservationId: "r", amount: "1" }), "REUSED_RESERVATION");
});
test("a later loss flags a reservation exceeding the remaining profit quota", () => {
  const d = clone(); append(d, "reserve", { reservationId: "r", amount: "2800000" });
  d.events.push({ ...d.events[0], id: "open-two", operationId: "two" });
  d.events.push({ ...d.events[1], id: "settle-two", operationId: "two", grossReturn: "60000000" });
  const r = evaluate(d); assert.equal(r.realizedPnl, "-14000000");
  assert.equal(r.allocationShortfall, "2800000"); assert.ok(r.allocationBlockers.includes("ALLOCATION_OVERCOMMITTED"));
  const cleared = append(d, "release", { reservationId: "r" });
  assert.equal(cleared.allocationShortfall, "0"); assert.equal(cleared.proposedOwnTokenBuybackBudget, "0");
});
test("v1 files preserve their policy and are not silently migrated", () => {
  const d = rehearsalExample(); const loaded = decodeRehearsal(encodeRehearsal(d));
  assert.deepEqual(loaded, d); assert.equal(evaluate(loaded).realizedPnl, "28000000");
  assert.equal(evaluate(loaded).reservedExitFees, "0");
  const invalid = JSON.parse(encodeRehearsal(d)); invalid.events.push(event(invalid, "reserve", { reservationId: "r", amount: "1" }));
  assert.throws(() => validateRehearsal(invalid), { code: "INVALID_KIND" });
});
test("v2 fields are mandatory and strictly typed", () => {
  const d = clone(); delete d.policy.maxEntryFee; assert.throws(() => validateRehearsal(d), { code: "INVALID_STRUCTURE" });
  const e = clone(); delete e.events[0].exitFeeReserve; assert.throws(() => validateRehearsal(e), { code: "INVALID_STRUCTURE" });
  const f = clone(); f.policy.maxEntryFee = 1; assert.throws(() => validateRehearsal(f), { code: "INVALID_AMOUNT" });
  assert.equal(decodeRehearsal(encodeRehearsal(clone())).schema, REHEARSAL_SCHEMA_V2);
});
test("export refuses a structurally valid input that exceeds the import byte limit", () => {
  const d = clone(); const origin = "https://" + ("a".repeat(60) + ".").repeat(3) + "b".repeat(50) + ".com";
  d.policy.origin = origin;
  d.events = Array.from({ length: 200 }, (_, i) => ({ ...d.events[0], origin,
    id: "e" + String(i).padStart(63, "0"), operationId: "o" + String(i).padStart(63, "0") }));
  validateRehearsal(d); assert.throws(() => encodeRehearsal(d), { code: "FILE_TOO_LARGE" });
});
