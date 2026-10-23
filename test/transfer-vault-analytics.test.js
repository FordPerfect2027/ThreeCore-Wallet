import test from "node:test";
import assert from "node:assert/strict";
import { archiveEvents, activityRows, queryVaultActivity, summarizeVaultActivity, vaultCounterparties,
  vaultActivityCsv, vaultActivityText, validateActivityQuery, activityRowText } from "../src/transfer-vault-analytics.js";
import { vaultBundle } from "../src/transfer-vault-model.js";
import { addTransferArchiveRecord } from "../src/transfer-archive.js";
import { ZERO_ADDRESS } from "../src/transfer-codec.js";
import { bundleFor, archiveFor } from "./helpers/vault-fixtures.js";
import { ACCOUNT, OTHER, THIRD, snapshot, event, hash, clone, code } from "./helpers/transfer-fixtures.js";

const query = changes => ({ agent: "all", direction: "all", search: "", order: "newest", page: 0, pageSize: 20, ...changes });
function mixed() {
  const rows = [
    event({ from: OTHER, to: ACCOUNT, amountBaseUnits: "7000000000000000001" }, 0),
    event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "2000000000000000000" }, 1),
    event({ from: ACCOUNT, to: ACCOUNT, amountBaseUnits: "999000000000000000000" }, 2),
    event({ from: ZERO_ADDRESS, to: ACCOUNT, amountBaseUnits: "3000000000000000000" }, 3),
    event({ from: ACCOUNT, to: ZERO_ADDRESS, amountBaseUnits: "1000000000000000000" }, 4),
    event({ from: THIRD, to: ACCOUNT, amountBaseUnits: "0" }, 5),
  ];
  return vaultBundle([addTransferArchiveRecord(null, snapshot({ events: rows })), null, null]);
}

test("archive aggregation deduplicates identical overlap but retains distinct logs", () => {
  const first = snapshot();
  const wider = snapshot({ range: { fromBlock: "29", toBlock: "43" }, fromBlockHash: hash(29), toBlockHash: hash(43) });
  const archive = addTransferArchiveRecord(addTransferArchiveRecord(null, first), wider);
  assert.equal(archiveEvents(archive).length, 1);
  const bundle = vaultBundle([archive, null, null]);
  assert.equal(summarizeVaultActivity(bundle)[0].events, 1);
  assert.equal(summarizeVaultActivity(bundle)[0].coverage.records, 2);
  assert.equal(summarizeVaultActivity(bundle)[0].coverage.requestedBlocks, "15");
});

test("all directions use exact integer totals and self transfers do not inflate net", () => {
  const row = summarizeVaultActivity(mixed())[0];
  assert.equal(row.events, 6);
  assert.equal(row.transactions, 6);
  assert.deepEqual(row.counts, { incoming: 2, outgoing: 1, self: 1, mint: 1, burn: 1 });
  assert.equal(row.receivedBaseUnits, "10000000000000000001");
  assert.equal(row.sentBaseUnits, "3000000000000000000");
  assert.equal(row.netObservedBaseUnits, "7000000000000000001");
  assert.equal(row.isBalance, false);
  assert.equal(row.amounts.self, "999000000000000000000");
});

test("summary never conflates distinct token balances or an empty slot with zero", () => {
  const rows = summarizeVaultActivity(bundleFor(["DAT", "CAWELON"]));
  assert.equal(rows[0].agent, "DAT");
  assert.deepEqual(rows[1], { agent: "EMA", present: false });
  assert.equal(rows[2].agent, "CAWELON");
  assert.equal("combinedBalance" in rows, false);
  assert.match(vaultActivityText(bundleFor(["DAT"])), /記録なし（残高ゼロを意味しません）/);
});

test("negative observed net is preserved without coercing to uint256", () => {
  const row = event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "1" });
  const input = vaultBundle([addTransferArchiveRecord(null, snapshot({ events: [row] })), null, null]);
  assert.equal(summarizeVaultActivity(input)[0].netObservedBaseUnits, "-1");
  assert.match(vaultActivityText(input), /-0\.000000000000000001 DAT/);
});

test("aggregate values can exceed uint256 without rounding", () => {
  const maximum = ((1n << 256n) - 1n).toString();
  const archive = archiveFor("DAT", { count: 500, amount: maximum });
  const result = summarizeVaultActivity(vaultBundle([archive, null, null]))[0];
  assert.equal(result.receivedBaseUnits, String(BigInt(maximum) * 500n));
  assert.equal(result.events, 500);
  assert.doesNotThrow(() => vaultActivityText(vaultBundle([archive, null, null])));
});

test("an actual empty observation is distinguished from no stored observation", () => {
  const input = bundleFor(["DAT"], { count: 0 });
  const rows = summarizeVaultActivity(input);
  assert.equal(rows[0].present, true);
  assert.equal(rows[0].events, 0);
  assert.equal(rows[0].coverage.requestedBlocks, "13");
  assert.equal(rows[1].present, false);
});

test("gaps remain visible even if observed movements total zero", () => {
  const first = archiveFor("DAT", { count: 0, start: 30, end: 42 });
  const later = archiveFor("DAT", { count: 0, start: 50, end: 60 });
  const archive = addTransferArchiveRecord(first, later.records[0]);
  const input = vaultBundle([archive, null, null]);
  assert.deepEqual(summarizeVaultActivity(input)[0].coverage.gaps, [{ fromBlock: "43", toBlock: "49" }]);
  assert.match(vaultActivityText(input), /43 ～ 49/);
});

