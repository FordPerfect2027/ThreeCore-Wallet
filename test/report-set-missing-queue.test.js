import test from "node:test";
import assert from "node:assert/strict";
import { reportSetMissingHistoryQueue, missingHistoryQueueText } from "../src/report-set-timeline.js";
import { mountReportSetTimeline } from "../examples/report-set-timeline-panel.js";
import { sequenceSet, sequenceHistory, demoSetHistory, historyRecord, historyDocument, reportInput, clone, id } from "./helpers/report-set-fixtures.js";
import { checkpoint, plan } from "./helpers/period-fixtures.js";
import { Element } from "./helpers/panel-dom.js";

const single = report => sequenceSet(historyDocument([historyRecord(1, { report })]));
const large = () => single(reportInput({ changes: { DAT: { draft: checkpoint(0, plan({ laterBlock: "24030", windowSize: 2000 })) } } }));
const query = changes => ({ groupId: "DAT-1", ...changes });
test("a 24,000-block missing range is proposed as 2,000 by 10 then the remaining two windows", () => {
  const input = large(), before = JSON.stringify(input), first = reportSetMissingHistoryQueue(input, query()), second = reportSetMissingHistoryQueue(input, query({ page: "1" }));
  assert.deepEqual([first.totalBlocks, first.totalWindows, first.pageCount, first.pageBlocks], ["24000", "12", "2", "20000"]);
  assert.deepEqual(first.items[0], { number: "1", fromBlock: "22031", toBlock: "24030", blocks: "2000", plannedReportIds: [id(101)] });
  assert.equal(first.items.length, 10); assert.equal(second.items.length, 2); assert.equal(second.pageBlocks, "4000");
  assert.equal(second.items[0].number, "11"); assert.equal(second.items.at(-1).fromBlock, "31");
  const all = [...first.items, ...second.items];
  all.forEach((row, index) => { if (index) assert.equal(BigInt(row.toBlock) + 1n, BigInt(all[index - 1].fromBlock)); });
  assert.equal(JSON.stringify(input), before); assert.equal(first.executed, false); assert.equal(first.automaticRetry, false);
  assert.ok(Object.isFrozen(first.items[0].plannedReportIds));
});
test("partial saved prefixes are skipped and small final windows retain exact inclusive endpoints", () => {
  const input = single(reportInput({ counts: [3, 5, 5] }));
  const value = reportSetMissingHistoryQueue(input, query({ windowSize: 3 }));
  assert.deepEqual(value.items.map(row => [row.fromBlock, row.toBlock, row.blocks]), [["40", "42", "3"], ["37", "39", "3"], ["36", "36", "1"]]);
  assert.equal(value.recordedUniqueBlocks, "5"); assert.equal(value.reviewRecordedBlocks, "5"); assert.equal(value.includesRecordedReviewRanges, false);
});
test("planning gaps require an explicit mode and huge offsets do not enumerate earlier pages", () => {
  const gap = 9007199254740999n, input = sequenceSet(sequenceHistory([0n, 12n + gap]));
  const none = reportSetMissingHistoryQueue(input, query()); assert.equal(none.totalWindows, "0");
  const first = reportSetMissingHistoryQueue(input, query({ kind: "unplanned" }));
  assert.equal(first.totalBlocks, gap.toString()); assert.equal(first.items.length, 10);
  const last = reportSetMissingHistoryQueue(input, query({ kind: "unplanned", page: (BigInt(first.pageCount) - 1n).toString() }));
  assert.equal(last.items.at(-1).fromBlock, "43"); assert.ok(last.items.length <= 10);
  assert.ok(last.items.every(row => row.plannedReportIds.length === 0));
});
test("adjacent missing cells merge across plan boundaries without scheduling saved windows", () => {
  const input = sequenceSet(sequenceHistory([0n, 6n], report => { for (const slot of report.slots) { slot.entry.draft.earlier = null; slot.entry.draft.later = null; slot.entry.draft.records = []; } }));
  const value = reportSetMissingHistoryQueue(input, query());
  assert.equal(value.items.length, 1); assert.equal(value.totalBlocks, "18");
  assert.deepEqual(value.items[0].plannedReportIds, [id(101), id(102)]);
});
test("complete but conflicting evidence is not silently proposed as missing or verified", () => {
  const value = reportSetMissingHistoryQueue(sequenceSet(demoSetHistory()), query());
  assert.equal(value.totalWindows, "0"); assert.equal(value.pageCount, "0"); assert.deepEqual(value.items, []);
  assert.ok(BigInt(value.reviewRecordedBlocks) > 0n); assert.equal(value.completeHistory, false); assert.equal(value.liveChainRechecked, false);
  assert.match(missingHistoryQueueText(value), /この予定には含めていません/);
  assert.match(missingHistoryQueueText(value), /読み取りは実行していません/);
});
test("unknown groups, malformed options and out-of-range pages fail without invoking getters", () => {
  const input = large(); let touched = 0;
  const getter = { groupId: "DAT-1", get page() { touched++; return "0"; } };
  for (const options of [getter, query({ windowSize: 2001 }), query({ windowSize: "2000" }), query({ windowSize: 0 }), query({ windowSize: 1.5 }),
    query({ kind: "recorded" }), query({ page: "00" }), query({ page: "-1" }), query({ page: 0 }), query({ page: "2" }), query({ groupId: "DAT-2" })]) {
    assert.throws(() => reportSetMissingHistoryQueue(input, options));
  }
  assert.equal(touched, 0);
});
test("missing queues remain attached to the selected token and do not sum different contexts", () => {
  const input = single(reportInput({ counts: [3, 0, 5] }));
  const ema = reportSetMissingHistoryQueue(input, { groupId: "EMA-1" });
  assert.equal(ema.context.agent, "EMA"); assert.equal(ema.totalBlocks, "12");
  assert.equal(reportSetMissingHistoryQueue(input, { groupId: "CAWELON-1" }).totalBlocks, "0");
});

