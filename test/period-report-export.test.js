import test from "node:test";
import assert from "node:assert/strict";
import { periodReportCSV, periodReportHTML, escapeReportHTML } from "../src/period-report-export.js";
import { reportStatusText, reportIssueText, reportSlotText, reportErrorCode,
  reportErrorText, reportAmount, REPORT_LIMITATION } from "../src/period-report-view.js";
import { analyzePeriodReport } from "../src/period-report-engine.js";
import { reportInput, changedSlot, forkedInput, ACCOUNT, UNIT } from "./helpers/period-report-fixtures.js";

function csvRows(text) {
  return text.replace(/^\ufeff/, "").trimEnd().split("\r\n").map(line => {
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
}

test("CSV contains exactly one explicit row for each token", () => {
  const file = periodReportCSV(reportInput()), [headers, ...rows] = csvRows(file.text);
  assert.equal(file.filename, "ThreeCore-period-report.csv");
  assert.match(file.mimeType, /^text\/csv/);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row[0]), ["DAT", "EMA", "CAWELON"]);
  assert.ok(rows.every(row => row.length === headers.length));
  const values = Object.fromEntries(headers.map((header, index) => [header, rows[0][index]]));
  assert.equal(values.account, ACCOUNT);
  assert.equal(values.earlier_balance_base_units, (100n * UNIT).toString());
  assert.equal(values.later_balance_base_units, (107n * UNIT).toString());
  assert.equal(values.unexplained_base_units, "0");
  assert.equal(values.live_chain_rechecked, "false");
  assert.equal(values.independently_verified, "false");
  assert.equal(values.historical_only, "true");
});

test("missing CSV row uses empty amounts and explicit missing status", () => {
  const input = changedSlot(reportInput(), "EMA", (_, slot) => { slot.entry = null; });
  const [headers, ...rows] = csvRows(periodReportCSV(input).text);
  const row = Object.fromEntries(headers.map((header, index) => [header, rows[1][index]]));
  assert.equal(row.status, "missing");
  assert.equal(row.account, "");
  assert.equal(row.later_balance_base_units, "");
  assert.equal(row.unexplained_base_units, "");
  assert.equal(row.events, "");
});

for (const label of ['=HYPERLINK("https://example.invalid")', "+SUM(1,2)", "-12", "@function()"] ) {
  test("CSV escapes formula-leading source label " + label, () => {
    const input = changedSlot(reportInput(), "DAT", entry => { entry.label = label; });
    const [headers, row] = csvRows(periodReportCSV(input).text);
    assert.equal(row[headers.indexOf("source_label")], "'" + label);
  });
}

test("CSV quotes commas and double quotes without extra columns", () => {
  const input = changedSlot(reportInput(), "DAT", entry => { entry.label = 'A, "quoted" title'; });
  const [headers, row] = csvRows(periodReportCSV(input).text);
  assert.equal(row[headers.indexOf("source_label")], 'A, "quoted" title');
  assert.equal(row.length, headers.length);
});

test("negative amounts are protected as spreadsheet text and retain the sign", () => {
  const input = changedSlot(reportInput(), "DAT", entry => { entry.draft.later.balanceBaseUnits = (107n * UNIT - 1n).toString(); });
  const [headers, row] = csvRows(periodReportCSV(input).text);
  assert.equal(row[headers.indexOf("unexplained_base_units")], "'-1");
});

test("CSV retains raw precision and archived restrictions", () => {
  const input = changedSlot(reportInput({ changes: { DAT: { requiresNewPlan: true, archived: true } } }), "DAT", entry => {
    entry.draft.later.balanceBaseUnits = "90071992547409931234567890";
  });
  const [headers, row] = csvRows(periodReportCSV(input).text);
  assert.equal(row[headers.indexOf("later_balance_base_units")], "90071992547409931234567890");
  assert.equal(row[headers.indexOf("archived")], "true");
  assert.equal(row[headers.indexOf("requires_new_plan")], "true");
  assert.equal(row[headers.indexOf("status")], "requires-new-plan");
});

