import test from "node:test";
import assert from "node:assert/strict";
import { ZERO_ADDRESS } from "../src/transfer-codec.js";
import { UINT256_MAX } from "../src/token-identity-codec.js";
import {
  compareTransferSnapshots, formatTransferAmount, queryTransfers, summarizeTransfers,
  transferComparisonText, transferCsv, transferSummaryText, validateTransferQuery,
} from "../src/transfer-view.js";
import { ACCOUNT, OTHER, THIRD, clone, code, context, event, hash, snapshot } from "./helpers/transfer-fixtures.js";

test("transfer view: exact large amounts do not lose fractional digits", () => {
  assert.equal(formatTransferAmount("123456789012345678901234567890"), "123456789012.34567890123456789");
  assert.equal(formatTransferAmount("1"), "0.000000000000000001");
  assert.equal(formatTransferAmount("-1"), "-0.000000000000000001");
  assert.equal(formatTransferAmount("1000000000000000000"), "1");
  assert.equal(formatTransferAmount("0"), "0");
  assert.equal(formatTransferAmount("12", 0), "12");
  assert.equal(formatTransferAmount("12", 2), "0.12");
});

test("transfer view: aggregate amount may legitimately exceed uint256", () => {
  const input = snapshot({ events: [event({ amountBaseUnits: UINT256_MAX.toString() }), event({ amountBaseUnits: UINT256_MAX.toString() }, 1)] });
  const result = summarizeTransfers(input);
  assert.equal(result.receivedBaseUnits, (UINT256_MAX * 2n).toString());
  assert.ok(formatTransferAmount(result.receivedBaseUnits).includes("."));
});

for (const value of ["-0", "1e9", "00", "1.0", " 1", Infinity, 12, "9".repeat(82)]) {
  test("transfer view: unsafe display amount " + String(value).slice(0, 20), () => {
    assert.throws(() => formatTransferAmount(value), code("TRANSFER_DISPLAY_AMOUNT"));
  });
}

test("transfer view: self movements excluded from net; mint and burn retained separately", () => {
  const input = snapshot({ events: [
    event({ amountBaseUnits: "30" }),
    event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "10" }, 1),
    event({ from: ACCOUNT, to: ACCOUNT, amountBaseUnits: "999" }, 2),
    event({ from: ZERO_ADDRESS, amountBaseUnits: "5" }, 3),
    event({ from: ACCOUNT, to: ZERO_ADDRESS, amountBaseUnits: "2" }, 4),
  ] });
  const summary = summarizeTransfers(input);
  assert.deepEqual(summary.counts, { incoming: 1, outgoing: 1, self: 1, mint: 1, burn: 1 });
  assert.equal(summary.receivedBaseUnits, "35");
  assert.equal(summary.sentBaseUnits, "12");
  assert.equal(summary.netObservedBaseUnits, "23");
  assert.equal(summary.counterparties, 1);
  assert.equal(summary.transactions, 5);
  assert.equal(summary.isBalance, false);
});

test("transfer view: zero-value events remain visible", () => {
  const input = snapshot({ events: [event({ amountBaseUnits: "0" })] });
  assert.equal(summarizeTransfers(input).events, 1);
  assert.equal(queryTransfers(input).rows[0].formattedAmount, "0");
});

test("transfer view: outgoing-only window can have a negative observed net", () => {
  const input = snapshot({ events: [event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "8" })] });
  assert.equal(summarizeTransfers(input).netObservedBaseUnits, "-8");
  assert.match(transferSummaryText(input), /-0\.000000000000000008 DAT/);
});

test("transfer view: empty observation summary has zero events, not a balance assertion", () => {
  const input = snapshot({ events: [] });
  const summary = summarizeTransfers(input);
  assert.equal(summary.events, 0);
  assert.equal(summary.receivedBaseUnits, "0");
  assert.equal(summary.isBalance, false);
  assert.match(transferSummaryText(input), /活動がないとは限りません/);
});

test("transfer view: deterministic newest and oldest pagination", () => {
  const input = snapshot({ events: Array.from({ length: 25 }, (_, index) => event({}, index)) });
  const page = queryTransfers(input, { direction: "all", search: "", order: "newest", page: 1, pageSize: 10 });
  assert.equal(page.total, 25);
  assert.equal(page.matched, 25);
  assert.equal(page.pages, 3);
  assert.equal(page.hasPrevious, true);
  assert.equal(page.hasNext, true);
  assert.equal(page.rows[0].logIndex, "14");
  assert.equal(page.rows.at(-1).logIndex, "5");
  const oldest = queryTransfers(input, { ...page.query, order: "oldest", page: 0 });
  assert.equal(oldest.rows[0].logIndex, "0");
  assert.equal(input.events[0].logIndex, "0");
});

