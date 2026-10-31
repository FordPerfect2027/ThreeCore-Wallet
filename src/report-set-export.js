import { parseSecurityJson } from "./security-json.js";
import { sha256Hex, captureOptionalDataFields } from "./security-data.js";
import { readFormatFileText, readFormatFileName } from "./security-file.js";
import { validateReportSet, validateSetExportOptions, validateSetSelection, freezeSet } from "./report-set-model.js";
import { periodFail, createPeriodPlan } from "./period-plan.js";
import { prepareReportSetFile } from "./report-set-file.js";
import { preparePeriodReportFile } from "./period-report-file.js";
import { preparePeriodFile } from "./period-file.js";
import { emptyPeriodDraft } from "./period-draft.js";
import { reportSetMissingHistoryQueue, missingHistoryPageRange } from "./report-set-timeline.js";
import { analyzeReportSet } from "./report-set-engine.js";
import { reportSetDiagnostics, querySetDiagnostics, diagnosticQuery, diagnosticText } from "./report-set-diagnostics.js";
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

/** A summary row retains source-wide findings even when no checks match. */
export function reportSetDiagnosticsCSV(value, queryValue = {}, optionsValue = {}) {
  const input = validateReportSet(value), options = validateSetExportOptions(optionsValue);
  const found = querySetDiagnostics(input, queryValue), result = analyzeReportSet(input);
  const byId = new Map(input.entries.map(entry => [entry.id, entry]));
  const columns = ["row_type", "query_agent", "query_severity", "query_search", "total_checks", "matched_checks",
    "source_conflicts", "source_missing", "source_review", "source_information", "all_continuous",
    "historical_only", "live_chain_rechecked", "automatic_repairs", "structured_addresses_shortened", "notes_included",
    "check_id", "kind", "severity", "title", "action", "agents", "chain_id", "account",
    "from_block", "to_block", "blocks", "range_notation", "report_ids", "report_labels", "notes"];
  const prefix = type => [type, found.query.agent, found.query.severity, found.query.search, found.count, found.matched,
    found.counts.conflict, found.counts.missing, found.counts.review, found.counts.information, result.allContinuous,
    true, false, false, options.shortAddresses, options.includeNotes];
  const rows = [[...prefix("summary"), ...Array(15).fill("")]];
  for (const item of found.items) rows.push([...prefix("check"), item.id, item.kind, item.severity, item.title, item.action,
    item.agents.join(" "), item.chainId, shortSetAddress(item.account, options.shortAddresses),
    item.fromBlock, item.toBlock, item.blocks, item.fromBlock === null ? "" : item.fromBlock === item.toBlock ? "single-block" : "(start,end]",
    JSON.stringify(item.reportIds), JSON.stringify(item.reportLabels),
    options.includeNotes ? JSON.stringify(item.reportIds.map(id => byId.get(id).note)) : ""]);
  const text = "\ufeff" + [columns, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return Object.freeze({ ...resultFile(text, "csv", "text/csv"), filename: "ThreeCore-report-set-checks.csv",
    query: found.query, options, total: found.count, matched: found.matched, summaryRow: true, scope: "all-matches" });
}

export const REPORT_SET_CHECKS_SCHEMA = "threecore.report-set-check-details.v1";
export const REPORT_SET_CHECKS_LIMIT = 4 * 1024 * 1024;

/** A bounded, source-linked viewing artifact. Original evidence is kept separately. */
export async function prepareReportSetChecksFile(value, queryValue = {}, optionsValue = {}, fileOptions = {}) {
  const input = validateReportSet(value), query = diagnosticQuery(queryValue), options = validateSetExportOptions(optionsValue);
  const source = await prepareReportSetFile(input, fileOptions);
  const found = querySetDiagnostics(input, query), report = analyzeReportSet(input);
  const byId = new Map(input.entries.map(entry => [entry.id, entry]));
  const items = found.items.map(item => ({ ...item,
    account: item.account === null ? null : shortSetAddress(item.account, options.shortAddresses),
    rangeNotation: item.fromBlock === null ? null : item.fromBlock === item.toBlock ? "single-block" : "(start,end]",
    notes: options.includeNotes ? item.reportIds.map(id => ({ reportId: id, text: byId.get(id).note })) : [],
  }));
  const payload = freezeSet({ schema: REPORT_SET_CHECKS_SCHEMA, sourcePayloadDigest: source.digest, digestAlgorithm: "SHA-256",
    query, options, total: found.count, matched: found.matched, scope: "all-matches",
    summary: { counts: found.counts, allContinuous: report.allContinuous, conclusionsUseAllSourceEvidence: true },
    items, historicalOnly: true, liveChainRechecked: false, automaticRepairs: false,
    authenticated: false, encrypted: false, restorable: false, containsOriginalEvidence: false });
  const text = JSON.stringify(payload, null, 2) + "\n";
  if (new TextEncoder().encode(text).byteLength > REPORT_SET_CHECKS_LIMIT) periodFail("PERIOD_SET_CHECKS_SIZE");
  return Object.freeze({ ...resultFile(text, "json", "application/json"), filename: "ThreeCore-report-set-checks.json",
    sourcePayloadDigest: source.digest, query, options, total: found.count, matched: found.matched, scope: "all-matches" });
}

function sameCheckJSON(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameCheckJSON(left[key], right[key]));
}

