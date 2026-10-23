import test from "node:test";
import assert from "node:assert/strict";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { queryReconciliationEvents } from "../src/reconciliation-query.js";
import { reconciliationBlockLedger, reconciliationEvidence } from "../src/reconciliation-ledger.js";
import { prepareReconciliationFile, decodeReconciliationFile } from "../src/reconciliation-file.js";
import { createReconciliationController } from "../src/reconciliation-controller.js";
import { emptyReconciliationWorkspace, reconciliationKey } from "../src/reconciliation-model.js";
import { catalogToken } from "../src/token-catalog.js";
import { ZERO_ADDRESS } from "../src/transfer-codec.js";
import { scenario, workspace, archive, record, event, hash, context, clone, ACCOUNT, OTHER, THIRD } from "./helpers/reconciliation-fixtures.js";

function random(seed) {
  let state = seed >>> 0;
  return limit => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
}

/** Independent event oracle: balance is maintained while generating valid transfers. */
function generated(seed, agent, chainId, account) {
  const next = random(seed);
  const partner = account === OTHER ? THIRD : OTHER;
  const rows = [];
  let balance = 10000n;
  let received = 0n;
  let sent = 0n;
  let minted = 0n;
  let burned = 0n;
  let self = 0;
  let zeros = 0;
  for (let index = 0; index < 80; index++) {
    const kind = next(5);
    const amount = index % 11 === 0 ? 0n : BigInt(next(50));
    const from = kind === 0 ? ZERO_ADDRESS : kind === 1 ? partner : account;
    const to = kind === 2 ? ZERO_ADDRESS : kind === 3 ? partner : account;
    if (from === account) { balance -= amount; sent += amount; }
    if (to === account) { balance += amount; received += amount; }
    if (from === ZERO_ADDRESS) minted += amount;
    if (to === ZERO_ADDRESS) burned += amount;
    if (from === account && to === account) self++;
    if (amount === 0n) zeros++;
    const block = 31 + Math.floor(index / 4);
    rows.push(event({ from, to, amountBaseUnits: amount.toString(),
      blockNumber: String(block), blockHash: hash(block), transactionIndex: String(index % 4) }, index));
  }
  const selected = context(agent, chainId, account);
  const slot = scenario(agent, {}, chainId, account);
  slot.earlier.balanceBaseUnits = "10000";
  slot.later = { ...slot.later, blockNumber: "50", blockHash: hash(50), balanceBaseUnits: balance.toString() };
  // Three consistent overlapping records exercise deduplication and interval unions.
  slot.archive = archive([[30, 40], [36, 46], [42, 50]].map(([from, to]) => record(from, to,
    rows.filter(row => Number(row.blockNumber) >= from && Number(row.blockNumber) <= to), selected)));
  return { slot, rows, balance, received, sent, minted, burned, self, zeros };
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) test(`generated conservation and ledger invariants ${agent}/${chainId}`, () => {
    for (const seed of [1, 2, 17, 42, 31337, 4294967295]) {
      const expected = generated(seed, agent, chainId, agent === "EMA" ? OTHER : ACCOUNT);
      const input = workspace([expected.slot]);
      const report = reconcileWorkspace(input).slots.find(row => row.agent === agent);
      assert.equal(report.status, "arithmetic-agreement");
      assert.equal(report.totals.incomingBaseUnits, expected.received.toString());
      assert.equal(report.totals.outgoingBaseUnits, expected.sent.toString());
      assert.equal(report.totals.netTransferBaseUnits, (expected.balance - 10000n).toString());
      assert.equal(report.totals.selfTransferCount, expected.self);
      assert.equal(report.totals.zeroValueCount, expected.zeros);
      assert.equal(report.totals.eventCount, 80);
      assert.equal(report.coverage.coveredBlocks, "20");
      assert.equal(report.coverage.missingBlocks, "0");
      assert.equal(report.events.at(-1).impliedBalanceBaseUnits, expected.balance.toString());
      const ledger = reconciliationBlockLedger(input, agent);
      assert.equal(ledger.rows.reduce((sum, row) => sum + BigInt(row.mintedBaseUnits), 0n), expected.minted);
      assert.equal(ledger.rows.reduce((sum, row) => sum + BigInt(row.burnedBaseUnits), 0n), expected.burned);
      assert.equal(ledger.rows.reduce((sum, row) => sum + row.eventCount, 0), 80);
      assert.equal(ledger.rows.reduce((sum, row) => sum + BigInt(row.netBaseUnits), 0n), expected.balance - 10000n);
      assert.equal(ledger.rows.at(-1).closingImpliedBaseUnits, expected.balance.toString());
      const evidence = reconciliationEvidence(input, agent);
      assert.equal(evidence.events.length, 80);
      assert.ok(evidence.events.some(row => row.sourcePeriods.length > 1));
      assert.ok(evidence.events.every(row => row.countedTimes === 1));
    }
  });
}

