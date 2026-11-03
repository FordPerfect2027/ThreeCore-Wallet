import test from "node:test";
import assert from "node:assert/strict";
import { reconciliationFilteredEventsCSV } from "../src/reconciliation-view.js";
import { periodReportEventsCSV } from "../src/period-report-export.js";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { analyzePeriodReport } from "../src/period-report-engine.js";
import { createReconciliationController } from "../src/reconciliation-controller.js";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { workspace, scenario, record, archive, event, ACCOUNT, OTHER } from "./helpers/reconciliation-fixtures.js";
import { reportInput, manyEventsInput, changedSlot, memoryStorage, reportLibrary } from "./helpers/period-report-fixtures.js";

const query = changes => ({ agent: "DAT", direction: "all", search: "", page: 2, ...changes });
function reconciliationInput() {
  const slot = scenario();
  slot.archive = archive([record(30, 42, Array.from({ length: 61 }, (_, i) => event({
    from: i % 2 ? ACCOUNT : OTHER, to: i % 2 ? OTHER : ACCOUNT,
    amountBaseUnits: "1234567890123456789",
  }, i)))]);
  return workspace([slot]);
}
function csvObjects(text) {
  const rows = text.replace(/^\ufeff/, "").trimEnd().split("\r\n").map(line => {
    const cells = []; let value = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (line[i] === "," && !quoted) { cells.push(value); value = ""; }
      else value += line[i];
    }
    cells.push(value); return cells;
  });
  const [header, ...values] = rows;
  return values.map(row => {
    assert.equal(row.length, header.length);
    return Object.fromEntries(header.map((key, i) => [key, row[i]]));
  });
}
for (const [name, make, encode, analyze, expected] of [
  ["reconciliation", reconciliationInput, reconciliationFilteredEventsCSV, reconcileWorkspace, 61],
  ["period report", manyEventsInput, periodReportEventsCSV, analyzePeriodReport, 57],
]) {
  test(name + " exports every match independently of page without changing evidence or conclusions", () => {
    const input = make(), before = JSON.stringify(input), result = analyze(input);
    const file = encode(input, query()), rows = csvObjects(file.text);
    assert.equal(file.matched, expected); assert.equal(rows.length, expected);
    assert.equal(new Set(rows.map(row => row.transaction_hash + ":" + row.log_index)).size, expected);
    assert.equal(file.text, encode(input, query({ page: 0 })).text);
    assert.equal(file.byteLength, new TextEncoder().encode(file.text).byteLength);
    assert.equal(file.scope, "all-matches"); assert.equal(file.restorable, false);
    assert.ok(rows.every(row => row.independently_verified === "false"));
    assert.equal(JSON.stringify(input), before); assert.deepEqual(analyze(input), result);
  });
  test(name + " filters direction and literal search across all pages", () => {
    const input = make();
    const incoming = encode(input, query({ direction: "incoming" }));
    assert.equal(incoming.matched, name === "reconciliation" ? 31 : 57);
    assert.ok(csvObjects(incoming.text).every(row => row.direction === "incoming"));
    const hash = csvObjects(incoming.text).at(-1).transaction_hash;
    const single = encode(input, query({ direction: "incoming", search: hash.toUpperCase() }));
    assert.equal(single.matched, 1); assert.equal(single.query.search, hash);
    assert.equal(csvObjects(single.text)[0].query_search, hash);
    assert.equal(single.total, expected);
  });
  test(name + " zero matches produce only a header and never invent a zero-valued event", () => {
    const file = encode(make(), query({ search: "no such transaction" }));
    assert.equal(file.matched, 0); assert.equal(file.total, expected);
    assert.deepEqual(csvObjects(file.text), []);
    assert.equal(file.text.trimEnd().split("\r\n").length, 1);
  });
  test(name + " rejects accessor and invalid queries without invoking getters", () => {
    let reads = 0; const options = query();
    Object.defineProperty(options, "search", { get() { reads++; return ""; } });
    assert.throws(() => encode(make(), options)); assert.equal(reads, 0);
    assert.throws(() => encode(make(), query({ direction: "unsupported" })));
  });
}
test("reconciliation CSV preserves large integer units and protects signed deltas", () => {
  const rows = csvObjects(reconciliationFilteredEventsCSV(reconciliationInput(), query()).text);
  assert.equal(rows[0].amount_base_units, "1234567890123456789");
  assert.equal(rows[1].delta_base_units, "'-1234567890123456789");
});
test("period CSV keeps source restrictions and quotes source labels as inert text", () => {
  const input = changedSlot(reportInput(), "DAT", entry => {
    entry.label = '=HYPERLINK("https://example.invalid","title")'; entry.requiresNewPlan = true;
  });
  const row = csvObjects(periodReportEventsCSV(input, query()).text)[0];
  assert.equal(row.source_status, "requires-new-plan"); assert.equal(row.report_status, "attention");
  assert.ok(row.source_label.startsWith("'=HYPERLINK"));
  assert.equal(row.live_chain_rechecked, "false");
});

async function ready(kind, onChange = () => {}) {
  if (kind === "reconciliation") {
    const controller = createReconciliationController({ initial: reconciliationInput(), onStateChange: onChange });
    controller.calculate();
    return { controller, exportFile: (query, deliver) => controller.exportFile("filtered-events", deliver, query) };
  }
  const controller = createPeriodReportController({ storage: memoryStorage(reportLibrary()).storage, onChange });
  controller.stageHistory(manyEventsInput()); await controller.applyReview();
  return { controller, exportFile: (query, deliver) => controller.exportFile("events", true, deliver, query) };
}
for (const kind of ["reconciliation", "period"]) {
  test(kind + " captures filters before observers and cancels before delivery when interrupted by an observer", async () => {
    let action = null;
    const f = await ready(kind, state => { if (state.busy) action?.(); });
    try {
      const options = query();
      action = () => { options.direction = "outgoing"; };
      const files = [];
      assert.equal(await f.exportFile(options, file => files.push(file)), true);
      assert.equal(files[0].query.direction, "all");
      action = () => f.controller.cancel();
      assert.equal(await f.exportFile(query(), file => files.push(file)), false);
      assert.equal(files.length, 1); assert.equal(f.controller.state.busy, false);
    } finally { f.controller.dispose(); }
  });
  test(kind + " export handles delivery refusal and preserves source while permitting retry", async () => {
    const f = await ready(kind), before = JSON.stringify(f.controller.state.workspace ?? f.controller.state.input);
    try {
      assert.equal(await f.exportFile(query(), () => false), false);
      assert.equal(f.controller.state.busy, false);
      const files = []; assert.equal(await f.exportFile(query(), file => files.push(file)), true);
      assert.equal(files.length, 1); assert.equal(files[0].scope, "all-matches");
      if (kind === "reconciliation") assert.equal(f.controller.state.exportedCurrent, false);
      assert.equal(JSON.stringify(f.controller.state.workspace ?? f.controller.state.input), before);
    } finally { f.controller.dispose(); }
  });
  test(kind + " query capture cannot revive an export cancelled during reflection", async () => {
    const f = await ready(kind); let deliveries = 0;
    try {
      let stopped = false;
      const options = new Proxy(query(), { getOwnPropertyDescriptor(target, key) {
        if (!stopped) { stopped = true; f.controller.cancel(); }
        return Object.getOwnPropertyDescriptor(target, key);
      } });
      assert.equal(await f.exportFile(options, () => { deliveries++; }), false);
      assert.equal(deliveries, 0); assert.equal(f.controller.state.busy, false);
    } finally { f.controller.dispose(); }
  });
}