test("HTML is a standalone printable scriptless report", () => {
  const file = periodReportHTML(reportInput());
  assert.equal(file.filename, "ThreeCore-period-report.html");
  assert.match(file.mimeType, /^text\/html/);
  assert.match(file.text, /^<!doctype html>/);
  assert.match(file.text, /Content-Security-Policy/);
  assert.match(file.text, /default-src 'none'/);
  assert.match(file.text, /connect-src 'none'/);
  assert.match(file.text, /form-action 'none'/);
  assert.match(file.text, /@media print/);
  assert.doesNotMatch(file.text, /<script|<iframe|<img|<link|<form|onclick=/i);
  assert.match(file.text, /107/);
  assert.match(file.text, /DAT/);
  assert.match(file.text, /EMA/);
  assert.match(file.text, /CAWELON/);
  assert.ok(file.text.includes(REPORT_LIMITATION));
});

test("HTML escapes titles and saved labels as text in every location", () => {
  const input = changedSlot(reportInput({ title: '<img src=x onerror="oops">' }), "DAT", entry => {
    entry.label = '<script>alert("x")</script>';
  });
  const html = periodReportHTML(input).text;
  assert.doesNotMatch(html, /<img|<script/i);
  assert.match(html, /&lt;img src=x onerror=&quot;oops&quot;&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});

test("HTML preserves cross-chain conflicts and partial records as visible explanations", () => {
  const html = periodReportHTML(forkedInput()).text;
  assert.match(html, /ブロックハッシュ不一致/);
  assert.match(html, /同じチェーン・同じブロック/);
  assert.match(html, /<table>/);
  const partial = periodReportHTML(reportInput({ counts: [0, 3, 5] })).text;
  assert.match(partial, /取得途中/);
  assert.match(partial, /未取得/);
});

test("all export sizes are measured in UTF-8 bytes", () => {
  for (const create of [periodReportCSV, periodReportHTML]) {
    const file = create(reportInput({ title: "日本語の報告" }));
    assert.equal(file.byteLength, new TextEncoder().encode(file.text).byteLength);
    assert.ok(file.byteLength > file.text.length);
  }
});

test("escaping covers both quote types and ampersands", () => {
  assert.equal(escapeReportHTML('<&>"\''), "&lt;&amp;&gt;&quot;&#39;");
});

test("human amount formatting keeps exact smallest units and unknown values", () => {
  assert.equal(reportAmount("1"), "0.000000000000000001");
  assert.equal(reportAmount("-1"), "-0.000000000000000001");
  assert.equal(reportAmount("0"), "0");
  assert.equal(reportAmount(null), "未取得");
  assert.equal(reportAmount(undefined), "未取得");
  assert.equal(reportAmount("12345", 2), "123.45");
});

test("slot text includes provenance and never silently displays missing evidence as zero", () => {
  const report = analyzePeriodReport(reportInput({ counts: [0, 5, 5] }));
  const text = reportSlotText(report.slots[0]);
  assert.match(text, /開始残高: 未取得/);
  assert.match(text, /終了残高: 未取得/);
  assert.match(text, /取得: 0\/5工程/);
  assert.match(text, /chain 84532/);
  assert.ok(text.includes(ACCOUNT));
});

test("missing slot is concise and safe", () => {
  const source = changedSlot(reportInput(), "EMA", (_, slot) => { slot.entry = null; });
  assert.equal(reportSlotText(analyzePeriodReport(source).slots[1]), "EMA: 記録が選ばれていません。");
});

test("prototype names never resolve to inherited status/error messages", () => {
  for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    assert.equal(reportStatusText(key), "未確認");
    assert.equal(reportIssueText(key), "記録の追加確認が必要です。");
    assert.match(reportErrorText(key), /処理を完了できません/);
  }
});

test("unsafe low-level error text is not exposed", () => {
  assert.equal(reportErrorCode(Error("C:/private/secret.txt")), "PERIOD_REPORT_FAILED");
  assert.equal(reportErrorCode({ code: "Error: password" }), "PERIOD_REPORT_FAILED");
  assert.equal(reportErrorCode({ code: "PERIOD_CHECKSUM" }), "PERIOD_CHECKSUM");
  assert.match(reportErrorText("PERIOD_CHECKSUM"), /チェックサム/);
  assert.match(reportErrorText("PERIOD_REPORT_SOURCE_CHANGED"), /変更/);
});