test("different archive partitioning yields identical counted events and amounts", () => {
  const expected = generated(17, "DAT", 8453, ACCOUNT);
  const single = { ...expected.slot, archive: archive([record(30, 50, expected.rows)]) };
  const a = reconcileWorkspace(workspace([expected.slot])).slots[0];
  const b = reconcileWorkspace(workspace([single])).slots[0];
  assert.deepEqual(a.totals, b.totals);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.coverage, b.coverage);
  assert.equal(a.archiveRecords, 3);
  assert.equal(b.archiveRecords, 1);
});

test("a missing range never receives a complete status even when its net change cancels", () => {
  const expected = generated(42, "DAT", 8453, ACCOUNT);
  const selected = context();
  expected.slot.archive = archive([
    record(30, 38, expected.rows.filter(row => BigInt(row.blockNumber) <= 38n), selected),
    record(41, 50, expected.rows.filter(row => BigInt(row.blockNumber) >= 41n), selected),
  ]);
  const row = reconcileWorkspace(workspace([expected.slot])).slots[0];
  assert.equal(row.status, "incomplete-history");
  assert.equal(row.coverage.missingBlocks, "2");
  assert.deepEqual(row.coverage.gaps, [{ fromBlock: "39", toBlock: "40" }]);
});

test("valid arithmetic cannot hide an intermediate balance above the catalog issuance", () => {
  const slot = scenario();
  const maximum = BigInt(catalogToken({ agent: "DAT", chainId: 8453 }).initialSupply);
  slot.earlier.balanceBaseUnits = maximum.toString();
  slot.later.balanceBaseUnits = maximum.toString();
  slot.archive = archive([record(30, 42, [
    event({ amountBaseUnits: "1" }, 0),
    event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "1" }, 1),
  ])]);
  const result = reconcileWorkspace(workspace([slot])).slots[0];
  assert.equal(result.totals.residualBaseUnits, "0");
  assert.equal(result.status, "inconsistent-history");
  assert.ok(result.warnings.includes("IMPLIED_BALANCE_EXCEEDS_ISSUANCE"));
});

test("self transfer cannot spend more than the inferred opening balance", () => {
  const slot = scenario();
  slot.earlier.balanceBaseUnits = "1";
  slot.later.balanceBaseUnits = "1";
  slot.archive = archive([record(30, 42, [event({ from: ACCOUNT, to: ACCOUNT, amountBaseUnits: "2" })])]);
  const result = reconcileWorkspace(workspace([slot])).slots[0];
  assert.equal(result.status, "inconsistent-history");
  assert.equal(result.totals.netTransferBaseUnits, "0");
  assert.ok(result.warnings.includes("SELF_TRANSFER_EXCEEDS_BALANCE"));
});

