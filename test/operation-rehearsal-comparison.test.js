import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExample, rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { compareRehearsalWorkspaces, encodeRehearsalComparison, REHEARSAL_COMPARISON_LIMIT } from "../src/operation-rehearsal-comparison.js";
import { encodeRehearsalWorkspace, decodeRehearsalWorkspace, REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
const pack = (ledgers = [], activeAgent = "DAT") => ({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent, ledgers });
const clone = value => JSON.parse(JSON.stringify(value));

test("classifies absent, newly restored, replaced, removed and identical canonical records", () => {
  const dat = rehearsalExampleV2(), ema = rehearsalExampleV2("EMA");
  const result = compareRehearsalWorkspaces(pack([dat, ema]), pack([dat, rehearsalExampleV2("CAWELON")]));
  assert.deepEqual(result.rows.map(r => r.action), ["unchanged", "removed", "added"]);
  assert.equal(result.rows[1].after, null); assert.equal(result.rows[2].before, null);
  assert.equal(compareRehearsalWorkspaces(pack(), pack()).rows[0].action, "absent");
  assert.equal(compareRehearsalWorkspaces(pack([dat]), pack([rehearsalExampleV2("DAT", "loss")])).rows[0].action, "replaced");
});
test("normalizes address case, field order and formatting without claiming byte identity", () => {
  const before = rehearsalExampleV2(), after = clone(before);
  after.account = "0x" + "A".repeat(40);
  const lower = clone(after); lower.account = lower.account.toLowerCase();
  const result = compareRehearsalWorkspaces(pack([lower]), pack([after]));
  assert.equal(result.rows[0].action, "unchanged"); assert.equal(result.comparesCanonicalInputs, true);
  assert.equal(result.sourceVerified, false); assert.equal(result.authorizesExecution, false);
  const reversed = Object.fromEntries(Object.entries(after).reverse());
  assert.equal(compareRehearsalWorkspaces(pack([lower]), pack([reversed])).rows[0].action, "unchanged");
  assert.equal(encodeRehearsalComparison(pack([lower]), pack([after])), encodeRehearsalComparison(pack([after]), pack([lower])));
});
test("selection-only change is reported without inventing record or accounting changes", () => {
  const data = [rehearsalExampleV2(), rehearsalExampleV2("EMA")];
  const r = compareRehearsalWorkspaces(pack(data), pack(data, "EMA"));
  assert.equal(r.selectedAgentChanged, true); assert.equal(r.rows[0].action, "unchanged");
  assert.deepEqual(r.rows[0].contextChanges, []); assert.deepEqual(r.rows[0].policyChanges, []);
});
for (const [field, update] of [
  ["chainId", d => { d.chainId = 8453; }], ["account", d => { d.account = "0x" + "9".repeat(40); }],
  ["assetAddress", d => { d.asset.address = "0x" + "8".repeat(40); }],
  ["symbol", d => { d.asset.symbol = "OTHER"; }], ["decimals", d => { d.asset.decimals = 18; }],
  ["origin", d => { d.policy.origin = "https://other.example"; }],
  ["spender", d => { d.policy.spender = "0x" + "7".repeat(40); }],
]) test("detects " + field + " changes independently of unchanged record counts", () => {
  const before = rehearsalExampleV2(), after = clone(before); update(after);
  const r = compareRehearsalWorkspaces(pack([before]), pack([after])).rows[0];
  assert.equal(r.before.recordCount, r.after.recordCount); assert.equal(r.action, "replaced");
  assert.deepEqual(r.contextChanges.map(c => c.field), [field]);
  assert.equal(r.sameAccountingContext, ["origin", "spender"].includes(field));
  assert.equal(Object.hasOwn(r, "delta"), false); assert.equal(Object.hasOwn(r, "total"), false);
});
test("compares all policy fields exactly and preserves missing old-version fee caps", () => {
  const before = rehearsalExample("DAT"), after = clone(rehearsalExampleV2());
  after.openingBalance = "900719925474099312345"; after.policy.paused = true; after.policy.buybackBps = 9999;
  for (const key of ["maxPerOperation", "maxOutstanding", "reserveFloor", "lossLimit"]) after.policy[key] = "12345678901234567890";
  const r = compareRehearsalWorkspaces(pack([before]), pack([after])).rows[0];
  assert.equal(r.policyChanges.length, 9);
  assert.equal(r.before.policy.maxEntryFee, null); assert.equal(r.after.policy.maxEntryFee, "3000000");
  assert.equal(r.policyChanges.find(c => c.field === "openingBalance").after, "900719925474099312345");
  assert.ok(r.contextChanges.some(c => c.field === "schema"));
});
test("detects added, removed and modified IDs plus reordering of common IDs", () => {
  const before = clone(rehearsalExampleV2("DAT", "recovery")), after = clone(before);
  after.events = [after.events[1], after.events[0], after.events[2]];
  after.events[0].grossReturn = "61000000";
  after.events.push({ id: "new", kind: "deposit", agent: "DAT", chainId: 84532, account: after.account, amount: "1" });
  const r = compareRehearsalWorkspaces(pack([before]), pack([after])).rows[0];
  assert.deepEqual(r.eventChanges, { added: ["new"], removed: ["settle-two"], modified: ["settle-one"], orderChanged: true });
  const insertOnly = clone(before); insertOnly.events.unshift(after.events[3]);
  assert.equal(compareRehearsalWorkspaces(pack([before]), pack([insertOnly])).rows[0].eventChanges.orderChanged, false);
});
test("rejected, unresolved and overcommitted records are findings rather than a claimed permission", () => {
  const over = clone(rehearsalExampleV2("DAT", "recovery"));
  over.events = [over.events[2], over.events[3],
    { id: "reserve", kind: "reserve", agent: "DAT", chainId: 84532, account: over.account, reservationId: "r", amount: "5800000" },
    over.events[0], over.events[1]];
  const r = compareRehearsalWorkspaces(pack(), pack([over, rehearsalExampleV2("EMA", "limit"), rehearsalExampleV2("CAWELON", "pending")]));
  assert.equal(r.rows[0].after.allocationOvercommitted, true);
  assert.equal(r.rows[1].after.rejectedRecords, 1); assert.equal(r.rows[2].after.openPositions, 1);
  assert.equal(r.authorizesExecution, false);
});
test("zero-record and absent ledgers remain distinct and no cross-agent total is exposed", () => {
  const zero = { ...rehearsalExampleV2(), events: [] };
  const r = compareRehearsalWorkspaces(pack(), pack([zero]));
  assert.equal(r.rows[0].action, "added"); assert.equal(r.rows[0].after.recordCount, 0);
  assert.equal(r.rows[1].after, null); assert.equal(Object.hasOwn(r, "total"), false);
});
test("snapshots and comparison rows are deeply immutable and report cannot be imported as a workspace", () => {
  const input = clone(rehearsalExampleV2()), before = pack([input]);
  const r = compareRehearsalWorkspaces(before, pack()); input.account = "0x" + "9".repeat(40);
  assert.notEqual(r.inputs.before.ledgers[0].account, input.account);
  for (const value of [r, r.rows, r.rows[0], r.rows[0].before.context, r.rows[0].eventChanges.removed, r.inputs.before.ledgers]) assert.ok(Object.isFrozen(value));
  assert.throws(() => decodeRehearsalWorkspace(encodeRehearsalComparison(before, pack())));
});
test("invalid members and getters cannot produce a partial or derived comparison", () => {
  let called = false; const bad = pack(); Object.defineProperty(bad, "ledgers", { enumerable: true, get() { called = true; return []; } });
  assert.throws(() => compareRehearsalWorkspaces(bad, pack())); assert.equal(called, false);
  assert.throws(() => compareRehearsalWorkspaces(pack(), pack([rehearsalExampleV2(), rehearsalExampleV2()])));
});
test("bounded full-size histories produce an exportable comparison without altering input bytes", () => {
  const ledgers = ["DAT", "EMA", "CAWELON"].map(agent => {
    const d = clone(rehearsalExampleV2(agent)); d.events = Array.from({length:200}, (_, i) => ({
      id: ("id" + i).padEnd(64,"x"), kind:"deposit", agent, chainId:d.chainId, account:d.account, amount:"1" })); return d;
  });
  const before = pack(ledgers), text = encodeRehearsalWorkspace(before);
  const after = clone(before); for (const d of after.ledgers) for (const event of d.events) event.id = "z" + event.id.slice(1);
  const report = encodeRehearsalComparison(before, after);
  assert.ok(Buffer.byteLength(report) <= REHEARSAL_COMPARISON_LIMIT); assert.equal(encodeRehearsalWorkspace(before), text);
  assert.equal(JSON.parse(report).rows[0].eventChanges.added.length, 200);
});
