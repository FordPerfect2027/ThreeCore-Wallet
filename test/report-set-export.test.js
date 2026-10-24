import test from "node:test";
import assert from "node:assert/strict";
import { reportSetHTML, reportSetCSV } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { sequenceSet, sequenceHistory, demoSetHistory, clone } from "./helpers/report-set-fixtures.js";

// Small RFC4180 reader used to verify actual cell boundaries, not string fragments.
function csvRows(text) {
  const rows = [], row = [];
  let value = "", quoted = false;
  const source = text.replace(/^\ufeff/, "");
  for (let index = 0; index < source.length; index++) {
    const c = source[index];
    if (c === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if (c === "\r" && source[index + 1] === "\n" && !quoted) {
      row.push(value); rows.push([...row]); row.length = 0; value = ""; index++;
    } else value += c;
  }
  assert.equal(quoted, false);
  return rows;
}

test("CSV describes nine planned token segments without adding financial amounts", () => {
  const file = reportSetCSV(sequenceSet());
  const [header, ...rows] = csvRows(file.text);
  assert.equal(rows.length, 9);
  assert.ok(rows.every(row => row.length === header.length));
  assert.deepEqual([...new Set(rows.map(row => row[0]))], ["DAT", "EMA", "CAWELON"]);
  assert.ok(rows.every(row => row[header.indexOf("planned_blocks")] === "12"));
  assert.ok(rows.every(row => row[header.indexOf("historical_only")] === "true"));
  assert.ok(rows.every(row => row[header.indexOf("live_chain_rechecked")] === "false"));
  assert.ok(rows.every(row => row[header.indexOf("evidence_backup")] === "false"));
  assert.equal(header.includes("balance"), false);
  assert.equal(header.includes("profit"), false);
});

test("gap CSV rows contain no report identity and cannot claim arithmetic agreement", () => {
  const input = sequenceSet(sequenceHistory([0n, 24n]));
  const [header, ...rows] = csvRows(reportSetCSV(input).text);
  const gaps = rows.filter(row => row[header.indexOf("segment_kind")] === "gap");
  assert.equal(gaps.length, 3);
  for (const row of gaps) {
    assert.equal(row[header.indexOf("report_ids")], "");
    assert.equal(row[header.indexOf("all_arithmetic_agreement")], "false");
    assert.equal(row[header.indexOf("planned_blocks")], "12");
  }
});

test("repeated evidence retains all report identities but one interval block count", () => {
  const history = demoSetHistory();
  const input = sequenceSet(history, [history.entries[1].id, history.entries[4].id]);
  const [header, ...rows] = csvRows(reportSetCSV(input).text);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row[header.indexOf("segment_kind")] === "repeated"));
  assert.ok(rows.every(row => row[header.indexOf("report_ids")].split(" ").length === 2));
  assert.ok(rows.every(row => row[header.indexOf("planned_blocks")] === "12"));
});

for (const create of [reportSetHTML, reportSetCSV]) {
  test(create.name + " omits full addresses and notes by default", () => {
    const input = sequenceSet();
    const file = create(input);
    assert.equal(file.restorable, false);
    assert.equal(file.containsOriginalEvidence, false);
    assert.equal(file.encrypted, false);
    assert.equal(file.byteLength, Buffer.byteLength(file.text));
    for (const entry of input.entries) {
      assert.ok(!file.text.includes(entry.note));
      for (const slot of entry.report.slots) {
        assert.ok(!file.text.includes(slot.entry.draft.plan.context.account));
      }
    }
    assert.ok(file.text.includes("…"));
    assert.ok(!file.text.includes('"records":'));
    assert.ok(!file.text.includes('"balanceBaseUnits":'));
  });

  test(create.name + " includes notes and full addresses only when selected", () => {
    const input = sequenceSet();
    const file = create(input, { includeNotes: true, shortAddresses: false });
    assert.ok(file.text.includes(input.entries[0].note));
    assert.ok(file.text.includes(input.entries[0].report.slots[0].entry.draft.plan.context.account));
  });

  test(create.name + " is deterministic and leaves the frozen evidence unchanged", () => {
    const input = sequenceSet();
    const before = JSON.stringify(input);
    assert.equal(create(input).text, create(input).text);
    assert.equal(JSON.stringify(input), before);
    assert.ok(Object.isFrozen(input.entries[0].report.slots));
  });

  test(create.name + " rejects analysis injected into the input", () => {
    assert.throws(() => create({ ...sequenceSet(), allContinuous: true }));
  });
}

test("HTML escapes set titles, report labels and notes as text", () => {
  const input = clone(sequenceSet());
  input.title = "<script>alert(1)</script>";
  input.entries[0].label = '<img src=x onerror="alert(2)">';
  input.entries[0].note = "</td><script>evil()</script>&";
  const html = reportSetHTML(input, { includeNotes: true }).text;
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;/td&gt;&lt;script&gt;evil()&lt;/script&gt;&amp;"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!/<(?:iframe|link|form|object)\b/i.test(html));
});

for (const prefix of ["=", "+", "-", "@"]) {
  test("CSV neutralizes spreadsheet formula prefix " + JSON.stringify(prefix), () => {
    const input = clone(sequenceSet());
    // Stored notes are canonical; preserve formula text while neutralizing its prefix.
    input.entries[0].note = prefix + 'SUM(1,2)';
    const [header, ...rows] = csvRows(reportSetCSV(input, { includeNotes: true }).text);
    const cell = rows.find(row => row[header.indexOf("report_ids")] === input.entries[0].id)[header.indexOf("notes")];
    assert.equal(cell, "'" + input.entries[0].note);
  });
}

test("CSV preserves commas, quotes and newlines inside one note cell", () => {
  const input = clone(sequenceSet());
  input.entries[0].note = 'first, "quoted"\nsecond line';
  const [header, ...rows] = csvRows(reportSetCSV(input, { includeNotes: true }).text);
  assert.equal(rows.length, 9);
  assert.equal(rows[0][header.indexOf("notes")], input.entries[0].note);
  assert.ok(rows.every(row => row.length === header.length));
});

test("summary privacy options cannot strip evidence from backup JSON", async () => {
  const input = sequenceSet();
  const summary = reportSetHTML(input).text;
  const backup = (await prepareReportSetFile(input)).text;
  assert.ok(!summary.includes(input.entries[0].note));
  assert.ok(backup.includes(input.entries[0].note));
  assert.ok(backup.includes(input.entries[0].report.slots[0].entry.draft.plan.context.account));
});

test("HTML includes review limitations even when all arithmetic and boundaries agree", () => {
  const html = reportSetHTML(sequenceSet()).text;
  for (const phrase of ["現在のチェーン", "利益も計算しません", "取得完了の保証ではありません", "匿名化の保証ではありません"]) {
    assert.ok(html.includes(phrase), phrase);
  }
});

test("archived and incomplete reports remain visible in the summary", () => {
  const html = reportSetHTML(sequenceSet(demoSetHistory())).text;
  assert.ok(html.includes("CAWELON取得途中（非表示保管）"));
  assert.ok(html.includes("確認が必要な箇所"));
  assert.ok(html.includes("取得途中"));
  assert.ok(html.includes("同じ証拠を含む複数の報告"));
});
