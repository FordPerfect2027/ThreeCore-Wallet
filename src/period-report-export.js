import { analyzePeriodReport } from "./period-report-engine.js";
import { validatePeriodReportInput } from "./period-report-model.js";
import { reportStatusText, reportIssueText, reportSlotText, REPORT_LIMITATION } from "./period-report-view.js";

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
const csvLine = row => row.map(csvCell).join(",");
function file(text, extension, mime) {
  return Object.freeze({ text, filename: "ThreeCore-period-report." + extension,
    mimeType: mime + ";charset=utf-8", byteLength: new TextEncoder().encode(text).byteLength });
}

/** Exactly three rows, including missing tokens; numeric values are exact base-unit text. */
export function periodReportCSV(inputValue) {
  const report = analyzePeriodReport(inputValue);
  const columns = ["agent", "status", "source_id", "source_label", "archived", "requires_new_plan",
    "chain_id", "account", "earlier_block", "later_block", "steps_completed", "steps_total",
    "earlier_balance_base_units", "later_balance_base_units", "observed_delta_base_units",
    "net_transfer_base_units", "unexplained_base_units", "events", "arithmetic_status",
    "report_status", "created_at", "historical_only", "live_chain_rechecked", "independently_verified"];
  const rows = report.slots.map(slot => {
    const value = slot.arithmetic;
    return [slot.agent, slot.status, slot.entryId, slot.label, slot.archived, slot.requiresNewPlan,
      slot.plan?.context.chainId, slot.plan?.context.account, slot.plan?.earlierBlock, slot.plan?.laterBlock,
      slot.progress?.completed, slot.progress?.total, value.earlierBalanceBaseUnits, value.laterBalanceBaseUnits,
      value.totals?.observedDeltaBaseUnits, value.totals?.netTransferBaseUnits, value.totals?.residualBaseUnits,
      value.totals?.eventCount, value.status, report.status, report.createdAt, true, false, false];
  });
  return file("\ufeff" + [columns, ...rows].map(csvLine).join("\r\n") + "\r\n", "csv", "text/csv");
}

export function escapeReportHTML(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Standalone, scriptless printable summary. Raw JSON remains the restorable evidence. */
export function periodReportHTML(inputValue) {
  const input = validatePeriodReportInput(inputValue), report = analyzePeriodReport(input);
  const escape = escapeReportHTML;
  const issues = [...report.issues, ...report.warnings].map(code => "<li>" + escape(reportIssueText(code)) + "</li>").join("\n");
  const cards = report.slots.map(slot => "<section><h2>" + slot.agent + "</h2><pre>" + escape(reportSlotText(slot)) + "</pre></section>").join("\n");
  const conflicts = report.anchors.conflicts.map(block => "<tr><td>" + block.chainId + "</td><td>" + block.number +
    "</td><td>" + escape(block.observations.map(row => row.agent + ": " + row.hash).join("\n")) + "</td></tr>").join("\n");
  return file(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'">
<meta name="referrer" content="no-referrer">
<title>${escape(input.title)} — ThreeCore</title>
<style>
body{font:16px/1.6 system-ui,sans-serif;color:#132438;background:#f1f5f9;margin:0}
main{max-width:960px;margin:auto;padding:32px}section,header,aside{background:white;padding:24px;margin:16px 0;border:1px solid #ccd8e4;border-radius:12px}
h1{font-size:28px}h2{font-size:21px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccd8e4;padding:8px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}
small{color:#38506b}@media print{body{background:white}main{padding:0}section{break-inside:avoid}header,section,aside{border-radius:0}}
</style></head><body><main>
<header><p>THREECORE / HISTORICAL PERIOD REPORT</p><h1>${escape(input.title)}</h1>
<p>${escape(reportStatusText(report.status))}</p><p>作成日時: ${escape(input.createdAt)}</p>
<p>選択済み: ${report.selectedCount}/3トークン · 集計イベント: ${report.eventCount}（トークン別件数の合計）</p></header>
<aside><p>${escape(REPORT_LIMITATION)}</p><p>公開アドレス・残高を含みます。HTMLとCSVは要約です。復元には元の報告JSONを使用してください。</p><ul>${issues}</ul></aside>
${cards}
${conflicts ? '<section><h2>ブロックハッシュ不一致</h2><table><thead><tr><th>Chain</th><th>Block</th><th>各記録</th></tr></thead><tbody>' + conflicts + '</tbody></table></section>' : ''}
<footer><small>Read-only historical evidence. No wallet connection, transfer, current-chain verification or independent security audit. No combined token valuation.</small></footer>
</main></body></html>\n`, "html", "text/html");
}
