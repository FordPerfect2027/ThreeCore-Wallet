import test from "node:test";
import assert from "node:assert/strict";
import { reportSetDiagnostics, querySetDiagnostics, diagnosticQuery,
  diagnosticText } from "../src/report-set-diagnostics.js";
import { analyzeReportSet } from "../src/report-set-engine.js";
import { sequenceSet, sequenceHistory, demoSetHistory, clone,
  historyDocument, historyRecord, forkedInput, shiftedReport, UNIT } from "./helpers/report-set-fixtures.js";

test("continuous evidence yields no invented remediation tasks", () => {
  const result = reportSetDiagnostics(sequenceSet());
  assert.equal(result.count, 0);
  assert.deepEqual(result.counts, { conflict: 0, missing: 0, review: 0, information: 0 });
  assert.equal(result.automaticRepairs, false);
  assert.equal(result.liveChainRechecked, false);
});

test("a single report has a specific limitation rather than a false failure", () => {
  const input = sequenceSet(sequenceHistory([0n]));
  const result = reportSetDiagnostics(input);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].kind, "single-report");
  assert.equal(result.items[0].severity, "information");
  assert.deepEqual(result.items[0].reportIds, [input.entries[0].id]);
  assert.match(result.items[0].action, /1件だけでは/);
});

test("gap diagnostics identify the enclosing reports and exact exclusive range", () => {
  const input = sequenceSet(sequenceHistory([0n, 24n]));
  const gaps = reportSetDiagnostics(input).items.filter(row => row.kind === "gap");
  assert.equal(gaps.length, 3);
  for (const item of gaps) {
    assert.equal(item.fromBlock, "42");
    assert.equal(item.toBlock, "54");
    assert.equal(item.blocks, "12");
    assert.deepEqual(item.reportIds, input.entries.map(entry => entry.id));
    assert.match(item.action, /自動取得しません/);
    assert.match(diagnosticText(item), /\(42, 54\]/);
  }
});

test("overlap diagnostics locate evidence instead of suggesting financial addition", () => {
  const input = sequenceSet(sequenceHistory([0n, 6n]));
  const overlaps = reportSetDiagnostics(input).items.filter(row => row.kind === "overlap");
  assert.equal(overlaps.length, 3);
  assert.ok(overlaps.every(row => row.blocks === "6"));
  assert.ok(overlaps.every(row => row.reportIds.length === 2));
  assert.ok(overlaps.every(row => row.action.includes("合算しません")));
});

test("repeated evidence has a selection-only remedy and never a delete instruction", () => {
  const history = demoSetHistory();
  const input = sequenceSet(history, [history.entries[1].id, history.entries[4].id]);
  const repeats = reportSetDiagnostics(input).items.filter(row => row.kind === "repeated");
  assert.equal(repeats.length, 3);
  assert.ok(repeats.every(row => row.action.includes("選択から外して")));
  assert.ok(repeats.every(row => row.action.includes("削除しません")));
});

test("missing token diagnostics retain the affected report identity", () => {
  const input = sequenceSet(sequenceHistory([0n, 12n], (value, index) => {
    if (index === 1) value.slots[1].entry = null;
  }));
  const item = reportSetDiagnostics(input).items.find(row => row.kind === "missing-token");
  assert.deepEqual(item.agents, ["EMA"]);
  assert.deepEqual(item.reportIds, [input.entries[1].id]);
  assert.equal(item.severity, "missing");
});

test("boundary disagreements show the shared block and both report IDs", () => {
  const input = sequenceSet(sequenceHistory([0n, 12n], (value, index) => {
    if (index === 1) {
      value.slots[0].entry.draft.earlier.balanceBaseUnits = (108n * UNIT).toString();
      value.slots[0].entry.draft.later.balanceBaseUnits = (115n * UNIT).toString();
    }
  }));
  const result = reportSetDiagnostics(input);
  const boundary = result.items.find(row => row.kind === "boundary-conflict");
  assert.equal(boundary.fromBlock, "42");
  assert.equal(boundary.toBlock, "42");
  assert.deepEqual(boundary.agents, ["DAT"]);
  assert.deepEqual(boundary.reportIds, input.entries.map(entry => entry.id));
  const balance = result.items.find(row => row.kind === "balance-conflict");
  assert.equal(balance.observations.length, 2);
  assert.deepEqual(new Set(balance.observations.map(row => row.value)),
    new Set([(107n * UNIT).toString(), (108n * UNIT).toString()]));
  assert.ok(!diagnosticText(balance).includes((108n * UNIT).toString()));
  assert.ok(diagnosticText(balance, { includeObservations: true }).includes((108n * UNIT).toString()));
});

