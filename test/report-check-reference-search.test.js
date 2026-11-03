import test from "node:test";
import assert from "node:assert/strict";
import { reportSetDiagnostics, querySetDiagnostics } from "../src/report-set-diagnostics.js";
import { analyzeReportSet } from "../src/report-set-engine.js";
import { sequenceSet, sequenceHistory, demoSetHistory } from "./helpers/report-set-fixtures.js";

test("an exported check ID locates the same check without changing global findings", () => {
  const source = sequenceSet(demoSetHistory()), all = reportSetDiagnostics(source), before = JSON.stringify(source);
  const target = all.items.find(item => item.id === "check-8"); assert.ok(target);
  const result = querySetDiagnostics(source, { search: " CHECK-8 " });
  assert.equal(result.matched, 1); assert.deepEqual(result.items, [target]);
  assert.equal(result.count, all.count); assert.deepEqual(result.counts, all.counts);
  assert.equal(JSON.stringify(source), before); assert.equal(analyzeReportSet(source).allContinuous, false);
});
test("source report IDs find every referencing check even when the display name differs", () => {
  const source = sequenceSet(demoSetHistory()), all = reportSetDiagnostics(source), id = source.entries[0].id;
  const expected = all.items.filter(item => item.reportIds.includes(id)); assert.ok(expected.length > 0);
  assert.deepEqual(querySetDiagnostics(source, { search: id.toUpperCase() }).items, expected);
});
test("a complete stored hash locates contradictory observations with case-insensitive literal search", () => {
  const source = sequenceSet(demoSetHistory()), all = reportSetDiagnostics(source);
  const target = all.items.find(item => item.kind === "hash-conflict"), hash = target.observations[0].hash;
  const expected = all.items.filter(item => item.observations.some(value => value.hash === hash));
  assert.deepEqual(querySetDiagnostics(source, { search: hash.toUpperCase() }).items, expected);
});
test("exact integer text in a conflicting stored balance is searchable without conversion", () => {
  const source = sequenceSet(sequenceHistory([0n, 0n])), all = reportSetDiagnostics(source);
  const target = all.items.find(item => item.kind === "balance-conflict"), amount = target.observations[0].value;
  assert.ok(amount.length > 16);
  const result = querySetDiagnostics(source, { search: amount });
  assert.ok(result.items.some(item => item.id === target.id)); assert.ok(result.matched > 0);
});
test("reference search still respects token and severity and treats punctuation literally", () => {
  const source = sequenceSet(demoSetHistory()), all = reportSetDiagnostics(source), id = source.entries[0].id;
  const expected = all.items.filter(item => item.reportIds.includes(id) && item.agents.includes("EMA") && item.severity === "conflict");
  assert.ok(expected.length > 0);
  assert.deepEqual(querySetDiagnostics(source, { search: id, agent: "EMA", severity: "conflict" }).items, expected);
  assert.equal(querySetDiagnostics(source, { search: ".*" }).matched, 0);
  assert.equal(querySetDiagnostics(source, { search: "[check-8]" }).matched, 0);
});
