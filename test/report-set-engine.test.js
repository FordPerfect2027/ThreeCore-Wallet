import test from "node:test";
import assert from "node:assert/strict";
import { analyzeReportSet } from "../src/report-set-engine.js";
import { sequenceHistory, sequenceSet, historyRecord, historyDocument, shiftedReport,
  reportInput, clone, id, UNIT, forkedInput } from "./helpers/report-set-fixtures.js";

test("three adjacent captured periods form separate DAT EMA CAWELON continuity groups", () => {
  const result = analyzeReportSet(sequenceSet());
  assert.equal(result.allContinuous, true);
  assert.deepEqual(result.issues, []);
  for (const token of result.tokens) {
    assert.equal(token.groups.length, 1);
    const group = token.groups[0];
    assert.equal(group.start, "30"); assert.equal(group.end, "66");
    assert.equal(group.plannedUniqueBlocks, "36");
    assert.equal(group.gapBlocks, "0"); assert.equal(group.overlapBlocks, "0");
    assert.deepEqual(group.rows.map(row => row.reportId), [id(101), id(102), id(103)]);
    assert.deepEqual(group.links.map(row => [row.beforeId, row.afterId]), [[id(101), id(102)], [id(102), id(103)]]);
    assert.ok(group.links.every(row => row.continuousEvidence));
    assert.match(group.tokenAddress, /^0x[0-9a-fA-F]{40}$/);
  }
  assert.equal(result.eventsCombined, false); assert.equal(result.tokenAmountsSummed, false);
  assert.equal(result.liveChainRechecked, false); assert.equal(result.independentlyVerified, false);
  assert.equal(result.provesProfit, false);
});
test("group ordering follows block positions regardless of saved dates or selection order", () => {
  const history = sequenceHistory();
  const set = sequenceSet(history, [id(103), id(101), id(102)]);
  const result = analyzeReportSet(set);
  assert.equal(result.allContinuous, true);
  assert.deepEqual(result.reports.map(row => row.id), [id(103), id(101), id(102)]);
  assert.deepEqual(result.tokens[0].groups[0].rows.map(row => row.reportId), [id(101), id(102), id(103)]);
});
test("single captured period does not certify multi-period continuity", () => {
  const result = analyzeReportSet(sequenceSet(sequenceHistory([0n])));
  assert.equal(result.allContinuous, false); assert.deepEqual(result.issues, ["SINGLE_REPORT"]);
  assert.equal(result.tokens[0].groups[0].plannedUniqueBlocks, "12");
});
for (const gap of [1n, 7n, 100n, 9007199254740999n]) {
  test("gap is exact beyond safe JS integers: " + gap, () => {
    const result = analyzeReportSet(sequenceSet(sequenceHistory([0n, 12n + gap])));
    for (const token of result.tokens) {
      const group = token.groups[0];
      assert.equal(group.gapBlocks, gap.toString());
      assert.equal(group.plannedUniqueBlocks, "24");
      assert.equal(group.segments.find(row => row.kind === "gap").reportIds.length, 0);
    }
    assert.ok(result.issues.includes("GAPS")); assert.equal(result.allContinuous, false);
  });
}
for (const offset of [1n, 6n, 11n]) {
  test("overlap length excludes duplicated block coverage: " + offset, () => {
    const result = analyzeReportSet(sequenceSet(sequenceHistory([0n, offset])));
    const group = result.tokens[0].groups[0];
    assert.equal(group.plannedUniqueBlocks, (12n + offset).toString());
    assert.equal(group.overlapBlocks, (12n - offset).toString());
    assert.ok(group.segments.some(row => row.reportIds.length === 2));
    assert.equal(result.allContinuous, false);
  });
}
test("identical evidence with different report titles is called repeated, never additive", () => {
  const input = reportInput();
  const history = historyDocument([historyRecord(1, { report: input }),
    historyRecord(2, { report: { ...input, title: "別名の同じ証拠" } })]);
  const result = analyzeReportSet(sequenceSet(history));
  assert.ok(result.issues.includes("REPEATED_EVIDENCE"));
  for (const token of result.tokens) {
    assert.equal(token.groups[0].plannedUniqueBlocks, "12");
    assert.equal(token.groups[0].overlapBlocks, "12");
    assert.equal(token.groups[0].segments[0].kind, "repeated");
    assert.deepEqual(token.groups[0].duplicateEvidence, [[id(101), id(102)]]);
  }
});
test("same interval with different evidence is an overlap, not an identical duplicate", () => {
  const history = sequenceHistory([0n, 0n]);
  const result = analyzeReportSet(sequenceSet(history));
  assert.equal(result.tokens[0].groups[0].segments[0].kind, "overlap");
  assert.ok(result.issues.includes("BALANCE_CONFLICTS"));
  assert.ok(!result.issues.includes("REPEATED_EVIDENCE"));
});
test("three-way overlap is measured once rather than summing pair intersections", () => {
  const group = analyzeReportSet(sequenceSet(sequenceHistory([0n, 3n, 6n]))).tokens[0].groups[0];
  assert.equal(group.plannedUniqueBlocks, "18"); assert.equal(group.overlapBlocks, "12");
  assert.ok(group.segments.some(row => row.reportIds.length === 3));
});
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test("missing " + agent + " stays visible and blocks full continuity", () => {
    const history = sequenceHistory(undefined, (value, index) => {
      if (index === 1) value.slots.find(row => row.agent === agent).entry = null;
    });
    const result = analyzeReportSet(sequenceSet(history)), token = result.tokens.find(row => row.agent === agent);
    assert.deepEqual(token.missingReportIds, [id(102)]);
    assert.equal(token.groups[0].gapBlocks, "12"); assert.equal(result.allContinuous, false);
  });
  test("restricted " + agent + " evidence cannot certify a sequence", () => {
    const history = sequenceHistory(undefined, (value, index) => {
      if (index === 1) value.slots.find(row => row.agent === agent).entry.requiresNewPlan = true;
    });
    const result = analyzeReportSet(sequenceSet(history));
    assert.ok(result.issues.includes("INCOMPLETE_EVIDENCE"));
    assert.equal(result.tokens.find(row => row.agent === agent).continuous, false);
    assert.equal(result.allContinuous, false);
  });
  test("cross-report fork in " + agent + " exposes hashes without combining values", () => {
    const source = sequenceHistory(); const entries = [...source.entries];
    entries[1] = historyRecord(2, { report: forkedInput(agent, source.entries[1].report) });
    const result = analyzeReportSet(sequenceSet(historyDocument(entries)));
    assert.ok(result.issues.includes("HASH_CONFLICTS")); assert.ok(result.anchors.conflicts.length > 0);
    assert.equal(result.allContinuous, false);
  });
}
test("different chains are separated despite matching addresses and blocks", () => {
  const first = historyRecord(1);
  const second = historyRecord(2, { report: shiftedReport(12n, 7n * UNIT, reportInput({ chainId: 8453 })) });
  const result = analyzeReportSet(sequenceSet(historyDocument([first, second])));
  assert.ok(result.issues.includes("MIXED_CONTEXTS"));
  assert.equal(result.anchors.conflicts.length, 0);
  assert.ok(result.tokens.every(token => token.groups.length === 2));
});
test("partial acquisition contributes only a plan, not certified evidence coverage", () => {
  const partial = shiftedReport(12n, 7n * UNIT, reportInput({ counts: [5, 5, 3] }));
  const result = analyzeReportSet(sequenceSet(historyDocument([historyRecord(1), historyRecord(2, { report: partial })])));
  const group = result.tokens[2].groups[0];
  assert.equal(group.plannedUniqueBlocks, "24");
  assert.deepEqual(group.incompleteReports, [id(102)]);
  assert.ok(group.segments.some(row => !row.allArithmeticAgreement));
  assert.equal(result.allContinuous, false);
});
test("same boundary hash with different balances exposes a conflict even when each interval reconciles", () => {
  const history = historyDocument([historyRecord(1), historyRecord(2, { report: shiftedReport(12n, 8n * UNIT) })]);
  const result = analyzeReportSet(sequenceSet(history));
  assert.ok(result.issues.includes("BALANCE_CONFLICTS"));
  const conflict = result.tokens[0].groups[0].balanceConflicts[0];
  assert.equal(conflict.block, "42");
  assert.deepEqual(conflict.observations.map(row => row.value), [(107n * UNIT).toString(), (108n * UNIT).toString()]);
});
test("archived snapshots remain analyzable and visibly counted", () => {
  const history = clone(sequenceHistory()); history.entries[1].archived = true;
  const result = analyzeReportSet(sequenceSet(history));
  assert.equal(result.archivedCount, 1); assert.equal(result.allContinuous, true);
  assert.equal(result.tokens[0].groups[0].rows[1].archivedReport, true);
});
test("analysis is deterministic, deeply frozen and leaves original snapshots untouched", () => {
  const value = clone(sequenceSet()); const before = JSON.stringify(value);
  const result = analyzeReportSet(value);
  assert.deepEqual(result, analyzeReportSet(value)); assert.equal(JSON.stringify(value), before);
  assert.ok(Object.isFrozen(result.tokens[0].groups[0].segments[0].reportIds));
  assert.ok(!JSON.stringify(result).includes('"evidenceKey"'));
  assert.ok(!JSON.stringify(result).includes('"draft"'));
});

// A separate discrete-block oracle checks union and overlap arithmetic, including gaps.
for (const offsets of [[0, 2, 30], [0, 12, 25], [0, 1, 2, 3], [0, 20, 22, 40], [24, 0, 12], [0, 11, 22, 33]]) {
  test("interval sweep matches explicit block membership: " + offsets.join(","), () => {
    const group = analyzeReportSet(sequenceSet(sequenceHistory(offsets.map(BigInt)))).tokens[0].groups[0];
    let union = 0, gaps = 0, overlaps = 0;
    for (let block = Math.min(...offsets) + 31; block <= Math.max(...offsets) + 42; block++) {
      const members = offsets.filter(offset => block > offset + 30 && block <= offset + 42).length;
      if (members) union++; else gaps++;
      if (members > 1) overlaps++;
    }
    assert.equal(group.plannedUniqueBlocks, String(union));
    assert.equal(group.gapBlocks, String(gaps));
    assert.equal(group.overlapBlocks, String(overlaps));
  });
}