test("hash conflicts mark every affected token instead of presenting green cards", () => {
  const good = sequenceHistory([0n, 12n]);
  const input = sequenceSet(historyDocument([
    good.entries[0], historyRecord(2, { report: forkedInput("EMA", good.entries[1].report) }),
  ]));
  const analysis = analyzeReportSet(input);
  assert.equal(analysis.allContinuous, false);
  assert.ok(analysis.tokens.every(token => !token.continuous));
  assert.ok(analysis.tokens.every(token => token.hashConflictCount > 0));
  const hashes = reportSetDiagnostics(input).items.filter(row => row.kind === "hash-conflict");
  assert.ok(hashes.length > 0);
  assert.ok(hashes.every(row => row.chainId === 84532));
  assert.ok(hashes.some(row => row.agents.length === 3));
  assert.ok(hashes.every(row => row.action.includes("原因はこの保存データだけでは確定できません")));
});

test("partial and archived records remain distinguishable review items", () => {
  const source = demoSetHistory();
  const input = sequenceSet(source, [source.entries[2].id, source.entries[6].id]);
  const result = reportSetDiagnostics(input);
  const incomplete = result.items.find(row => row.kind === "incomplete-evidence");
  assert.deepEqual(incomplete.agents, ["CAWELON"]);
  const archived = result.items.find(row => row.kind === "archived-report");
  assert.deepEqual(archived.reportIds, [source.entries[6].id]);
  assert.equal(archived.severity, "information");
});

test("diagnostic IDs remain stable under filtering and no item is silently marked resolved", () => {
  const input = sequenceSet(demoSetHistory());
  const all = reportSetDiagnostics(input);
  const filtered = querySetDiagnostics(input, { agent: "EMA", severity: "conflict" });
  assert.ok(filtered.matched > 0);
  assert.ok(filtered.items.every(item => item.agents.includes("EMA")));
  assert.ok(filtered.items.every(item => item.severity === "conflict"));
  assert.deepEqual(filtered.items, all.items.filter(item => item.agents.includes("EMA") && item.severity === "conflict"));
  assert.equal(filtered.count, all.count);
  assert.ok(all.items.every(item => item.resolved === undefined));
});

test("diagnostic search accepts report names, block numbers and addresses", () => {
  const input = sequenceSet(sequenceHistory([0n, 24n]));
  for (const search of ["報告 1", "42", input.entries[0].report.slots[0].entry.draft.plan.context.account]) {
    const result = querySetDiagnostics(input, { search });
    assert.ok(result.matched > 0, search);
  }
  assert.equal(querySetDiagnostics(input, { search: "does not exist" }).matched, 0);
});

for (const options of [null, [], { agent: "ETH" }, { severity: "critical" },
  { search: 1 }, { search: "a".repeat(101) }, { search: "\u202etest" }, { search: "\n" }, { hidden: true }]) {
  test("invalid diagnostic query is rejected: " + JSON.stringify(options), () => {
    assert.throws(() => diagnosticQuery(options));
  });
}

test("diagnostic output is deeply frozen and does not retain caller-owned data", () => {
  const input = clone(sequenceSet(demoSetHistory()));
  const before = JSON.stringify(input);
  const result = reportSetDiagnostics(input);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(result.items));
  assert.ok(Object.isFrozen(result.items[0].reportIds));
  input.entries[0].label = "changed later";
  assert.ok(!JSON.stringify(result).includes("changed later"));
});

test("diagnostic output is ordered by evidence conflicts before missing/review/information", () => {
  const result = reportSetDiagnostics(sequenceSet(demoSetHistory()));
  const order = ["conflict", "missing", "review", "information"];
  const ranks = result.items.map(row => order.indexOf(row.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(new Set(result.items.map(row => row.id)).size, result.items.length);
});

test("hash/amount observation output only appears when explicitly requested", () => {
  const input = sequenceSet(sequenceHistory([0n, 0n]));
  const item = reportSetDiagnostics(input).items.find(row => row.kind === "balance-conflict");
  const raw = item.observations[0];
  assert.ok(!diagnosticText(item).includes(raw.hash));
  const expanded = diagnosticText(item, { shortAddresses: false, includeObservations: true });
  assert.ok(expanded.includes(raw.hash));
  assert.ok(expanded.includes(raw.value));
  assert.ok(expanded.includes(item.account));
});
