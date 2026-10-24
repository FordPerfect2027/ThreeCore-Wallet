import { createReportSet } from "../../src/report-set-model.js";
import { validatePeriodReportInput } from "../../src/period-report-model.js";
import { historyRecord, historyDocument, historyMemory, reportInput, clone, id, AFTER,
  changedSlot, forkedInput, code, fileFrom, deferred, tick, waitUntil } from "./report-history-fixtures.js";
import { hash, UNIT } from "./period-report-fixtures.js";
export { historyRecord, historyDocument, historyMemory, reportInput, clone, id, AFTER,
  changedSlot, forkedInput, code, fileFrom, deferred, tick, waitUntil, hash, UNIT };

export function shiftedReport(blocks = 12n, balance = 7n * UNIT, input = reportInput()) {
  const copy = clone(input);
  for (const slot of copy.slots) {
    if (!slot.entry) continue;
    const draft = slot.entry.draft;
    draft.plan.earlierBlock = (BigInt(draft.plan.earlierBlock) + blocks).toString();
    draft.plan.laterBlock = (BigInt(draft.plan.laterBlock) + blocks).toString();
    for (const endpoint of [draft.earlier, draft.later]) {
      if (!endpoint) continue;
      endpoint.blockNumber = (BigInt(endpoint.blockNumber) + blocks).toString();
      endpoint.blockHash = hash(endpoint.blockNumber);
      if (endpoint.balanceBaseUnits !== null) endpoint.balanceBaseUnits = (BigInt(endpoint.balanceBaseUnits) + balance).toString();
    }
    for (const record of draft.records) {
      record.range.fromBlock = (BigInt(record.range.fromBlock) + blocks).toString();
      record.range.toBlock = (BigInt(record.range.toBlock) + blocks).toString();
      record.fromBlockHash = hash(record.range.fromBlock);
      record.toBlockHash = hash(record.range.toBlock);
      for (const event of record.events) {
        event.blockNumber = (BigInt(event.blockNumber) + blocks).toString();
        event.blockHash = hash(event.blockNumber);
        event.transactionHash = hash(BigInt(event.transactionHash) + blocks);
      }
    }
  }
  return validatePeriodReportInput(copy);
}

export function sequenceHistory(offsets = [0n, 12n, 24n], transform = (_value, _index) => {}) {
  return historyDocument(offsets.map((offset, index) => {
    const value = clone(shiftedReport(offset, BigInt(index) * 7n * UNIT));
    value.title = "期間確認 " + (index + 1);
    transform(value, index);
    return historyRecord(index + 1, { report: value });
  }), offsets.length);
}
export function sequenceSet(history = sequenceHistory(), ids = history.entries.map(entry => entry.id)) {
  return createReportSet(history, ids, "3期間の確認", AFTER);
}
export function demoSetHistory() {
  const good = sequenceHistory().entries;
  return historyDocument([
    ...good,
    historyRecord(4, { label: "期間の抜け", report: { ...shiftedReport(48n, 28n * UNIT), title: "後日の確認" } }),
    historyRecord(5, { label: "同じ証拠の再報告", report: { ...good[1].report, title: "再確認" } }),
    historyRecord(6, { label: "EMAのハッシュ確認", report: forkedInput("EMA", good[1].report) }),
    historyRecord(7, { label: "CAWELON取得途中", archived: true,
      report: shiftedReport(36n, 21n * UNIT, reportInput({ counts: [5, 5, 3], title: "途中の控え" })) }),
  ], 7);
}
