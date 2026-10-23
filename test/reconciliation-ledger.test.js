import test from "node:test";
import assert from "node:assert/strict";
import {
  reconciliationEvidence, reconciliationBlockLedger, reconciliationLedgerText,
  reconciliationLedgerCsv, reconciliationWindowsCsv, reconciliationEvidenceText,
} from "../src/reconciliation-ledger.js";
import { workspace, scenario, previewWorkspace, archive, record, event, hash, ACCOUNT, OTHER, UNIT } from "./helpers/reconciliation-fixtures.js";
import { ZERO_ADDRESS } from "../src/transfer-codec.js";

test("evidence report retains observations and acquisition context intact", () => {
  const input = workspace();
  const evidence = reconciliationEvidence(input, "DAT");
  assert.deepEqual(evidence.earlier, input.slots[0].earlier);
  assert.deepEqual(evidence.later, input.slots[0].later);
  assert.equal(evidence.records[0].account, ACCOUNT);
  assert.equal(evidence.records[0].tokenAddress, input.slots[0].earlier.tokenAddress);
  assert.equal(evidence.records[0].fromBlockHash, hash(30));
  assert.equal(evidence.records[0].toBlockHash, hash(42));
  assert.equal(evidence.independentlyVerified, false);
});

test("source trace records overlapping evidence without double counting", () => {
  const slot = scenario();
  const rows = slot.archive.records[0].events;
  slot.archive = archive([record(30, 40, rows), record(35, 42, rows)]);
  const evidence = reconciliationEvidence(workspace([slot]), "DAT");
  assert.equal(evidence.events.length, 2);
  for (const event of evidence.events) {
    assert.deepEqual(event.sourcePeriods, ["period-1", "period-2"]);
    assert.equal(event.countedTimes, 1);
    assert.ok(Object.isFrozen(event.sourcePeriods));
  }
  assert.equal(evidence.records[0].countedEvents, 2);
  assert.equal(evidence.records[1].countedEvents, 2);
  assert.match(reconciliationEvidenceText(workspace([slot]), "DAT"), /重複していた計算対象イベント: 2件/);
});

test("source trace distinguishes raw events outside the comparison interval", () => {
  const slot = scenario();
  slot.archive = archive([record(30, 42, [
    event({ blockNumber: "30", blockHash: hash(30) }, 0),
    event({ blockNumber: "40", blockHash: hash(40) }, 1),
  ])]);
  const evidence = reconciliationEvidence(workspace([slot]), "DAT");
  assert.equal(evidence.records[0].rawEvents, 2);
  assert.equal(evidence.records[0].countedEvents, 1);
  assert.equal(evidence.events.length, 1);
  assert.equal(evidence.events[0].blockNumber, "40");
});

test("source trace preserves records even when comparison is blocked", () => {
  const slot = scenario();
  slot.later.account = OTHER;
  const evidence = reconciliationEvidence(workspace([slot]), "DAT");
  assert.equal(evidence.status, "not-comparable");
  assert.equal(evidence.records.length, 1);
  assert.equal(evidence.records[0].rawEvents, 2);
  assert.equal(evidence.records[0].countedEvents, 0);
  assert.deepEqual(evidence.events, []);
});

for (const agent of ["DAT", "EMA", "CAWELON"]) test(agent + " block ledger carries forward exact historical balance", () => {
  const value = reconciliationBlockLedger(workspace([scenario(agent)]), agent);
  assert.equal(value.available, true);
  assert.deepEqual(value.rows.map(row => row.blockNumber), ["35", "40"]);
  assert.equal(value.rows[0].openingImpliedBaseUnits, (100n * UNIT).toString());
  assert.equal(value.rows[0].closingImpliedBaseUnits, (110n * UNIT).toString());
  assert.equal(value.rows[1].openingImpliedBaseUnits, (110n * UNIT).toString());
  assert.equal(value.rows[1].closingImpliedBaseUnits, (107n * UNIT).toString());
  assert.equal(value.balanceIsInferred, true);
  assert.equal(value.independentlyVerified, false);
  assert.ok(Object.isFrozen(value.rows[0]));
});

test("block ledger groups multiple logs in one transaction without inflating transactions", () => {
  const slot = scenario();
  const transactionHash = hash(999);
  slot.archive = archive([record(30, 42, [
    event({ transactionHash, transactionIndex: "0", amountBaseUnits: "3" }, 0),
    event({ transactionHash, transactionIndex: "0", amountBaseUnits: "5" }, 1),
  ])]);
  const value = reconciliationBlockLedger(workspace([slot]), "DAT");
  assert.equal(value.rows.length, 1);
  assert.equal(value.rows[0].eventCount, 2);
  assert.equal(value.rows[0].transactionCount, 1);
  assert.equal(value.rows[0].receivedBaseUnits, "8");
});

