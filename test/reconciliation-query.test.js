import test from "node:test";
import assert from "node:assert/strict";
import { queryReconciliationEvents, validateReconciliationQuery, suggestReconciliationWindows } from "../src/reconciliation-query.js";
import { workspace, scenario, previewWorkspace, record, archive, event, hash, ACCOUNT, OTHER, errorCode } from "./helpers/reconciliation-fixtures.js";
import { ZERO_ADDRESS } from "../src/transfer-codec.js";

const query = changes => ({ agent: "all", direction: "all", search: "", page: 0, ...changes });

function manyEvents() {
  const slot = scenario();
  slot.archive = archive([record(30, 42, Array.from({ length: 61 }, (_, index) => event({
    from: index % 2 ? ACCOUNT : OTHER,
    to: index % 2 ? OTHER : ACCOUNT,
    amountBaseUnits: "1",
  }, index)))]);
  return workspace([slot]);
}

test("query is canonical, immutable and case-insensitive for hashes", () => {
  const value = validateReconciliationQuery(query({ search: "  0XABC  " }));
  assert.equal(value.search, "0xabc");
  assert.ok(Object.isFrozen(value));
});

test("query paginates events without duplicating or losing any log", () => {
  const value = manyEvents();
  const first = queryReconciliationEvents(value, query());
  const second = queryReconciliationEvents(value, query({ page: 1 }));
  const third = queryReconciliationEvents(value, query({ page: 2 }));
  assert.deepEqual([first.rows.length, second.rows.length, third.rows.length], [25, 25, 11]);
  assert.equal(first.total, 61);
  assert.equal(first.pages, 3);
  const keys = [...first.rows, ...second.rows, ...third.rows].map(row => row.transactionHash + ":" + row.logIndex);
  assert.equal(new Set(keys).size, 61);
  assert.equal(first.rows[0].logIndex, "0");
  assert.equal(third.rows.at(-1).logIndex, "60");
  assert.ok(Object.isFrozen(first.rows[0]));
});

test("query clamps page after a filter shrinks results", () => {
  const value = queryReconciliationEvents(manyEvents(), query({ page: 50, search: hash(100) }));
  assert.equal(value.page, 0);
  assert.equal(value.pages, 1);
  assert.equal(value.total, 1);
});

test("query with no matches returns an empty first page", () => {
  const value = queryReconciliationEvents(manyEvents(), query({ search: "not found", page: 3 }));
  assert.deepEqual(value.rows, []);
  assert.equal(value.page, 0);
  assert.equal(value.pages, 1);
  assert.equal(value.total, 0);
});

for (const agent of ["DAT", "EMA", "CAWELON"]) test("query isolates " + agent + " even on mixed chains and accounts", () => {
  const value = queryReconciliationEvents(previewWorkspace(), query({ agent }));
  assert.equal(value.rows.length, 2);
  assert.ok(value.rows.every(row => row.agent === agent));
  assert.equal(value.includesUnverifiedHistory, true);
});

for (const [direction, from, to] of [
  ["incoming", OTHER, ACCOUNT], ["outgoing", ACCOUNT, OTHER], ["self", ACCOUNT, ACCOUNT],
  ["mint", ZERO_ADDRESS, ACCOUNT], ["burn", ACCOUNT, ZERO_ADDRESS],
]) test("query direction " + direction + " has semantic rather than substring matching", () => {
  const slot = scenario();
  slot.archive = archive([record(30, 42, [event({ from, to, amountBaseUnits: "1" })])]);
  const value = queryReconciliationEvents(workspace([slot]), query({ direction }));
  assert.equal(value.total, 1);
  assert.equal(value.rows[0].direction, direction);
  const other = direction === "mint" ? "incoming" : "mint";
  assert.equal(queryReconciliationEvents(workspace([slot]), query({ direction: other })).total, 0);
});

test("search matches transaction hash, block hash, addresses and block number", () => {
  const slot = scenario();
  const row = slot.archive.records[0].events[0];
  for (const search of [row.transactionHash, row.blockHash.toUpperCase(), row.from, row.to, "35"]) {
    const value = queryReconciliationEvents(workspace([slot]), query({ search }));
    assert.ok(value.rows.some(event => event.transactionHash === row.transactionHash));
  }
});

for (const changes of [
  { agent: "other" }, { direction: "INCOMING" }, { direction: "send" }, { page: -1 }, { page: 1.5 },
  { page: 721 }, { page: Infinity }, { page: "1" }, { search: "a".repeat(161) }, { search: "a\nb" }, { search: null },
]) test("query rejects malformed controls " + JSON.stringify(changes), () => {
  assert.throws(() => validateReconciliationQuery(query(changes)));
});

test("query excludes all events for non-comparable evidence", () => {
  const slot = scenario();
  slot.later.account = OTHER;
  const value = queryReconciliationEvents(workspace([slot]), query());
  assert.equal(value.total, 0);
});

test("gap suggestions partition ranges into at most 2000-block reads", () => {
  const slot = scenario("DAT", { archive: null });
  slot.earlier.blockNumber = "100";
  slot.later.blockNumber = "5100";
  const plan = suggestReconciliationWindows(workspace([slot]), "DAT");
  assert.equal(plan.available, true);
  assert.deepEqual(plan.windows, [
    { fromBlock: "101", toBlock: "2100" }, { fromBlock: "2101", toBlock: "4100" }, { fromBlock: "4101", toBlock: "5100" },
  ]);
  assert.equal(plan.plannedBlocks, "5000");
  assert.equal(plan.remainingBlocks, "0");
  assert.equal(plan.requiresManualRead, true);
});

test("huge gaps produce a bounded plan and exact remaining count", () => {
  const maximum = (1n << 256n) - 1n;
  const slot = scenario("DAT", { archive: null });
  slot.earlier.blockNumber = "0";
  slot.later.blockNumber = maximum.toString();
  const plan = suggestReconciliationWindows(workspace([slot]), "DAT", 2);
  assert.equal(plan.windows.length, 2);
  assert.equal(plan.plannedBlocks, "4000");
  assert.equal(plan.remainingBlocks, (maximum - 4000n).toString());
});

test("gap suggestions exclude already queried blocks", () => {
  const slot = scenario("DAT", { archive: archive([record(33, 35), record(40, 42)]) });
  const plan = suggestReconciliationWindows(workspace([slot]), "DAT");
  assert.deepEqual(plan.windows, [{ fromBlock: "31", toBlock: "32" }, { fromBlock: "36", toBlock: "39" }]);
  assert.equal(plan.plannedBlocks, "6");
});

test("comparison errors make gap suggestion unavailable", () => {
  const plan = suggestReconciliationWindows(workspace([scenario("DAT", { earlier: null })]), "DAT");
  assert.equal(plan.available, false);
  assert.deepEqual(plan.windows, []);
});

test("full coverage yields an empty manual plan", () => {
  const plan = suggestReconciliationWindows(workspace(), "DAT");
  assert.equal(plan.available, true);
  assert.deepEqual(plan.windows, []);
  assert.equal(plan.remainingBlocks, "0");
});

for (const maximum of [0, -1, 13, 1.5, "2", null]) test("gap plan rejects invalid maximum " + maximum, () => {
  assert.throws(() => suggestReconciliationWindows(workspace(), "DAT", maximum), errorCode("RECONCILIATION_WINDOW_LIMIT"));
});