/** Recompute from the original source; saved checklist conclusions are never trusted. */
export async function reviewReportSetChecksFile(value, text, fileOptions = {}) {
  const input = validateReportSet(value);
  let cryptoOptions;
  try { cryptoOptions = captureOptionalDataFields(fileOptions, ["subtle", "signal", "timeoutMs"]); }
  catch { periodFail("PERIOD_CRYPTO"); }
  let supplied;
  try { supplied = parseSecurityJson(text, { bytes: REPORT_SET_CHECKS_LIMIT }); }
  catch { periodFail("PERIOD_SET_CHECKS_JSON"); }
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied) || supplied.schema !== REPORT_SET_CHECKS_SCHEMA) periodFail("PERIOD_SET_CHECKS_SCHEMA");
  const query = diagnosticQuery(supplied.query), options = validateSetExportOptions(supplied.options);
  const expected = JSON.parse((await prepareReportSetChecksFile(input, query, options, cryptoOptions)).text);
  let detailsTextSha256;
  try { detailsTextSha256 = await sha256Hex(new TextEncoder().encode(text), cryptoOptions.subtle, { signal: cryptoOptions.signal, timeoutMs: cryptoOptions.timeoutMs }); }
  catch { periodFail("PERIOD_CRYPTO"); }
  const known = Object.keys(expected), differences = known.filter(key => !Object.hasOwn(supplied, key) || !sameCheckJSON(supplied[key], expected[key]));
  const unexpectedFields = Object.keys(supplied).filter(key => !Object.hasOwn(expected, key)).length;
  return freezeSet({ schema: "threecore.report-set-check-review.v1", matchesRecomputation: differences.length === 0 && unexpectedFields === 0,
    sourcePayloadDigest: expected.sourcePayloadDigest, sourceDigestMatches: supplied.sourcePayloadDigest === expected.sourcePayloadDigest, detailsTextSha256,
    query, options, total: expected.total, matched: expected.matched,
    summary: expected.summary, differences, unexpectedFields,
    historicalOnly: true, readOnly: true, liveChainRechecked: false, authenticated: false, restorable: false });
}

/** Uses the same page-wide file budget and cancellation as other saved formats. */
export async function readReportSetChecksText(file, { signal, timeoutMs } = {}) {
  readFormatFileName(file, { maxLength: 180, fail: periodFail, code: "PERIOD_FILENAME" });
  return readFormatFileText(file, { maxBytes: REPORT_SET_CHECKS_LIMIT, fail: periodFail,
    sizeCode: "PERIOD_SET_CHECKS_SIZE", readCode: "PERIOD_SET_CHECKS_READ", encodingCode: "PERIOD_SET_CHECKS_ENCODING",
    signal, timeoutMs });
}

/** Extract one unchanged source report in its established, checksummed format. */
export async function prepareReportSetSourceFile(value, idValue, fileOptions = {}) {
  const input = validateReportSet(value), id = validateSetSelection([idValue], { allowEmpty: false })[0];
  const entry = input.entries.find(row => row.id === id);
  if (!entry) periodFail("PERIOD_SET_REPORT_MISSING");
  const file = await preparePeriodReportFile(entry.report, fileOptions);
  return Object.freeze({ ...file, filename: "ThreeCore-period-report-" + id + ".json",
    sourceReportId: id, sourceReportLabel: entry.label, containsOriginalEvidence: true });
}

/** A new empty draft for a proposed window or contiguous page. No original evidence is copied. */
export async function prepareMissingHistoryDraftFile(value, query, number, fileOptions = {}) {
  const queue = reportSetMissingHistoryQueue(value, query);
  if (typeof number !== "string") periodFail("PERIOD_SET_QUEUE_WINDOW");
  const window = number === "page" ? missingHistoryPageRange(queue) : queue.items.find(row => row.number === number);
  if (number === "page" && queue.items.length && !window) periodFail("PERIOD_SET_QUEUE_DISJOINT");
  if (!window) periodFail("PERIOD_SET_QUEUE_WINDOW");
  let options;
  try { options = captureOptionalDataFields(fileOptions, ["subtle", "signal", "timeoutMs"]); }
  catch { periodFail("PERIOD_SET_OPTIONS"); }
  const draft = emptyPeriodDraft(createPeriodPlan({ context: queue.context,
    earlierBlock: (BigInt(window.fromBlock) - 1n).toString(), laterBlock: window.toBlock,
    windowSize: number === "page" ? queue.query.windowSize : Number(window.blocks) }));
  const file = await preparePeriodFile(draft, options);
  return Object.freeze({ ...file, filename: "ThreeCore-unread-period-" + queue.context.agent + ".json",
    encrypted: false, containsOriginalEvidence: false, newEmptyDraft: true, selectedRange: window });
}