test("block ledger separately identifies mint burn self and zero events", () => {
  const slot = scenario();
  slot.archive = archive([record(30, 42, [
    event({ from: ZERO_ADDRESS, amountBaseUnits: "11" }, 0),
    event({ from: ACCOUNT, to: ZERO_ADDRESS, amountBaseUnits: "4" }, 1),
    event({ from: ACCOUNT, to: ACCOUNT, amountBaseUnits: "9999" }, 2),
    event({ amountBaseUnits: "0" }, 3),
  ])]);
  const row = reconciliationBlockLedger(workspace([slot]), "DAT").rows[0];
  assert.equal(row.mintedBaseUnits, "11");
  assert.equal(row.burnedBaseUnits, "4");
  assert.equal(row.selfTransferCount, 1);
  assert.equal(row.zeroValueCount, 1);
  assert.equal(row.netBaseUnits, "7");
  assert.equal(row.receivedBaseUnits, "10010");
  assert.equal(row.sentBaseUnits, "10003");
});

test("block ledger exposes earlier gaps rather than presenting inferred balance as observed", () => {
  const input = previewWorkspace();
  const value = reconciliationBlockLedger(input, "CAWELON");
  assert.equal(value.status, "incomplete-history");
  assert.equal(value.rows[0].earlierGaps, 0);
  assert.equal(value.rows[1].earlierGaps, 1);
  const text = reconciliationLedgerText(input, "CAWELON");
  assert.match(text, /残高を読み直した結果ではありません/);
  assert.match(text, /未取得期間 1/);
});

test("missing observations produce unavailable ledger rather than fake opening balance", () => {
  const value = reconciliationBlockLedger(workspace(), "EMA");
  assert.equal(value.available, false);
  assert.deepEqual(value.rows, []);
  assert.match(reconciliationLedgerText(workspace(), "EMA"), /比較可能な残高/);
});

test("empty event interval keeps a distinct no-events explanation", () => {
  const slot = scenario("DAT", { archive: archive([record(30, 42)]) });
  const value = reconciliationBlockLedger(workspace([slot]), "DAT");
  assert.equal(value.available, true);
  assert.deepEqual(value.rows, []);
  assert.match(reconciliationLedgerText(workspace([slot]), "DAT"), /数えたイベントはありません/);
});

test("ledger text bounds visible rows while CSV retains all blocks", () => {
  const slot = scenario();
  slot.later.blockNumber = "100";
  slot.later.blockHash = hash(100);
  slot.archive = archive([record(30, 100, Array.from({ length: 60 }, (_, index) => event({
    blockNumber: String(31 + index), blockHash: hash(31 + index), transactionIndex: "0", amountBaseUnits: "1",
  }, index)))]);
  const input = workspace([slot]);
  const text = reconciliationLedgerText(input, "DAT");
  assert.match(text, /先頭25ブロック/);
  assert.match(text, /全60ブロック/);
  assert.doesNotMatch(text, /block 90:/);
  const csv = reconciliationLedgerCsv(input);
  assert.equal(csv.trim().split("\r\n").length, 61);
  assert.match(csv, /"90"/);
});

test("ledger CSV includes raw units, provenance flags and signed formula protection", () => {
  const csv = reconciliationLedgerCsv(previewWorkspace());
  assert.equal(csv.trim().split("\r\n").length, 7);
  assert.match(csv, /"opening_implied_base_units"/);
  assert.match(csv, /"closing_implied_base_units"/);
  assert.match(csv, /"'-3000000000000000000"/);
  assert.match(csv, /"incomplete-history"/);
  assert.match(csv, /"false"/);
});

test("gap CSV includes account chain token and denies automatic execution", () => {
  const input = previewWorkspace();
  const csv = reconciliationWindowsCsv(input);
  const slot = input.slots[2];
  assert.equal(csv.trim().split("\r\n").length, 2);
  assert.ok(csv.includes(slot.earlier.account));
  assert.ok(csv.includes(slot.earlier.tokenAddress));
  assert.match(csv, /"84532"/);
  assert.match(csv, /"37","39","0","false"/);
});

test("gap CSV limits enormous missing ranges to twelve manual windows", () => {
  const slot = scenario("DAT", { archive: null });
  slot.later.blockNumber = "100000000000000000000000";
  const csv = reconciliationWindowsCsv(workspace([slot]));
  assert.equal(csv.trim().split("\r\n").length, 13);
  assert.match(csv, /99999999999999999975970/);
});

test("source text preserves distinct origins and connection epochs", () => {
  const slot = scenario();
  slot.later.siteOrigin = "http://127.0.0.1:4186";
  slot.later.connectionEpoch = 5;
  const text = reconciliationEvidenceText(workspace([slot]), "DAT");
  assert.match(text, /4192 \/ 接続回 1/);
  assert.match(text, /4186 \/ 接続回 5/);
  assert.ok(text.includes(hash(30)));
  assert.ok(text.includes(hash(42)));
});