function panel(input = large()) {
  const parent = new Element("div"), document = { createElement: tag => new Element(tag) };
  const mounted = mountReportSetTimeline({ document, parent, input });
  return { parent, mounted, q: name => parent.find("report-set-history-queue-" + name) };
}
test("queue panel advances ten windows at a time and invalidates stale plans after editing", () => {
  const f = panel();
  try {
    f.q("show").click(); assert.match(f.q("output").textContent, /このページ: 20000ブロック \/ 10回分/);
    assert.equal(f.q("previous").disabled, true); assert.equal(f.q("next").disabled, false);
    f.q("next").click(); assert.equal(f.q("page").value, "2"); assert.match(f.q("output").textContent, /4000ブロック \/ 2回分/);
    assert.equal(f.q("next").disabled, true); f.q("previous").click(); assert.equal(f.q("page").value, "1");
    f.q("size").value = "1000"; f.q("size").dispatchEvent(new Event("input"));
    assert.match(f.q("output").textContent, /表示し直してください/); assert.equal(f.q("next").disabled, true);
    f.q("show").click(); assert.match(f.q("output").textContent, /10000ブロック \/ 10回分/);
    f.q("page").value = "4"; f.q("page").dispatchEvent(new Event("input")); f.q("show").click();
    assert.match(f.q("output").textContent, /条件を確認/); assert.equal(f.q("next").disabled, true);
  } finally { f.mounted.dispose(); }
});
test("mounted queue uses captured evidence and retained buttons cannot act after disposal", () => {
  const input = clone(large()), f = panel(input);
  input.entries[0].report.slots[0].entry.draft.plan.laterBlock = "999";
  f.q("show").click(); assert.match(f.q("output").textContent, /対象全体: 24000ブロック/);
  const show = f.q("show"), next = f.q("next"), output = f.q("output"), text = output.textContent;
  f.mounted.dispose(); next.click(); show.click(); assert.equal(output.textContent, text);
});