test("transfer view: page clamps after filter reduces results", () => {
  const input = snapshot();
  const result = queryTransfers(input, { direction: "outgoing", search: "", order: "newest", page: 99, pageSize: 10 });
  assert.equal(result.query.page, 0);
  assert.equal(result.pages, 1);
  assert.equal(result.matched, 0);
  assert.equal(result.hasPrevious, false);
});

test("transfer view: account search is case-insensitive, trimmed and literal", () => {
  const input = snapshot({ events: [event(), event({ from: THIRD }, 1)] });
  const query = { direction: "all", search: " " + OTHER.toUpperCase() + " ", order: "newest", page: 0, pageSize: 10 };
  assert.equal(queryTransfers(input, query).matched, 1);
  assert.equal(queryTransfers(input, { ...query, search: ".*" }).matched, 0);
  assert.equal(queryTransfers(input, { ...query, search: event().transactionHash }).matched, 1);
  assert.equal(queryTransfers(input, { ...query, search: "40" }).matched, 2);
});

for (const changes of [{ direction: "all<script>" }, { search: "x".repeat(101) }, { search: "\n" },
  { page: -1 }, { page: 1.1 }, { page: Infinity }, { pageSize: 0 }, { pageSize: 101 }, { order: "unknown" }]) {
  test("transfer view: rejects invalid query " + JSON.stringify(changes), () => {
    const query = { ...validateTransferQuery(), ...changes };
    assert.throws(() => queryTransfers(snapshot(), query));
  });
}

test("transfer view: identical observations compare without asserting truth", () => {
  const result = compareTransferSnapshots(snapshot(), clone(snapshot()));
  assert.equal(result.identical, true);
  assert.equal(result.unchanged, 1);
  assert.equal(result.added.length, 0);
  assert.equal(result.independentVerification, false);
});

test("transfer view: additions, removals and changed content are distinct", () => {
  const before = snapshot({ events: [event(), event({}, 1), event({}, 3)] });
  const after = snapshot({ events: [event({ amountBaseUnits: "10" }), event({}, 2), event({}, 3)] });
  const result = compareTransferSnapshots(before, after);
  assert.equal(result.added[0].logIndex, "2");
  assert.equal(result.removed[0].logIndex, "1");
  assert.equal(result.changed[0].before.amountBaseUnits, "1234567890123456789");
  assert.equal(result.changed[0].after.amountBaseUnits, "10");
  assert.equal(result.unchanged, 1);
  assert.equal(result.identical, false);
  assert.match(transferComparisonText(result), /断定しません/);
});

test("transfer view: different boundaries are reported even with same events", () => {
  const result = compareTransferSnapshots(snapshot(), snapshot({ toBlockHash: hash(999) }));
  assert.equal(result.boundaryChanged, true);
  assert.equal(result.identical, false);
  assert.equal(result.unchanged, 1);
});

test("transfer view: total supply change is distinct from event difference", () => {
  const before = snapshot();
  const after = clone(before);
  after.metadata.totalSupply = "10";
  const result = compareTransferSnapshots(before, after);
  assert.equal(result.metadataChanged, true);
  assert.equal(result.changed.length, 0);
});

for (const selected of [context("EMA"), context("DAT", 84532), context("DAT", 8453, OTHER)]) {
  test("transfer view: cannot compare unrelated context " + JSON.stringify(selected), () => {
    assert.throws(() => compareTransferSnapshots(snapshot(), snapshot({}, selected)), code("TRANSFER_COMPARISON_CONTEXT"));
  });
}

test("transfer view: different ranges cannot be called missing transactions", () => {
  const after = snapshot({ range: { fromBlock: "31", toBlock: "42" }, fromBlockHash: hash(31) });
  assert.throws(() => compareTransferSnapshots(snapshot(), after), code("TRANSFER_COMPARISON_CONTEXT"));
});

test("transfer view: CSV includes scope, exact base units and deterministic CRLF", () => {
  const csv = transferCsv(snapshot());
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "");
  assert.match(lines[0], /"amount_base_units"/);
  assert.match(lines[1], /"1234567890123456789"/);
  assert.match(lines[1], /"1\.234567890123456789"/);
  assert.ok(lines[1].includes(ACCOUNT));
  assert.ok(lines[1].includes('"30","42"'));
});

test("transfer view: empty CSV still explains its columns", () => {
  assert.equal(transferCsv(snapshot({ events: [] })).split("\r\n").length, 2);
});

test("transfer view: imported and live summaries are explicitly distinguished", () => {
  assert.match(transferSummaryText(snapshot(), "live"), /今回読み取り/);
  assert.match(transferSummaryText(snapshot(), "imported"), /現在のチェーン状態は未確認/);
  assert.match(transferSummaryText(snapshot({}, context("DAT", 84532))), /テストネット/);
});
