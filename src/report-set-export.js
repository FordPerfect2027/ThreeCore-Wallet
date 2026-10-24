import { validateReportSet, validateSetExportOptions } from "./report-set-model.js";
import { analyzeReportSet } from "./report-set-engine.js";
import { reportSetDiagnostics, diagnosticText } from "./report-set-diagnostics.js";
import { escapeReportHTML } from "./period-report-export.js";
import { reportStatusText } from "./period-report-view.js";
import { SET_LIMITATION, SET_SEGMENTS, setIssueText, setStatusText, shortSetAddress } from "./report-set-view.js";

function resultFile(text, extension, mimeType) {
  return Object.freeze({ text, filename: "ThreeCore-report-set." + extension,
    mimeType: mimeType + ";charset=utf-8", byteLength: new TextEncoder().encode(text).byteLength,
    restorable: false, containsOriginalEvidence: false, encrypted: false });
}
function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

/** One row per planned segment, not per event and never an account balance total. */
export function reportSetCSV(value, optionsValue = {}) {
  const input = validateReportSet(value), result = analyzeReportSet(input);
  const options = validateSetExportOptions(optionsValue);
  const byId = new Map(input.entries.map(entry => [entry.id, entry]));
  const columns = ["agent", "chain_id", "account", "start_exclusive", "end_inclusive", "planned_blocks",
    "segment_kind", "report_ids", "report_labels", "all_arithmetic_agreement", "notes",
    "historical_only", "live_chain_rechecked", "evidence_backup",
    "set_review_required", "token_continuous", "token_hash_conflicts"];
  const rows = [];
  for (const token of result.tokens) {
    for (const group of token.groups) {
      for (const segment of group.segments) {
        rows.push([token.agent, group.context.chainId, shortSetAddress(group.context.account, options.shortAddresses),
          segment.start, segment.end, segment.blocks, segment.kind, segment.reportIds.join(" "),
          segment.reportIds.map(id => byId.get(id).label).join(" | "), segment.allArithmeticAgreement,
          options.includeNotes ? segment.reportIds.map(id => byId.get(id).note).join(" | ") : "",
          true, false, false, !result.allContinuous, token.continuous, token.hashConflictCount]);
      }
    }
  }
  return resultFile("\ufeff" + [columns, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n", "csv", "text/csv");
}

/** Standalone summary deliberately contains no raw JSON, scripts or network resources. */
export function reportSetHTML(value, optionsValue = {}) {
  const input = validateReportSet(value), result = analyzeReportSet(input);
  const options = validateSetExportOptions(optionsValue), e = escapeReportHTML;
  const issueList = result.issues.map(code => "<li>" + e(setIssueText(code)) + "</li>").join("");
  const reportRows = input.entries.map(entry => {
    const analysis = result.reports.find(row => row.id === entry.id);
    return "<tr><td>" + e(entry.label) + (entry.archived ? "（非表示保管）" : "") + "</td><td>" +
      e(reportStatusText(analysis.status)) + "</td><td>" + e(entry.report.createdAt) + "</td>" +
      (options.includeNotes ? "<td>" + e(entry.note) + "</td>" : "") + "</tr>";
  }).join("\n");
  const tokens = result.tokens.map(token => {
    const groups = token.groups.map(group => {
      const rows = group.segments.map(segment => "<tr><td>" + e(segment.start) + " → " + e(segment.end) +
        "</td><td>" + e(segment.blocks) + "</td><td>" + e(SET_SEGMENTS[segment.kind]) + "</td><td>" +
        e(segment.reportIds.map(id => input.entries.find(entry => entry.id === id).label).join(" / ") || "—") + "</td></tr>").join("");
      return "<article><h3>Chain " + group.context.chainId + " / " + e(shortSetAddress(group.context.account, options.shortAddresses)) +
        "</h3><p>コントラクト: " + e(shortSetAddress(group.tokenAddress, options.shortAddresses)) + "</p>" +
        "<p>計画範囲 " + group.start + " → " + group.end + " / 抜け " + group.gapBlocks + " / 重複 " + group.overlapBlocks + " ブロック</p>" +
        "<p>計画に含まれるブロック数（重複分を除く）: " + group.plannedUniqueBlocks + "。取得完了の保証ではありません。</p>" +
        "<table><thead><tr><th>範囲 (開始, 終了]</th><th>ブロック数</th><th>状態</th><th>報告</th></tr></thead><tbody>" + rows + "</tbody></table>" +
        "<p>計算が一致していない報告: " + group.incompleteReports.length + "件 / 同一ブロックの残高不一致: " + group.balanceConflicts.length + "件</p></article>";
    }).join("\n");
    return "<section><h2>" + token.agent + "</h2><p>" + (token.continuous ? "選択した証拠の期間境界が一致" : "確認が必要な箇所あり") +
      " / このトークンを含まない報告 " + token.missingReportIds.length + "件</p>" + groups + "</section>";
  }).join("\n");
  const conflicts = result.anchors.conflicts.map(block => "<li>Chain " + block.chainId + " / Block " + e(block.block) +
    " / 食い違う記録 " + block.observations.length + "件</li>").join("");
  const checks = reportSetDiagnostics(input).items.map(item => "<article><h3>" + e(item.title) +
    "</h3><p>" + e(diagnosticText(item, { shortAddresses: options.shortAddresses })) + "</p></article>").join("");
  return resultFile(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'">
<meta name="referrer" content="no-referrer"><title>${e(input.title)} — ThreeCore</title>
<style>
body{margin:0;background:#eef3f7;color:#162b3b;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:24px}
header,section,aside{background:white;border:1px solid #becdda;border-radius:12px;padding:24px;margin:18px 0}article{margin:20px 0}
h1{font-size:28px}h2{font-size:23px}h3{font-size:18px}p,td,th{overflow-wrap:anywhere;white-space:pre-wrap}
table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #c4d0dc;padding:10px;vertical-align:top;text-align:left}
small{color:#395064}@media(max-width:600px){main{padding:10px}header,section,aside{padding:14px}td,th{font-size:12px;padding:5px}}
@media print{body{background:white}main{padding:0}header,section,aside{border-radius:0}h2,h3{break-after:avoid}tr{break-inside:avoid}}
</style></head><body><main>
<header><p>THREECORE / SAVED REPORT SET</p><h1>${e(input.title)}</h1><p>${e(setStatusText(result))}</p>
<p>作成日時: ${e(input.createdAt)} / ${result.reportCount}報告 / 非表示保管 ${result.archivedCount}件</p></header>
<aside><p>${e(SET_LIMITATION)}</p><ul>${issueList}</ul>
<p>説明用の要約です。再読込みには確認セットJSONを使ってください。${options.shortAddresses ? "アドレスは短縮表示です。匿名化の保証ではありません。" : "公開アドレスを含みます。"}</p>
<p>${options.includeNotes ? "保存したメモを含みます。" : "メモは出力していません。保存名と報告名は含みます。"}</p></aside>
<section><h2>選択した報告</h2><table><thead><tr><th>保存名</th><th>確認状態</th><th>報告作成日時</th>${options.includeNotes ? "<th>メモ</th>" : ""}</tr></thead><tbody>${reportRows}</tbody></table></section>
${tokens}
<section><h2>次に確認する箇所</h2>${checks || "<p>この選択内では追加確認箇所は見つかりませんでした。</p>"}</section>
<section><h2>ブロックハッシュの照合</h2><p>不一致 ${result.anchors.conflicts.length}件 / 個別記録内の矛盾 ${result.anchors.invalid.length}件</p><ul>${conflicts}</ul></section>
<footer><small>Historical evidence only. No independent audit, live-chain verification, combined token valuation or profit calculation.</small></footer>
</main></body></html>\n`, "html", "text/html");
}
