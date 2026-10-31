import test from "node:test";
import assert from "node:assert/strict";
import { reportSetDiagnosticsCSV } from "../src/report-set-export.js";
import { querySetDiagnostics } from "../src/report-set-diagnostics.js";
import { analyzeReportSet } from "../src/report-set-engine.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, sequenceHistory, demoSetHistory, historyMemory, clone, AFTER } from "./helpers/report-set-fixtures.js";

function csvRows(text) {
  const rows = []; let row = [], value = "", quoted = false;
  text = text.replace(/^\ufeff/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if (char === '\r' && text[i + 1] === '\n' && !quoted) {
      row.push(value); rows.push(row); row = []; value = ''; i++;
    } else value += char;
  }
  assert.equal(quoted, false); assert.equal(value, '');
  const [columns, ...values] = rows;
  return values.map(row => {
    assert.equal(row.length, columns.length);
    return Object.fromEntries(columns.map((key, i) => [key, row[i]]));
  });
}
const source = () => sequenceSet(demoSetHistory());
test("checklist CSV retains a source-wide summary and every matching diagnostic in deterministic order", () => {
  const input = source(), before = JSON.stringify(input), report = analyzeReportSet(input), checks = querySetDiagnostics(input, {});
  const file = reportSetDiagnosticsCSV(input), [summary, ...rows] = csvRows(file.text);
  assert.equal(file.matched, checks.count); assert.equal(rows.length, checks.count);
  assert.equal(summary.row_type, 'summary'); assert.equal(summary.total_checks, String(checks.count));
  assert.equal(summary.all_continuous, 'false');
  assert.deepEqual(rows.map(row => row.check_id), checks.items.map(item => item.id));
  assert.ok(rows.every(row => row.row_type === 'check' && row.automatic_repairs === 'false' && row.live_chain_rechecked === 'false'));
  assert.equal(file.byteLength, new TextEncoder().encode(file.text).byteLength);
  assert.equal(file.restorable, false); assert.equal(file.containsOriginalEvidence, false);
  assert.equal(JSON.stringify(input), before); assert.deepEqual(analyzeReportSet(input), report);
});
test("token and severity filtering keep full-source counts while selecting only matching checks", () => {
  const input = source(), query = { agent: 'EMA', severity: 'conflict', search: '' };
  const checks = querySetDiagnostics(input, query), [summary, ...rows] = csvRows(reportSetDiagnosticsCSV(input, query).text);
  assert.ok(checks.matched > 0); assert.equal(rows.length, checks.matched);
  assert.equal(summary.source_conflicts, String(checks.counts.conflict));
  assert.ok(rows.every(row => row.agents.split(' ').includes('EMA') && row.severity === 'conflict'));
});
test("zero matches never erase existing conflicts or become a clean report", () => {
  const input = source(), file = reportSetDiagnosticsCSV(input, { search: 'no matching record' });
  const rows = csvRows(file.text);
  assert.equal(file.matched, 0); assert.equal(rows.length, 1);
  assert.equal(rows[0].matched_checks, '0'); assert.ok(Number(rows[0].source_conflicts) > 0);
  assert.equal(rows[0].all_continuous, 'false'); assert.equal(rows[0].check_id, '');
});
test("continuous evidence exports a truthful empty checklist without invented checks", () => {
  const [summary, ...rows] = csvRows(reportSetDiagnosticsCSV(sequenceSet()).text);
  assert.equal(rows.length, 0); assert.equal(summary.total_checks, '0'); assert.equal(summary.all_continuous, 'true');
  assert.equal(summary.live_chain_rechecked, 'false');
});
test("export options control structured addresses and notes while preserving exact labels and IDs", () => {
  const input = clone(sequenceSet(sequenceHistory([0n, 24n])));
  input.entries[0].note = 'PRIVATE_NOTE\nsecond line'; input.entries[0].label = '=SUM(1,2) "label"';
  const short = reportSetDiagnosticsCSV(input), full = reportSetDiagnosticsCSV(input, {}, { includeNotes: true, shortAddresses: false });
  assert.ok(!short.text.includes('PRIVATE_NOTE')); assert.ok(full.text.includes('PRIVATE_NOTE'));
  const shortRows = csvRows(short.text).slice(1), fullRows = csvRows(full.text).slice(1);
  assert.ok(shortRows.every(row => row.account.includes('…')));
  assert.ok(fullRows.every(row => /^0x[0-9a-f]{40}$/.test(row.account)));
  assert.deepEqual(JSON.parse(fullRows[0].report_ids), input.entries.map(entry => entry.id));
  assert.deepEqual(JSON.parse(fullRows[0].report_labels), input.entries.map(entry => entry.label));
  assert.deepEqual(JSON.parse(fullRows[0].notes), input.entries.map(entry => entry.note));
  assert.equal(fullRows[0].range_notation, '(start,end]');
});
test("query formula text is inert and invalid option accessors are never executed", () => {
  const [summary] = csvRows(reportSetDiagnosticsCSV(source(), { search: '=SUM(1,2)' }).text);
  assert.equal(summary.query_search, "'=sum(1,2)");
  let reads = 0;
  for (const [query, options] of [[{ get search() { reads++; return ''; } }, {}], [{}, { get includeNotes() { reads++; return true; } }]]) {
    assert.throws(() => reportSetDiagnosticsCSV(source(), query, options));
  }
  assert.equal(reads, 0);
});
async function ready(onChange = () => {}) {
  const history = demoSetHistory(), storage = historyMemory(history).storage;
  const controller = createReportSetController({ storage, now: () => AFTER, onChange });
  await controller.refresh(); controller.select(history.entries.map(row => row.id)); controller.prepare('Checks'); await controller.applyReview();
  return controller;
}
test("checklist export requires acknowledgement and retries refused delivery without changing evidence", async () => {
  const controller = await ready(), files = [], before = controller.state.input;
  try {
    assert.equal(await controller.exportFile('checks-csv', false, file => files.push(file)), false);
    assert.equal(files.length, 0);
    assert.equal(await controller.exportFile('checks-csv', true, () => false), false);
    assert.equal(await controller.exportFile('checks-csv', true, file => files.push(file), {}, { severity: 'conflict' }), true);
    assert.equal(files.length, 1); assert.equal(files[0].query.severity, 'conflict');
    assert.equal(controller.state.input, before); assert.equal(controller.state.busy, false);
  } finally { controller.dispose(); }
});
test("checklist export captures options before observers and does not deliver after cancellation", async () => {
  let action = null; const controller = await ready(state => { if (state.phase === 'exporting') action?.(); });
  try {
    const query = { severity: 'conflict' }, files = [];
    action = () => { query.severity = 'missing'; };
    assert.equal(await controller.exportFile('checks-csv', true, file => files.push(file), {}, query), true);
    assert.equal(files[0].query.severity, 'conflict');
    action = () => controller.cancel();
    assert.equal(await controller.exportFile('checks-csv', true, file => files.push(file)), false);
    assert.equal(files.length, 1); assert.equal(controller.state.busy, false);
  } finally { controller.dispose(); }
});