test("maximum-sized archive preserves all 6000 logs while display remains bounded", () => {
  const selected = context("CAWELON", 84532);
  const slot = scenario("CAWELON", {}, 84532);
  slot.earlier.blockNumber = "29";
  slot.earlier.blockHash = hash(29);
  slot.later.blockNumber = "41";
  slot.later.blockHash = hash(41);
  slot.later.balanceBaseUnits = slot.earlier.balanceBaseUnits;
  const records = [];
  for (let block = 30; block <= 41; block++) records.push(record(block, block,
    Array.from({ length: 500 }, (_, index) => event({
      blockNumber: String(block), blockHash: hash(block),
      from: ACCOUNT, to: ACCOUNT, amountBaseUnits: "1", transactionIndex: String(index),
    }, (block - 30) * 500 + index)), selected));
  slot.archive = archive(records);
  const input = workspace([slot]);
  const result = reconcileWorkspace(input).slots[2];
  assert.equal(result.status, "arithmetic-agreement");
  assert.equal(result.totals.eventCount, 6000);
  assert.equal(result.totals.selfTransferCount, 6000);
  assert.equal(result.totals.residualBaseUnits, "0");
  const page = queryReconciliationEvents(input, { agent: "CAWELON", direction: "all", search: "", page: 239 });
  assert.equal(page.rows.length, 25);
  assert.equal(page.pages, 240);
  assert.equal(page.rows.at(-1).logIndex, "5999");
  const ledger = reconciliationBlockLedger(input, "CAWELON");
  assert.equal(ledger.rows.length, 12);
  assert.ok(ledger.rows.every(row => row.eventCount === 500));
});

test("checksum roundtrip retains mixed metadata errors for diagnosis rather than endorsing them", async () => {
  const slot = scenario();
  slot.earlier.metadata.symbol = "OTHER";
  slot.later.metadata.decimals = 6;
  const encoded = await prepareReconciliationFile(workspace([slot]));
  const restored = await decodeReconciliationFile(encoded.text);
  const result = reconcileWorkspace(restored.workspace).slots[0];
  assert.equal(result.status, "not-comparable");
  assert.ok(result.issues.includes("EARLIER_METADATA_UNUSABLE"));
  assert.ok(result.issues.includes("LATER_METADATA_UNUSABLE"));
  assert.equal(result.totals, null);
  assert.equal(restored.authenticated, false);
});

test("conflicting overlapping archive evidence is rejected before any replacement", () => {
  const first = record(30, 42, [event()]);
  const second = record(35, 45, []);
  assert.throws(() => archive([first, second]), error => error.code === "TRANSFER_ARCHIVE_OVERLAP");
  const f = createReconciliationController({ initial: workspace() });
  const before = reconciliationKey(f.state.workspace);
  const candidate = clone(workspace());
  candidate.slots[0].archive.records.push(second);
  assert.equal(f.propose(candidate), false);
  assert.equal(reconciliationKey(f.state.workspace), before);
  assert.equal(f.state.review, null);
});

test("repeated review cancel apply undo and redo match an independent history model", () => {
  const next = random(12345);
  const f = createReconciliationController();
  let model = emptyReconciliationWorkspace();
  let undo = [];
  let redo = [];
  for (let step = 0; step < 60; step++) {
    const action = next(4);
    if (action < 2) {
      const agent = ["DAT", "EMA", "CAWELON"][next(3)];
      const candidate = clone(model);
      const index = ["DAT", "EMA", "CAWELON"].indexOf(agent);
      candidate.slots[index] = scenario(agent, {}, 8453, step % 2 ? ACCOUNT : OTHER);
      candidate.slots[index].later.balanceBaseUnits = String(100 + step);
      assert.equal(f.propose(candidate), true);
      if (action === 0) {
        assert.equal(f.cancel(), true);
      } else {
        assert.equal(f.apply(true), true);
        undo = [...undo, model].slice(-8);
        model = candidate;
        redo = [];
      }
    } else if (action === 2) {
      assert.equal(f.travel("undo"), undo.length > 0);
      if (undo.length) {
        redo = [...redo, model].slice(-8);
        model = undo.pop();
      }
    } else {
      assert.equal(f.travel("redo"), redo.length > 0);
      if (redo.length) {
        undo = [...undo, model].slice(-8);
        model = redo.pop();
      }
    }
    assert.equal(reconciliationKey(f.state.workspace), reconciliationKey(model), "step " + step);
    assert.equal(f.state.undoDepth, undo.length);
    assert.equal(f.state.redoDepth, redo.length);
  }
  f.dispose();
});