for (const direction of ["incoming", "outgoing", "self", "mint", "burn"]) {
  test("activity can filter " + direction + " independently", () => {
    const result = queryVaultActivity(mixed(), query({ direction }));
    assert.equal(result.matched, direction === "incoming" ? 2 : 1);
    assert.ok(result.rows.every(row => row.direction === direction));
    assert.equal(result.total, 6);
  });
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test("activity isolates token " + agent, () => {
    const result = queryVaultActivity(bundleFor(), query({ agent }));
    assert.equal(result.total, 3);
    assert.equal(result.matched, 1);
    assert.equal(result.rows[0].agent, agent);
  });
}

test("search is case insensitive and supports the exact public identifiers", () => {
  const bundle = mixed(), row = activityRows(bundle)[0];
  for (const search of [row.transactionHash.toUpperCase(), row.account.toUpperCase(), row.tokenAddress, "40"]) {
    assert.ok(queryVaultActivity(bundle, query({ search })).matched > 0);
  }
  assert.equal(queryVaultActivity(bundle, query({ search: " <script> " })).matched, 0);
});

test("pagination clamps safely and never omits rows at page boundaries", () => {
  const input = bundleFor(["DAT"], { count: 43 });
  const first = queryVaultActivity(input, query({ order: "oldest" }));
  const second = queryVaultActivity(input, query({ order: "oldest", page: 1 }));
  const third = queryVaultActivity(input, query({ order: "oldest", page: 999 }));
  assert.equal(first.rows.length, 20);
  assert.equal(second.rows.length, 20);
  assert.equal(third.rows.length, 3);
  assert.equal(third.query.page, 2);
  assert.equal(first.hasPrevious, false);
  assert.equal(second.hasPrevious, true);
  assert.equal(third.hasNext, false);
  assert.equal(new Set([...first.rows, ...second.rows, ...third.rows].map(row => row.transactionHash)).size, 43);
});

test("newest ordering reverses within chain grouping and remains deterministic", () => {
  const input = vaultBundle([archiveFor("DAT", { chainId: 8453 }), archiveFor("EMA", { chainId: 84532 }), null]);
  const asc = queryVaultActivity(input, query({ order: "oldest" })).rows;
  const desc = queryVaultActivity(input, query({ order: "newest" })).rows;
  assert.deepEqual(desc, [...asc].reverse());
  assert.equal(asc[0].chainId, 8453);
  assert.equal(asc[1].chainId, 84532);
});

test("duplicate transaction hashes across tokens remain distinct events", () => {
  const rows = activityRows(bundleFor());
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.transactionHash)).size, 1);
  assert.equal(new Set(rows.map(row => row.tokenAddress)).size, 3);
});

test("counterparties exclude self, mint and burn and preserve zero-value activity", () => {
  const rows = vaultCounterparties(mixed(), "DAT");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].address, OTHER);
  assert.equal(rows[0].events, 2);
  assert.equal(rows[0].received, "7.000000000000000001");
  assert.equal(rows[0].sent, "2");
  assert.equal(rows[1].address, THIRD);
  assert.equal(rows[1].events, 1);
  assert.equal(rows[1].received, "0");
  assert.deepEqual(vaultCounterparties(mixed(), "EMA"), []);
});

test("CSV retains raw integer amounts, token identity and log positions", () => {
  const csv = vaultActivityCsv(mixed());
  assert.equal(csv.startsWith("\ufeff"), true);
  assert.equal(csv.split("\r\n").length, 8);
  assert.ok(csv.includes('"amountBaseUnits"'));
  assert.ok(csv.includes('"7000000000000000001"'));
  assert.ok(csv.includes('"7.000000000000000001"'));
  assert.ok(csv.includes('"logIndex"'));
  assert.ok(csv.includes('"self"'));
  assert.equal(csv.includes("privateKey"), false);
});

test("activity exports are stable and do not mutate archive order", () => {
  const input = clone(mixed()), before = JSON.stringify(input);
  const first = vaultActivityCsv(input);
  queryVaultActivity(input, query({ order: "newest" }));
  assert.equal(vaultActivityCsv(input), first);
  assert.equal(JSON.stringify(input), before);
  assert.match(activityRowText(activityRows(input)[0]), /block 40/);
});

const invalidQueries = [
  { agent: "DOT" }, { direction: "send" }, { order: "time" }, { search: null },
  { search: "x".repeat(101) }, { search: "a\nb" }, { page: -1 }, { page: 1.2 },
  { page: Infinity }, { pageSize: 0 }, { pageSize: 101 }, { pageSize: "20" },
];
for (const invalid of invalidQueries) {
  test("activity refuses unsupported query " + JSON.stringify(invalid), () => {
    assert.throws(() => validateActivityQuery(query(invalid)), code("TRANSFER_VAULT_QUERY"));
  });
}

test("an empty view has exactly one empty page with no navigation", () => {
  const view = queryVaultActivity(vaultBundle(), query());
  assert.equal(view.pages, 1);
  assert.equal(view.matched, 0);
  assert.deepEqual(view.rows, []);
  assert.equal(view.hasNext, false);
  assert.equal(view.hasPrevious, false);
});
