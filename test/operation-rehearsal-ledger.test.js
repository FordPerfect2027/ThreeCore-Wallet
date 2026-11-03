import test from "node:test";
import assert from "node:assert/strict";
import { createRehearsalLedger, rehearsalCsv } from "../src/operation-rehearsal-ledger.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { evaluateRehearsal, encodeRehearsal } from "../src/operation-rehearsal.js";
const event = (id = "reserve-1", fields = {}) => ({ id, kind: "reserve", agent: "DAT", chainId: 84532,
  account: "0x" + "1".repeat(40), reservationId: id, amount: "1000000", ...fields });
const ledger = () => { const l = createRehearsalLedger(); l.reset(rehearsalExampleV2()); return l; };

test("preview does not mutate the ledger and apply is single-use", () => {
  const l = ledger(), before = l.state().current, r = l.preview(event());
  assert.equal(l.state().current, before); assert.equal(r.accepted, true);
  assert.equal(r.after.reservedAllocations, "1000000"); assert.equal(l.state().canUndo, false);
  l.commit(r); assert.equal(l.state().current.events.length, 3); assert.equal(l.state().canUndo, true);
  assert.throws(() => l.commit(r), { code: "STALE_REVIEW" });
});
test("a new preview invalidates the previous review", () => {
  const l = ledger(), old = l.preview(event()), latest = l.preview(event("reserve-2"));
  assert.throws(() => l.commit(old), { code: "STALE_REVIEW" }); l.commit(latest);
  assert.equal(l.state().current.events.at(-1).id, "reserve-2");
});
for (const action of ["cancel", "clear", "reset", "dispose"]) test(action + " revokes the pending review", () => {
  const l = ledger(), r = l.preview(event());
  action === "reset" ? l.reset(rehearsalExampleV2("EMA")) : l[action]();
  assert.throws(() => l.commit(r), { code: action === "dispose" ? "LEDGER_DISPOSED" : "STALE_REVIEW" });
});
test("malformed preview cancels an earlier valid review", () => {
  const l = ledger(), r = l.preview(event());
  assert.throws(() => l.preview({ ...event(), amount: "1e6" }));
  assert.throws(() => l.commit(r), { code: "STALE_REVIEW" });
});
test("undo restores exact prior inputs including reserved money and cancels pending work", () => {
  const l = ledger(), original = encodeRehearsal(l.state().current);
  l.commit(l.preview(event())); const r = l.preview(event("r2"));
  assert.equal(encodeRehearsal(l.undo()), original);
  assert.equal(evaluateRehearsal(l.state().current).reservedAllocations, "0");
  assert.throws(() => l.commit(r), { code: "STALE_REVIEW" }); assert.throws(() => l.undo(), { code: "NO_UNDO" });
});
test("undo keeps only ten checkpoints; reset prevents cross-agent undo", () => {
  const l = ledger();
  for (let i = 0; i < 12; i++) {
    const { reservationId, ...record } = event("deposit-" + i, { kind: "deposit", amount: "1" });
    l.commit(l.preview(record));
  }
  assert.equal(l.state().undoCount, 10);
  for (let i = 0; i < 10; i++) l.undo();
  assert.equal(l.state().current.events.length, 4);
  assert.throws(() => l.undo(), { code: "NO_UNDO" });
  l.reset(rehearsalExampleV2("EMA")); assert.equal(l.state().canUndo, false);
});
test("rejected business proposals are visible and require explicit commit", () => {
  const l = ledger(), r = l.preview(event("too-much", { amount: "2800001" }));
  assert.equal(r.accepted, false); assert.ok(r.reasons.includes("ALLOCATION_LIMIT"));
  assert.equal(l.state().current.events.length, 2); l.commit(r);
  assert.equal(evaluateRehearsal(l.state().current).cash, "1028000000");
  l.undo(); assert.equal(evaluateRehearsal(l.state().current).proposedOwnTokenBuybackBudget, "2800000");
});
test("CSV is recalculated, labels simulation and uses exact base-unit strings", () => {
  const l = ledger(); l.commit(l.preview(event())); const text = rehearsalCsv(l.state().current);
  assert.match(text, /"simulationOnly","sourceVerified","authorizesExecution"/);
  assert.match(text, /"true","false","false","DAT"/);
  assert.match(text, /"reserve-1","reserve","true"/); assert.match(text, /"28000000"/);
  assert.equal(text.split("\r\n").length, 5);
});
test("200-record bound rejects append without changing the last saved document", () => {
  const data = JSON.parse(encodeRehearsal(rehearsalExampleV2()));
  for (let i = 0; i < 198; i++) {
    const { reservationId, ...record } = event("d" + i, { kind: "deposit", amount: "1" });
    data.events.push(record);
  }
  const l = createRehearsalLedger(); l.reset(data); const before = l.state().current;
  assert.throws(() => l.preview(event()), { code: "INVALID_STRUCTURE" });
  assert.equal(l.state().current, before); assert.equal(l.state().hasReview, false);
});
test("reentrant input reflection cannot commit a preview over another agent's reset", () => {
  const l = ledger(); let changed = false;
  const input = new Proxy(event(), { getOwnPropertyDescriptor(target, key) {
    if (!changed) { changed = true; l.reset(rehearsalExampleV2("EMA")); }
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  assert.throws(() => l.preview(input), { code: "STALE_REVIEW" });
  assert.equal(l.state().current.agent, "EMA"); assert.equal(l.state().hasReview, false);
});
test("reentrant clear during reset cannot resurrect a document", () => {
  const l = ledger(); let changed = false;
  const input = new Proxy(rehearsalExampleV2(), { ownKeys(target) {
    if (!changed) { changed = true; l.clear(); }
    return Reflect.ownKeys(target);
  } });
  assert.throws(() => l.reset(input), { code: "STALE_REVIEW" });
  assert.equal(l.state().current, null);
});
