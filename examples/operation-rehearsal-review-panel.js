import { createRehearsalFieldFeedback } from "./operation-rehearsal-scenario-panel.js";
import { createFileSelectionNotice, mountBatchSourceExportPanel, mountSavedBundleReceiptCheckPanel, batchEvidenceReceiptCheckText, batchSelectionReviewText, mountReviewedBatchComparisonPanel, comparisonEvidenceProgressText } from "./file-read-panel.js";
import { reviewRehearsalBatchEvidenceReceipt, encodeRehearsalBatchEvidenceReceiptCheck } from "../src/operation-rehearsal-report-review.js";
import { queryRehearsalBatchFiles, encodeRehearsalBatchSelection } from "../src/operation-rehearsal-report-review.js";
import { reviewRehearsalBatchSelection, encodeRehearsalBatchSelectionReview, extractRehearsalBatchSelectionQuery } from "../src/operation-rehearsal-report-review.js";
import { compareRehearsalBatches, encodeRehearsalBatchComparison } from "../src/operation-rehearsal-report-review.js";
import { prepareRehearsalBatchComparisonEvidence, reviewRehearsalBatchComparisonEvidence, encodeRehearsalBatchComparisonEvidenceReview, REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT } from "../src/operation-rehearsal-report-review.js";
import { openReviewedRehearsalBatchComparisonEvidence, extractRehearsalBatchComparisonEvidenceSource } from "../src/operation-rehearsal-report-review.js";
import { queryRehearsalBatchComparisonDifferences, encodeRehearsalBatchComparisonDifferences } from "../src/operation-rehearsal-report-review.js";
import { createFileReadScope, readFormatFileName, readSecurityFileText } from "../src/security-file.js";
import { observeCallbackResult } from "../src/security-callback.js";
import { boundedUtf8Length } from "../src/security-json.js";
import { captureDataRecord } from "../src/security-data.js";
import { validateRehearsalReportBatchSelection, reviewRehearsalReportFileBatch,
  canPrepareRehearsalBatchEvidence, prepareRehearsalBatchEvidence, reviewRehearsalBatchEvidence,
  openReviewedRehearsalBatchEvidence, extractRehearsalBatchEvidenceSource, encodeRehearsalBatchEvidenceReview, REHEARSAL_BATCH_EVIDENCE_LIMIT,
  resumeRehearsalReportFileBatch, canResumeRehearsalReportFileBatch, retryRehearsalReportFileBatch, canRetryRehearsalReportFileBatch,
  encodeRehearsalBatchReview, encodeRehearsalBatchManifest,
  REHEARSAL_BATCH_REVIEW_FILES, decodeRehearsalBatchManifest, matchRehearsalBatchManifest,
  REHEARSAL_BATCH_MANIFEST_LIMIT, encodeRehearsalBatchCsv } from "../src/operation-rehearsal-report-review.js";
import { describeFileReadError, displayFileName, describeRehearsalFileTarget } from "../src/file-read-status.js";
import { requireSyncExport } from "../src/export-policy.js";
import { reviewedRehearsalInputChoices, exportReviewedRehearsalPart } from "../src/operation-rehearsal-report-review.js";
import { canReuseReviewedRehearsalQuery,extractReviewedRehearsalQuery } from "../src/operation-rehearsal-report-review.js";
import {canExportReviewedRehearsalWorkspace,exportReviewedRehearsalWorkspace,exportReviewedRehearsalAgent,compareReviewedRehearsalWorkspace, encodeRehearsalDifferenceQuery, encodeRehearsalDifferenceValues, inspectReviewedRehearsalDifference, inspectRehearsalEvidenceReceiptDifference, reviewRehearsalReport, encodeRehearsalReviewReceipt, encodeRehearsalReviewEvidence, queryReviewedRehearsalDifferences, queryRehearsalEvidenceReceiptDifferences, reviewRehearsalEvidence, decodeRehearsalReviewEvidence, REHEARSAL_REVIEW_EVIDENCE_LIMIT, decodeRehearsalChecksumText, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
import { encodeRehearsalWorkspace } from "../src/operation-rehearsal-workspace.js";
import { encodeRehearsalComparison } from "../src/operation-rehearsal-comparison.js";
import { REHEARSAL_OVERVIEW_SCHEMA } from "../src/operation-rehearsal-overview.js";
import { REHEARSAL_RECORD_SUMMARY_SCHEMA,REHEARSAL_PREFIX_REPORT_SCHEMA } from "../src/operation-rehearsal-records.js";
import { REHEARSAL_REASON_RECORD_REPORT_SCHEMA,REHEARSAL_RECORD_REASON_LABELS, REHEARSAL_REFERENCE_REPORT_SCHEMA, REHEARSAL_RECORD_REPORT_SCHEMA, REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA } from "../src/operation-rehearsal-records.js";

const reportNames = {
  "threecore.operation-rehearsal-record-summary.v1": "検索記録のトークン別集計",
  "threecore.operation-rehearsal-record-prefix.v1": "選んだ記録までの再現資料",
  "threecore.operation-rehearsal-overview.v1": "確認一覧",
  "threecore.operation-rehearsal-comparison.v1": "復旧比較",
  "threecore.operation-rehearsal-scenario.v1": "条件比較",
  "threecore.operation-rehearsal-scenario-set-report.v1": "ケース集の集計",
  "threecore.operation-rehearsal-check-report.v1": "期待結果の確認資料",
  "threecore.operation-rehearsal-record-query.v1": "記録の検索資料",
  "threecore.operation-rehearsal-record-query.v2": "検索する情報を指定した記録資料",
  "threecore.operation-rehearsal-reference.v1": "操作・予約の関連記録資料",
  "threecore.operation-rehearsal-record-query.v3": "見送りの理由を指定した記録資料"
};
function addDifferenceDetailButton(document, row, index, inspect, current, output, actualLabel, select) {
  const cell=document.createElement("td"),button=document.createElement("button");button.type="button";
  button.textContent="値を比べる";button.setAttribute("aria-label","相違 "+(index+1)+" の再計算値と保存値を比べる");
  button.addEventListener("click",()=>{
    if(!current())return;const detail=inspect();if(!current())return;
    const value=(label,item)=>label+": "+(!item.present?"項目なし":item.json)+
      (item.arrayLength===null?"":"\n配列の件数: "+item.arrayLength)+
      (item.truncated?"\n表示を省略しています（全"+item.characters+"文字）。元資料も確認してください。":"");
    output.textContent="相違 "+detail.number+" / "+detail.totalDifferences+"\n場所: "+detail.path+"\n\n"+
      value("再計算で得た値",detail.expected)+"\n\n"+value(actualLabel+"にある値",detail.actual)+
      "\n\n表示は確認用です。元資料や現在の履歴は変更しません。";
    select();if(!current())return;output.hidden=false;output.focus?.();
  });
  cell.append(button);row.append(cell);
}

function mountDifferenceQuerySave(document,get,listen,context,download) {
  listen("difference-query-save","click",()=>{
    const own=context();if(own.disposed||!own.review||get("difference-query-save").disabled)return;
    const current=()=>{const now=context();return !now.disposed&&now.review===own.review&&now.revision===own.revision&&now.view===own.view&&now.target===own.target;};
    try{
      const text=encodeRehearsalDifferenceQuery(own.review,{path:get("difference-search").value,kind:get("difference-type").value},own.target);
      requireSyncExport(download({document,prepared:{text,filename:"ThreeCore-"+own.target+"-matching-differences.json",mimeType:"application/json"}}));
      if(current())get("export-status").textContent="絞り込みに一致したすべての相違と、資料全体の確認結果を保存し始めました。元資料も一緒に保管してください。";
    }catch{if(current())get("export-status").textContent="相違一覧を保存できませんでした。表示と元資料は保持しています。一覧が大きい場合は絞り込み条件を狭めてください。";}
  });
}
function setDifferenceFilters(get, enabled, reset = false) {
  if(!enabled)get("difference-query-save").disabled=true;
  for(const name of ["difference-search","difference-type","difference-filter-clear"])get(name).disabled=!enabled;
  if(reset){get("difference-search").value="";get("difference-type").value="all";}
  get("difference-search").removeAttribute("aria-invalid");get("difference-type").removeAttribute("aria-invalid");
}
function readDifferenceFilterPage(get, query) {
  try{
    const page=query({path:get("difference-search").value,kind:get("difference-type").value});
    get("difference-search").removeAttribute("aria-invalid");get("difference-type").removeAttribute("aria-invalid");return page;
  }catch{
    get("difference-status").textContent="絞り込み条件を確認してください。場所は128文字以内、種類は一覧から選んでください。資料全体の確認結果は保持しています。";
    get("previous").disabled=true;get("next").disabled=true;
    get("difference-search").setAttribute("aria-invalid","true");get("difference-type").setAttribute("aria-invalid","true");return null;
  }
}
function differencePageText(page,label="") {
  const prefix=label?label+": ":"";
  if(!page.totalDifferences)return label?label+"との相違はありません。":"再計算との相違はありません。";
  if(!page.matchedDifferences)return prefix+"絞り込み条件に一致する相違はありません。資料全体の相違は"+page.totalDifferences+"箇所です。";
  const filtered=page.query.path||page.query.kind!=="all";
  return prefix+"全"+page.totalDifferences+"箇所の相違"+(filtered?"から絞り込みに一致 "+page.matchedDifferences+"箇所。そのうち ":"のうち ")+
    (page.offset+1)+"〜"+(page.offset+page.differences.length)+"箇所を表示（"+page.page+" / "+page.totalPages+"ページ）。";
}
function outcomeText(outcome) {
  if (!outcome) return "";
  if(outcome.kind==="record-summary")return "全"+outcome.totalRecords+"件のうち検索に一致した"+outcome.matchedRecords+"件を、保存元ごとに集計しました。金額は一致記録による増減で、最終残高や期間全体の損益ではありません。";
  if(outcome.kind==="record-prefix")return outcome.agent+" の先頭から"+outcome.includedRecords+"件を含み、後続の"+outcome.omittedLaterRecords+"件を除いた再現入力です。他のトークンは再現入力に含みません。資料には確認用の元履歴も保持しています。";
  if(outcome.kind==="record-reference")return outcome.agent+" の "+(outcome.reference.kind==="operation"?"操作":"予約")+"ID「"+outcome.reference.id+"」の関連記録 "+outcome.recordCount+"件。条件内 "+outcome.summary.acceptedRecords+"件、見送り "+outcome.summary.rejectedRecords+"件。元入力から再計算した試算の結果です。";
  if (outcome.kind === "expected-outcomes") return "含まれる期待結果: " + outcome.cases + "ケース中、一致 " +
    outcome.matched + "件、差あり " + outcome.differing + "件。期待値の作成方法: " +
    (outcome.expectationOrigin === "recorded-calculation" ? "計算結果から記録した基準" : "手動で指定した期待値") +
    "。資料の再計算の一致と、期待値への一致は別に確認してください。";
  const kinds = { all: "すべて", open: "運用開始", settle: "決済", deposit: "入金", withdraw: "出金", reserve: "還元予約", release: "予約解除" };
  const decisions = { all: "すべて", accepted: "条件内", rejected: "条件外" };
  return (outcome.query.reason?"見送りの理由: "+(outcome.query.reason==="all"?"すべて":REHEARSAL_RECORD_REASON_LABELS[outcome.query.reason])+"。":"")+"検索対象の全記録 " + outcome.totalRecords + "件 / 条件に一致 " + outcome.matchedRecords +
    "件。対象: " + (outcome.query.agent === "all" ? "すべて" : outcome.query.agent) + " / 種類: " +
    kinds[outcome.query.kind] + " / 判定: " + decisions[outcome.query.decision] + " / 検索語: " +
    (outcome.query.search || "指定なし") + "。"+(outcome.query.searchScope?"検索場所: "+(outcome.query.searchScope==="stored"?"保存元の情報":outcome.query.searchScope==="recorded"?"記録に書かれた情報":"保存元と記録の両方")+"。":"")+"件数は資料に含まれる試算記録の範囲です。";
}

/** Retain a read-only comparison baseline across subsequent source selections. */
export function mountRehearsalBatchComparisonPanel(document, { parent, download }) {
  const host = document.createElement("details"); host.className = "rehearsal-batch-comparison"; parent.append(host);
  let disposed = false, current = null, baseline = null, comparison = null, revision = 0, active = null, evidenceReview = null; const listeners = [];
  function node(tag, name, text, target = host) { const value = document.createElement(tag); value.className = "rehearsal-batch-comparison-" + name; if (text !== undefined) value.textContent = text; target.append(value); return value; }
  function button(name, text) { const value = node("button", name, text); value.type = "button"; return value; }
  function listen(element, type, fn) { element.addEventListener(type, fn); listeners.push(() => element.removeEventListener(type, fn)); }
  node("summary", "heading", "前回と今回の資料確認を比較する");
  node("p", "intro", "現在の一覧を比較元として保持し、次の組の資料を上で確認すると比較できます。名前が同じ行を対応付けます。比較元は『比較元を解除』までこの画面内に保持し、元資料や履歴を変更しません。");
  const hold = button("hold", "現在の確認結果を比較元として保持"), clear = button("clear", "比較元を解除"), baselineText = node("p", "baseline"), summary = node("p", "summary"); summary.setAttribute("role", "status");
  const label = node("label", "changed-label", "変化・選択差・比較できない行だけ表示"), changed = node("input", "changed", undefined, label); changed.type = "checkbox";
  const tableWrap = node("div", "table-wrap"); tableWrap.className += " table-wrap file-review-table-wrap"; tableWrap.setAttribute("tabindex", "0"); tableWrap.setAttribute("role", "region"); tableWrap.setAttribute("aria-label", "前回と今回の資料確認の比較。横方向にスクロールできます");
  const table = node("table", "table", undefined, tableWrap); node("caption", "caption", "同じファイル名ごとの前回と今回の比較", table); const head = node("thead", "head", undefined, table), tr = document.createElement("tr"); head.append(tr);
  for (const text of ["名前", "比較", "前回の判定", "今回の判定", "前回のSHA-256", "今回のSHA-256", "期待結果との差（前回→今回）"]) { const th = document.createElement("th"); th.textContent = text; th.setAttribute("scope", "col"); tr.append(th); }
  const rows = node("tbody", "rows", undefined, table), json = button("json", "全行の比較をJSON保存"), csv = button("csv", "全行の比較をCSV保存"), status = node("p", "status"); status.setAttribute("role", "status");
  node("p", "limits", "同じ照合値でも元資料の妥当性や出所は別です。未確認・照合値を計算できない行は一致と扱いません。一方に選択されていないことはファイルの削除を意味しません。JSON・CSVは表示の絞り込みに関係なく全行です。元の二組の資料も保管してください。");
  const evidence = node("details", "evidence"); node("summary", "evidence-heading", "二組の元資料と比較をまとめて保存・再確認", evidence);
  node("p", "evidence-intro", "二組の全ファイルの元の内容を含むため、公開アドレス・記録・注記も暗号化せず保存します。32 MiBまでです。元資料から新しく確認結果を計算し、中断・再試行の経過は含めません。経過の控えは別に保管してください。", evidence);
  const ackLabel = node("label", "evidence-ack-label", "二組の元資料の内容も含めて保存する", evidence), evidenceAck = node("input", "evidence-ack", undefined, ackLabel); evidenceAck.type = "checkbox";
  const evidenceSave = node("button", "evidence-save", "二組の元資料と新しい比較をまとめて保存", evidence); evidenceSave.type = "button";
  const fileLabel = node("label", "evidence-file-label", "まとめて保存した比較資料を再確認", evidence), evidenceFile = node("input", "evidence-file", undefined, fileLabel); evidenceFile.type = "file"; evidenceFile.accept = ".json,application/json";
  const stop = node("button", "evidence-stop", "まとめた比較資料の処理を中止", evidence); stop.type = "button";
  const evidenceStatus = node("p", "evidence-status", "", evidence); evidenceStatus.setAttribute("role", "status"); evidenceStatus.setAttribute("aria-live", "polite"); evidenceStatus.setAttribute("tabindex", "-1");
  const reviewSave = node("button", "evidence-review-save", "まとめた比較資料の照合結果を保存", evidence); reviewSave.type = "button";
  const viewer = mountReviewedBatchComparisonPanel({ document, parent: evidence, open: openReviewedRehearsalBatchComparisonEvidence,
    extract: extractRehearsalBatchComparisonEvidenceSource, encodeComparison: encodeRehearsalBatchComparison, queryDifferences: queryRehearsalBatchComparisonDifferences,
    encodeDifferences: encodeRehearsalBatchComparisonDifferences, download: prepared => download({ document, prepared }) });
  const kinds = { "only-before": "比較元だけに選択", "only-after": "今回だけに選択", "unchanged": "同じ内容の照合値・同じ確認結果", "bytes-changed": "内容の照合値が変化", "result-changed": "同じ内容の照合値・確認結果が変化", "uncompared": "照合値がなく比較できない" };
  const states = { matched: "再計算と一致", different: "再計算と相違", invalid: "内容を確認できない", unsupported: "対象外の形式", "hash-unavailable": "照合値を計算できない", "source-unavailable": "読み込めない", "checksum-mismatch": "以前の照合値と不一致", pending: "未確認" };
  function render() {
    hold.disabled = disposed || Boolean(active) || !current; clear.disabled = disposed || !baseline; json.disabled = csv.disabled = changed.disabled = disposed || Boolean(active) || !comparison;
    evidenceAck.disabled = disposed || Boolean(active) || !canPrepareRehearsalBatchEvidence(baseline) || !canPrepareRehearsalBatchEvidence(current);
    evidenceSave.disabled = evidenceAck.disabled || !evidenceAck.checked; evidenceFile.disabled = disposed || Boolean(active); stop.disabled = disposed || !active || active.signal.aborted;
    reviewSave.disabled = disposed || Boolean(active) || !evidenceReview; evidence.setAttribute("aria-busy", String(Boolean(active)));
    viewer.updateReview(!disposed && !active && evidenceReview?.matchesRecomputation ? evidenceReview : null);
    baselineText.textContent = baseline ? `比較元: 全${baseline.summary.selected}件／未確認${baseline.summary.pending}件／再計算の相違${baseline.summary.differing}件／期待結果との差がある資料${baseline.summary.reportsWithFailedExpectations}件。` : "比較元はまだ保持していません。";
    summary.textContent = comparison ? `両方に選択${comparison.summary.bothSelected}件／比較元だけ${comparison.summary.onlyBefore}件／今回だけ${comparison.summary.onlyAfter}件。照合値の変化${comparison.summary.bytesChanged}件／同じ照合値で判定が変化${comparison.summary.resultChanged}件／比較できない${comparison.summary.uncompared}件。今回の再計算の相違${comparison.after.summary.differing}件／期待結果との差がある資料${comparison.after.summary.reportsWithFailedExpectations}件。` : baseline ? "比較元を保持しています。次の資料の確認結果を待っています。" : "上で資料を確認し、比較元として保持してください。";
    if (comparison) { const s = comparison.after.summary; summary.textContent += ` 今回の内容・形式・照合値・読み込みの問題${s.invalid + s.unsupported + s.hashUnavailable + (s.checksumMismatches ?? 0) + (s.sourceUnavailable ?? 0)}件／未確認${s.pending}件。表示で隠れた行も含む全体の件数です。`; }
    rows.replaceChildren(...(comparison?.files ?? []).filter(row => !changed.checked || row.kind !== "unchanged").map(row => { const tr = document.createElement("tr"); for (const value of [row.name, kinds[row.kind], states[row.before?.status] ?? "選択なし", states[row.after?.status] ?? "選択なし", row.before?.sha256 ?? "未計算", row.after?.sha256 ?? "未計算", (row.before?.expectedOutcomes?.differing ?? "対象なし") + " → " + (row.after?.expectedOutcomes?.differing ?? "対象なし")]) { const td = document.createElement("td"); td.textContent = value; tr.append(td); } return tr; }));
  }
  function refresh() { ++revision; const old = active; active = null; old?.abort(); evidenceReview = null; evidenceAck.checked = false; evidenceStatus.textContent = ""; status.textContent = ""; comparison = baseline && current ? compareRehearsalBatches(baseline, current) : null; render(); }
  listen(hold, "click", () => { if (disposed || !current) return; baseline = current; refresh(); });
  listen(clear, "click", () => { if (disposed) return; baseline = null; refresh(); });
  listen(changed, "change", () => { if (!disposed) render(); });
  listen(evidenceAck, "change", render);
  async function evidenceJob(file = null) {
    if (disposed || active || (file ? evidenceFile.disabled : evidenceSave.disabled)) return false;
    const own = ++revision, left = baseline, right = current, job = new AbortController(); active = job; evidenceReview = null; evidenceAck.checked = false;
    evidenceStatus.textContent = file ? "二組の元資料と保存された比較を再確認しています。" : "二組の元資料から、新しい確認結果と比較を作っています。"; render();
    const owns = () => !disposed && own === revision && !job.signal.aborted;
    const onStage = stage => { if (owns()) evidenceStatus.textContent = comparisonEvidenceProgressText(stage); };
    try {
      if (file) {
        const text = await readSecurityFileText(file, { maxBytes: REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT, signal: job.signal });
        const review = await reviewRehearsalBatchComparisonEvidence(text, { signal: job.signal, onStage }); if (!owns()) return; evidenceReview = review;
        evidenceStatus.textContent = (review.matchesRecomputation ? "保存内容と二組の再計算・比較が一致しました。" : "保存内容と再計算・比較に相違があります。") +
          ` 比較元${review.beforeSummary.selected}件／比較先${review.afterSummary.selected}件／照合値の変化${review.comparisonSummary.bytesChanged}件。` +
          (review.allSourceReportsMatch ? "" : " 元資料自体に再計算の相違・形式・照合値の問題があります。照合結果の内訳をご確認ください。") + " 現在の一覧・比較元・履歴は置き換えていません。";
      } else {
        const prepared = await prepareRehearsalBatchComparisonEvidence(left, right, { signal: job.signal, onStage }); if (!owns()) return;
        requireSyncExport(download({ document, prepared })); if (owns()) evidenceStatus.textContent = "二組の元資料と新しい比較の保存を開始しました。中断・再試行の経過は、元の確認控えを別に保管してください。";
      }
      return owns();
    } catch { if (!disposed && own === revision) evidenceStatus.textContent = job.signal.aborted ? "まとめた比較資料の処理を中止しました。現在の一覧と比較元は保持しています。" : "まとめた比較資料を処理できませんでした。32 MiB以内の対応資料か確認してください。現在の一覧と比較元は保持しています。"; return false; }
    finally { const cancelled = job.signal.aborted; job.abort(); if (!disposed && own === revision) { active = null; if (cancelled) evidenceStatus.textContent = "まとめた比較資料の処理を中止しました。現在の一覧と比較元は保持しています。"; render(); } }
  }
  listen(evidenceSave, "click", () => { void evidenceJob(); });
  listen(evidenceFile, "change", () => { const chosen = evidenceFile.files?.length === 1 ? evidenceFile.files[0] : null; evidenceFile.value = ""; if (!disposed && !active && chosen) void evidenceJob(chosen); });
  listen(stop, "click", () => { if (!disposed && active) { active.abort(); render(); } });
  listen(reviewSave, "click", () => {
    if (disposed || active || !evidenceReview) return; const own = revision, review = evidenceReview;
    try { requireSyncExport(download({ document, prepared: { text: encodeRehearsalBatchComparisonEvidenceReview(review), filename: "ThreeCore-rehearsal-batch-comparison-evidence-review.json", mimeType: "application/json", containsOriginalEvidence: false, restorable: false } }));
      if (!disposed && own === revision) evidenceStatus.textContent += " 照合結果の保存を開始しました。";
    } catch { if (!disposed && own === revision) evidenceStatus.textContent = "照合結果を保存できませんでした。確認結果は保持しています。"; }
  });
  for (const [control, format] of [[json, "json"], [csv, "csv"]]) listen(control, "click", () => {
    if (disposed || !comparison || control.disabled) return; const own = revision, captured = comparison;
    try { requireSyncExport(download({ document, prepared: { text: encodeRehearsalBatchComparison(captured, format), filename: "ThreeCore-rehearsal-batch-comparison." + format, mimeType: format === "csv" ? "text/csv;charset=utf-8" : "application/json", containsOriginalEvidence: false, restorable: false } }));
      if (!disposed && own === revision && captured === comparison) status.textContent = "全行の比較結果の保存を開始しました。表示で隠れた行も含みます。二組の元資料も保管してください。";
    } catch { if (!disposed && own === revision && captured === comparison) status.textContent = "比較結果を保存できませんでした。二組の結果は保持しています。"; }
  });
  render(); return Object.freeze({ updateCurrent(value) { if (disposed || value === current) return; if (value !== null) compareRehearsalBatches(value, value); current = value; refresh(); },
    async inspectEvidenceFile(file) { if (disposed || active || !file) return false; host.open = evidence.open = true; for (let parent = host.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true; const expected = revision + 1, completed = await evidenceJob(file); if (!disposed && revision === expected) try { evidenceStatus.focus?.(); } catch {} return completed; },
    getState: () => Object.freeze({ baseline, current, comparison, evidenceReview, busy: Boolean(active), disposed }), dispose() { if (disposed) return; disposed = true; ++revision; const old = active; active = null; old?.abort(); baseline = current = comparison = evidenceReview = null; viewer.dispose(); listeners.forEach(remove => remove()); host.remove(); } });
}

/** Independent file-only review. It receives no live workspace writer. */
export function mountRehearsalBatchReviewPanel(document, { download, subtle = globalThis.crypto?.subtle, inspectSource = null }) {
  const get = id => document.getElementById("report-batch-" + id);
  const referenceReader = createFileReadScope(), listeners = [];
  let revision = 0, disposed = false, selection = null, active = null, result = null, sourceRows = [];
  let referenceText, referenceValid = true, referenceBusy = false, viewRevision = 0, evidenceReview = null, openedEvidence = null;
  const sourceExport = mountBatchSourceExportPanel({ document, parent: get("source-export"),
    download: prepared => download({ document, prepared }), list: review => openReviewedRehearsalBatchEvidence(review).files,
    extract: extractRehearsalBatchEvidenceSource });
  const receiptCheck = mountSavedBundleReceiptCheckPanel({ document, parent: get("source-export"),
    download: prepared => download({ document, prepared }), getExpected: () => disposed || active || referenceBusy ? null : evidenceReview,
    review: reviewRehearsalBatchEvidenceReceipt, encode: encodeRehearsalBatchEvidenceReceiptCheck,
    describe: batchEvidenceReceiptCheckText, filename: "ThreeCore-report-batch-evidence-receipt-check.json" });
  const selectionCheck = mountSavedBundleReceiptCheckPanel({ document, parent: get("source-export"),
    download: prepared => download({ document, prepared }), getExpected: () => disposed || active || referenceBusy ? null : result,
    review: reviewRehearsalBatchSelection, encode: encodeRehearsalBatchSelectionReview, describe: batchSelectionReviewText,
    filename: "ThreeCore-report-selection-review.json", recordLabel: "条件付きの保存結果",
    heading: "保存した絞り込み結果を現在の一覧と比較する", sourcePrompt: "先に、比較する元資料をこの画面で確認してください。",
    intro: "条件付きで保存したJSONを選びます。現在の確認結果から同じ条件を再計算し、保存された行・件数・全体の範囲と比較します。256 KiBまでです。保存時の処理経過や、除外された元資料の内容までは証明しません。",
    apply: checked => { if (disposed || active || !result) return false; const query = extractRehearsalBatchSelectionQuery(checked); get("filter-name").value = query.name; get("filter-status").value = query.status; applyView(); return true; } });
  const comparisonPanel = mountRehearsalBatchComparisonPanel(document, { parent: get("comparison"), download });
  const current = id => !disposed && id === revision;
  function listen(id, event, callback) {
    const node = get(id); node.addEventListener(event, callback);
    listeners.push(() => node.removeEventListener(event, callback));
  }
  function referenceReady() {
    if (referenceBusy || !referenceValid) return false;
    if (referenceText === undefined) return true;
    if (!selection) return false;
    try { matchRehearsalBatchManifest(selection.map(({ name, byteLength }) => ({ name, byteLength })), referenceText); return true; }
    catch { return false; }
  }
  function buttons() {
    const referenceMatches = referenceReady();
    receiptCheck.updateExpected();
    selectionCheck.updateExpected();
    comparisonPanel.updateCurrent(disposed || active || referenceBusy ? null : result);
    sourceExport.updateCurrent(disposed || active || referenceBusy ? null : openedEvidence);
    get("evidence-ack").disabled = disposed || Boolean(active) || !canPrepareRehearsalBatchEvidence(result);
    get("evidence-save").disabled = get("evidence-ack").disabled || !get("evidence-ack").checked;
    get("evidence-file").disabled = disposed || Boolean(active) || referenceBusy;
    get("evidence-review-save").disabled = disposed || Boolean(active) || !evidenceReview;
    for (const name of ["filter-name", "filter-status", "filter-clear"]) get(name).disabled = disposed || Boolean(active) || !result;
    get("run").disabled = disposed || !selection || Boolean(active) || !referenceMatches;
    get("resume").disabled = disposed || Boolean(active) || !canResumeRehearsalReportFileBatch(result);
    get("retry").disabled = disposed || Boolean(active) || !canRetryRehearsalReportFileBatch(result);
    get("cancel").disabled = disposed || !active || active.controller.signal.aborted;
    get("save").disabled = disposed || Boolean(active) || !result;
    let validFilter = false; try { if (result) { queryRehearsalBatchFiles(result, { name: get("filter-name").value, status: get("filter-status").value }); validFilter = true; } } catch { /* Invalid conditions cannot be exported. */ }
    get("selection-save").disabled = disposed || Boolean(active) || !validFilter;
    get("csv").disabled = disposed || Boolean(active) || !result;
    get("manifest").disabled = disposed || Boolean(active) || !result?.complete || result.files.some(row => row.sha256 === null);
    get("status").setAttribute("aria-busy", active ? "true" : "false");
    get("reference-status").setAttribute("aria-busy", referenceBusy ? "true" : "false");
    get("reference-status").textContent = referenceBusy ? "照合値一覧を読み込んでいます。" :
      !referenceValid ? "照合値一覧を確認してください。ファイル名だけを使った1〜20行のSHA-256一覧が必要です。使わない場合は「照合値の指定を解除」で解除できます。" :
      referenceText === undefined ? "以前の照合値は未指定です。今回の内容から照合値を計算します。" :
      !selection ? "照合値一覧を読み込みました。対応する資料を選んでください。" :
      !referenceMatches ? "一覧のファイル名と選択した資料が一致していません。名前・大文字小文字を変えず、一覧にある資料をすべて選んでください。" :
      "選択した" + selection.length + "件を、以前の一覧にある照合値と比較します。";
  }
  function reset({ keepSelection = false, keepReference = false } = {}) {
    const id = ++revision, old = active;
    active = null; if (!keepSelection) selection = null; result = null; sourceRows = [];
    old?.controller.abort(); referenceReader.cancel();
    if (!current(id)) return id;
    if (!keepReference) {
      referenceText = undefined; referenceValid = true;
      get("reference-text").value = ""; get("reference-file").value = "";
    } else if (referenceBusy) {
      referenceText = undefined; referenceValid = false; get("reference-file").value = "";
    }
    referenceBusy = false;
    get("rows").replaceChildren(); get("summary").textContent = "";
    evidenceReview = null; openedEvidence = null; get("evidence-ack").checked = false; get("evidence-file").value = "";
    get("evidence-status").textContent = "";
    get("filter-name").value = ""; get("filter-status").value = "all";
    get("filter-name").removeAttribute("aria-invalid"); get("filter-status").removeAttribute("aria-invalid");
    get("filter-summary").textContent = ""; ++viewRevision;
    get("export-status").textContent = ""; get("results").hidden = true;
    get("status").textContent = ""; buttons(); return id;
  }
  function applyView() {
    ++viewRevision; get("export-status").textContent = "";
    const name = get("filter-name").value, status = get("filter-status").value;
    const validName = typeof name === "string" && name.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name);
    const validStatus = ["all", "matched", "different", "invalid", "unsupported", "hash-unavailable", "pending", "checksum-mismatch", "source-unavailable", "expected-differences"].includes(status);
    get("selection-save").disabled = disposed || Boolean(active) || !result || !validName || !validStatus;
    get("filter-name").setAttribute("aria-invalid", String(!validName));
    get("filter-status").setAttribute("aria-invalid", String(!validStatus));
    let shown = 0;
    Array.from(get("rows").children).forEach((tr, index) => {
      const row = result?.files[index];
      const visible = Boolean(row && validName && validStatus && row.name.toLowerCase().includes(name.toLowerCase()) &&
        (status === "all" || (status === "expected-differences" ? row.expectedOutcomes?.differing > 0 : row.status === status)));
      tr.hidden = !visible; if (visible) shown++;
    });
    get("filter-summary").textContent = !validName || !validStatus ? "絞り込み条件を確認してください。ファイル名は80文字以内です。全体の結果は保持しています。" :
      result ? `表示 ${shown}件 ／ 全 ${result.files.length}件。絞り込みは一覧の表示だけに適用します。保存する控え・CSV・照合値一覧には全選択資料が含まれます。` : "";
  }
  function render(receipt, id, sources) {
    const labels = { matched: "再計算と一致", different: "再計算と相違あり", invalid: "資料の内容を確認できません",
      unsupported: "この欄の対象外の形式", "hash-unavailable": "照合値を計算できません", pending: "未確認",
      "checksum-mismatch": "以前の照合値と不一致（再計算は未実施）", "source-unavailable": "ファイルを読み込めません（再計算は未実施）" };
    const nodes = receipt.files.map((row, index) => {
      const tr = document.createElement("tr");
      const fields = [row.name, labels[row.status] + (row.expectedOutcomes?.differing ? "／期待結果との差あり" : ""),
        row.differenceCount === null ? "—" : String(row.differenceCount), (row.sha256 ?? "未計算") +
          (receipt.referenceProvided ? " ／ 基準: " + row.expectedSha256 : "")];
      for (const text of fields) { const td = document.createElement("td"); td.textContent = text; tr.append(td); }
      const cell = document.createElement("td"), button = document.createElement("button");
      button.type = "button"; button.textContent = "この資料を詳しく確認";
      button.setAttribute("aria-label", row.name + "を個別に再確認");
      button.disabled = typeof inspectSource !== "function" || row.sha256 === null;
      button.addEventListener("click", () => {
        if (!current(id) || result !== receipt || active || button.disabled || tr.hidden) return;
        const ownView = viewRevision;
        try {
          requireSyncExport(inspectSource(Object.freeze({ name: row.name, text: sources[index].text,
            expectedSha256: row.expectedSha256 ?? null })));
          if (current(id) && result === receipt && ownView === viewRevision) get("export-status").textContent = "個別の確認欄に同じ資料を渡しました。再確認の結果はそちらに表示します。一括確認の結果は保持しています。";
        } catch { if (current(id) && result === receipt && ownView === viewRevision) get("export-status").textContent = "個別の確認欄に渡せませんでした。一括確認の結果は保持しています。"; }
      });
      cell.append(button); tr.append(cell);
      return tr;
    });
    if (!current(id)) return;
    result = receipt; sourceRows = sources; get("rows").replaceChildren(...nodes); get("evidence-ack").checked = false;
    applyView();
    if (!current(id)) return;
    const s = receipt.summary;
    get("summary").textContent = `${s.selected}件中、確認済み ${s.reviewed}件／未確認 ${s.pending}件。再計算の一致 ${s.matching}件、相違 ${s.differing}件、形式・照合値の問題 ${s.invalid + s.unsupported + s.hashUnavailable + (s.checksumMismatches ?? 0)}件。期待結果との差が残る資料 ${s.reportsWithFailedExpectations}件。` +
      (receipt.referenceProvided ? ` 以前の照合値との一致 ${s.checksumsMatching}件、不一致 ${s.checksumMismatches}件、未比較 ${s.selected - s.checksumsCompared}件。` : "") +
      (Object.hasOwn(s, "sourceUnavailable") ? ` 読み込み失敗 ${s.sourceUnavailable}件。読み取れた内容 ${s.totalBytes}バイト。未読・失敗分の内容のバイト数は不明です。` : "") +
      (receipt.continuation ? ` 前回の結果を保持 ${receipt.continuation.retainedReviews}件。保持分は今回読み直していません。続き ${receipt.continuation.sequence}回目。` : "") +
      (receipt.retry ? ` 失敗分の再試行 ${receipt.retry.sequence}回目：対象 ${receipt.retry.targetIndexes.length}件中、再試行済み ${receipt.retry.completedIndexes.length}件／今回まだ再試行していないもの ${receipt.retry.remainingIndexes.length}件。前回の結果を保持 ${receipt.retry.retainedReviews}件。` : "");
    get("reference-note").textContent = receipt.referenceProvided ?
      "読み込んだ一覧との比較は、上記の一致・不一致・未比較の件数をご確認ください。一覧の出所を証明するものではありません。再計算の一致と期待結果への一致も別に確認してください。" :
      "再計算の一致は、期待結果への一致や資料の出所・安全性の証明とは別です。照合値は今回選んだ内容から計算しており、外部の正解値とは比較していません。";
    get("status").textContent = receipt.phase === "complete" ? (s.sourceUnavailable ? "読み込めない資料があります。他の資料の確認結果は保持しています。各行の結果をご確認ください。" : "選択した資料の確認を終えました。各行の結果をご確認ください。") :
      receipt.phase === "timed-out" ? "時間の上限に達したため停止しました。確認できた分の控えを保存できます。" : "確認を停止しました。確認できた分の控えを保存できます。";
    if (receipt.retry) get("status").textContent = receipt.complete ? "失敗分の再試行を終えました。各行の結果をご確認ください。対象外の結果は前回のものです。" : "再試行を中止・時間切れで止めました。まだ再試行していない行は、前回の失敗結果を保持しています。";
    get("results").hidden = false;
  }
  listen("files", "change", () => {
    if (disposed) return;
    if (get("files").files?.length === 0) { get("status").textContent = "ファイルの選択を取り消しました。前の選択・確認結果と進行中の処理は保持しています。"; return; }
    const id = reset({ keepReference: true });
    try {
      const offered = get("files").files, count = offered?.length;
      observeCallbackResult(count);
      if (!Number.isInteger(count) || count < 1 || count > REHEARSAL_BATCH_REVIEW_FILES) throw Error();
      const captured = [];
      for (let i = 0; i < count; i++) {
        const file = offered[i];
        const name = readFormatFileName(file, { maxLength: 180, fail() { throw Error(); }, code: "BATCH_NAME" });
        const byteLength = file.size; observeCallbackResult(byteLength);
        captured.push({ file, name, byteLength });
      }
      const checked = validateRehearsalReportBatchSelection(captured.map(({ name, byteLength }) => ({ name, byteLength })));
      if (!current(id)) return;
      selection = Object.freeze(captured.map((row, i) => Object.freeze({ file: row.file, ...checked.files[i] })));
      get("status").textContent = `${selection.length}件（合計 ${checked.totalBytes.toLocaleString("ja-JP")}バイト）を選びました。「まとめて再確認」で読み込みます。`;
      buttons();
    } catch { if (current(id)) get("status").textContent = "名前が重複しないJSONを1〜20個選んでください。1件2 MiB、合計8 MiB以内です。ファイル名に特殊な記号がある場合は名前を変更して選び直してください。"; }
  });
  function acceptReference(text) {
    referenceText = text === "" ? undefined : text;
    try { if (referenceText !== undefined) decodeRehearsalBatchManifest(referenceText); referenceValid = true; }
    catch { referenceValid = false; }
  }
  listen("reference-text", "input", () => {
    if (disposed) return;
    const text = get("reference-text").value, id = reset({ keepSelection: true });
    if (!current(id)) return;
    get("reference-text").value = text; acceptReference(text); buttons();
  });
  listen("reference-file", "change", async () => {
    if (disposed) return;
    const offered = get("reference-file").files, file = offered?.[0], count = offered?.length;
    if (count === 0) { get("reference-status").textContent = "照合値一覧の選択を取り消しました。前の指定・確認結果と進行中の処理は保持しています。"; return; }
    const id = reset({ keepSelection: true });
    if (!current(id)) return;
    referenceValid = false;
    if (!file || count !== 1) { buttons(); return; }
    referenceBusy = true; buttons();
    try {
      const text = await referenceReader.readText(file, { maxBytes: REHEARSAL_BATCH_MANIFEST_LIMIT });
      if (!current(id)) return;
      decodeRehearsalBatchManifest(text);
      get("reference-text").value = text; acceptReference(text);
    } catch { if (current(id)) referenceValid = false; }
    finally { if (current(id)) { referenceBusy = false; buttons(); } }
  });
  listen("reference-clear", "click", () => { if (!disposed) reset({ keepSelection: true }); });
  async function run(previous = null, retryFailed = false) {
    if (disposed || active || !selection || !referenceReady() || get("run").disabled) return;
    if (previous && (result !== previous || !(retryFailed ? canRetryRehearsalReportFileBatch : canResumeRehearsalReportFileBatch)(previous))) return;
    const id = ++revision, chosen = selection, manifestText = referenceText, job = { controller: new AbortController() };
    const retainedSources = previous ? sourceRows.slice() : [];
    active = job; result = previous;
    evidenceReview = null; openedEvidence = null; get("evidence-status").textContent = ""; get("evidence-ack").checked = false;
    if (!previous) { get("results").hidden = true; get("rows").replaceChildren(); get("summary").textContent = ""; }
    get("export-status").textContent = ""; buttons();
    try {
      const rows = retainedSources.slice();
      const read = async (index, options) => {
        if (!current(id) || job.controller.signal.aborted) throw Error("CANCELLED");
        const entry = chosen[index]; get("status").textContent = `資料を読み込んでいます（${index + 1} / ${chosen.length}）：${entry.name}`;
        const text = await readSecurityFileText(entry.file, options);
        if (!current(id) || job.controller.signal.aborted) throw Error("CANCELLED");
        rows[index] = Object.freeze({ name: entry.name, text }); return text;
      };
      const options = { subtle, signal: job.controller.signal,
        onProgress(progress) { if (current(id)) get("status").textContent = progress.retrySelected !== undefined ? `失敗分を再試行しています（${progress.retryReviewed} / ${progress.retrySelected}件）。対象外の結果は保持しています。` : `資料を再計算しています（${progress.reviewed} / ${progress.selected}件）。`; } };
      const receipt = previous ? await (retryFailed ? retryRehearsalReportFileBatch : resumeRehearsalReportFileBatch)(previous, read, options) :
        await reviewRehearsalReportFileBatch(chosen.map(({ name, byteLength }) => ({ name, byteLength })), read, { ...options, manifestText });
      if (current(id)) render(receipt, id, rows);
    } catch (error) {
      if (current(id) && previous) render(previous, id, retainedSources);
      if (current(id)) get("status").textContent = job.controller.signal.aborted ?
        "資料の読み込みを停止しました。再計算の結果はまだありません。" :
        "資料をまとめて読み込めませんでした。" + (describeFileReadError(error, "1件2 MiB") ?? "形式・照合値・読み込み条件を確認してから、もう一度実行してください。") + " 選択した資料と現在の履歴は変更していません。" + (previous ? " 前回の確認結果は保持しています。" : "");
    } finally {
      job.controller.abort();
      if (current(id)) { active = null; buttons(); }
    }
  }
  get("filter-name").value = ""; get("filter-status").value = "all";
  listen("evidence-ack", "change", buttons);
  async function evidenceJob(file = null) {
    if (disposed || active || referenceBusy || (file ? get("evidence-file").disabled : get("evidence-save").disabled)) return;
    const id = ++revision, previous = result, previousSources = sourceRows, job = { controller: new AbortController() };
    active = job; get("evidence-ack").checked = false; evidenceReview = null; buttons();
    let message = "", accepted = false;
    try {
      get("evidence-status").textContent = file ? "まとめて保存した資料を再確認しています。" : "元資料から新しい確認結果を計算し、保存の準備をしています。";
      const options = { subtle, signal: job.controller.signal };
      if (file) {
        const text = await readSecurityFileText(file, { maxBytes: REHEARSAL_BATCH_EVIDENCE_LIMIT, signal: job.controller.signal });
        const review = await reviewRehearsalBatchEvidence(text, options);
        if (!current(id) || job.controller.signal.aborted) return;
        evidenceReview = review;
        if (review.matchesRecomputation) {
          const opened = openReviewedRehearsalBatchEvidence(review);
          selection = null; get("files").value = "";
          referenceText = opened.result.referenceProvided ? opened.result.reference.text : undefined;
          referenceValid = true; get("reference-text").value = referenceText ?? ""; get("reference-file").value = "";
          get("filter-name").value = ""; get("filter-status").value = "all";
          render(opened.result, id, opened.files);
          openedEvidence = review;
          accepted = true;
          message = "保存内容と再計算が一致しました。元資料の確認結果を下の一覧に開きました。実際の履歴は変更していません。";
          if (!review.allSourceReportsMatch || review.expectedSummary.reportsWithFailedExpectations) message += " 元資料の相違・期待結果との差は、一覧の結果をご確認ください。";
        } else {
          if (previous) render(previous, id, previousSources);
          message = `保存内容に再計算との相違が${review.differenceCount}箇所あります。現在の一覧は置き換えていません。照合結果の控えを保存できます。`;
        }
      } else {
        const prepared = await prepareRehearsalBatchEvidence(previous, options);
        if (!current(id) || result !== previous || job.controller.signal.aborted) return;
        requireSyncExport(download({ document, prepared }));
        if (current(id) && result === previous) render(previous, id, previousSources);
        message = "全選択資料の元の内容と、新しい確認結果を一つのファイルで保存し始めました。再試行・中断の経過は、これまでの確認控えを別に保管してください。";
      }
    } catch (error) {
      if (current(id) && previous) render(previous, id, previousSources);
      message = job.controller.signal.aborted ? "まとめた資料の処理を停止しました。現在の一覧は保持しています。" :
        "まとめた資料を処理できませんでした。16 MiB以内の対応ファイルか確認してください。現在の一覧は保持しています。";
    } finally {
      job.controller.abort();
      if (current(id)) { active = null; get("evidence-status").textContent = message; buttons(); }
    }
    return accepted && current(id);
  }
  listen("evidence-save", "click", () => { void evidenceJob(); });
  listen("evidence-file", "change", () => {
    if (disposed || active) return;
    const offered = get("evidence-file").files;
    if (offered?.length === 1) void evidenceJob(offered[0]);
  });
  listen("evidence-review-save", "click", () => {
    if (disposed || active || !evidenceReview) return;
    const id = revision, own = evidenceReview;
    try {
      requireSyncExport(download({ document, prepared: { text: encodeRehearsalBatchEvidenceReview(own), filename: "ThreeCore-report-batch-evidence-review.json", mimeType: "application/json" } }));
      if (current(id) && evidenceReview === own) get("evidence-status").textContent += " 照合結果の控えを保存し始めました。";
    } catch { if (current(id) && evidenceReview === own) get("evidence-status").textContent = "照合結果の控えを保存できませんでした。確認結果は保持しています。"; }
  });
  for (const [name, event] of [["name", "input"], ["status", "change"]]) listen("filter-" + name, event, () => {
    if (!disposed && !active && result) applyView();
  });
  listen("filter-clear", "click", () => {
    if (disposed || active || !result) return;
    get("filter-name").value = ""; get("filter-status").value = "all"; applyView();
  });
  listen("run", "click", () => { void run(); });
  listen("resume", "click", () => { if (!get("resume").disabled) void run(result); });
  listen("retry", "click", () => { if (!get("retry").disabled) void run(result, true); });
  listen("cancel", "click", () => {
    if (disposed || !active) return;
    active.controller.abort();
    get("status").textContent = "停止しています。"; buttons();
  });
  listen("clear", "click", () => { if (disposed) return; reset(); get("files").value = ""; });
  listen("selection-save", "click", () => {
    if (disposed || active || !result || get("selection-save").disabled) return;
    const owner = revision, view = viewRevision, receipt = result;
    try { requireSyncExport(download({ document, prepared: { text: encodeRehearsalBatchSelection(receipt, { name: get("filter-name").value, status: get("filter-status").value }), filename: "ThreeCore-report-matching-file-results.json", mimeType: "application/json", containsOriginalEvidence: false, restorable: false } }));
      if (current(owner) && result === receipt && viewRevision === view) get("export-status").textContent = "条件に一致した行と、対象全体の件数・条件を保存し始めました。元資料と全件の控えも保管してください。";
    } catch { if (current(owner) && result === receipt && viewRevision === view) get("export-status").textContent = "条件に一致した結果を保存できませんでした。一覧と全件の結果は保持しています。"; }
  });
  for (const [button, encode, filename, mimeType] of [
    ["save", encodeRehearsalBatchReview, "ThreeCore-report-batch-review.json", "application/json"],
    ["csv", encodeRehearsalBatchCsv, "ThreeCore-report-batch-summary.csv", "text/csv;charset=utf-8"],
    ["manifest", encodeRehearsalBatchManifest, "SHA256SUMS.txt", "text/plain"],
  ]) listen(button, "click", () => {
    if (disposed || active || !result || get(button).disabled) return;
    const id = revision, own = result;
    try {
      const text = encode(own);
      const name = button === "manifest" && own.referenceProvided ? "ThreeCore-selected-content-SHA256SUMS.txt" : filename;
      requireSyncExport(download({ document, prepared: { text, filename: name, mimeType } }));
      if (current(id) && result === own) get("export-status").textContent = button === "csv" ? "全選択資料の一覧をCSVで保存し始めました。未確認の行も含みます。再確認には元資料・JSONの控え・以前の照合値一覧を保管してください。" : "確認用の控えを保存し始めました。元の資料も一緒に保管してください。";
    } catch { if (current(id) && result === own) get("export-status").textContent = "控えを保存できませんでした。確認結果は保持しています。"; }
  });
  buttons();
  return Object.freeze({ inspectEvidenceFile(file) {
    if (disposed || active || referenceBusy || !file) return Promise.resolve(false);
    let section = get("evidence-file").closest?.("details");
    while (section) { section.open = true; section = section.parentElement?.closest("details"); }
    try { get("evidence-file").focus?.(); } catch { /* Focus is advisory. */ }
    return evidenceJob(file);
  }, inspectComparisonEvidenceFile(file) { if (disposed || active || referenceBusy || !file) return Promise.resolve(false); return comparisonPanel.inspectEvidenceFile(file);
  }, dispose() {
    if (disposed) return;
    reset(); disposed = true; ++revision; for (const remove of listeners) remove(); sourceExport.dispose(); receiptCheck.dispose(); selectionCheck.dispose(); comparisonPanel.dispose(); buttons();
  } });
}

export function mountRehearsalReviewPanel(document, { download, subtle = globalThis.crypto?.subtle, getWorkspace = null, renderWorkspaceComparison = null, applyRecordQuery = null, reviewBatchEvidence = null, reviewComparisonEvidence = null }) {
  const offerDownload = payload => requireSyncExport(download(payload));
  const fileReader = createFileReadScope(), checksumReader=createFileReadScope();
  let checksumRevision=0,differenceOffset=0,differenceView=0,selectedDifference=null;
  const get = name => document.getElementById("report-review-" + name);
  const feedback=createRehearsalFieldFeedback(document,"report-review-status");
  let revision = 0, disposed = false, sourceText = null, receipt = null;
  let hashAbort = null;
  let sourceFile = null, pendingHandoff = null, sourceLoad = null;
  const listeners = [];
  function listen(name, event, fn) { get(name).addEventListener(event, fn); listeners.push(()=>get(name).removeEventListener(event, fn)); }
  function refreshBatchHandoff() { const unavailable = disposed || !sourceFile || Boolean(hashAbort) || Boolean(sourceLoad) || pendingHandoff?.revision === revision; get("batch-evidence").disabled = unavailable || typeof reviewBatchEvidence !== "function"; get("comparison-evidence").disabled = unavailable || typeof reviewComparisonEvidence !== "function"; }
  listen("comparison-evidence", "click", async () => {
    if (disposed || get("comparison-evidence").disabled || !sourceFile || typeof reviewComparisonEvidence !== "function") return;
    const job = { revision, file: sourceFile }; pendingHandoff = job; refreshBatchHandoff(); get("batch-evidence-status").textContent = "同じファイルを、二組の比較資料として再確認しています。";
    try { const accepted = await reviewComparisonEvidence(job.file); if (!disposed && revision === job.revision && sourceFile === job.file) get("batch-evidence-status").textContent = accepted === true ? "二組の比較資料の再確認を終えました。比較資料の欄で結果をご確認ください。現在の履歴・一覧・比較元は変更していません。" : "再確認の完了を確認できませんでした。二組の比較資料の欄をご確認ください。選んだファイルは保持しています。"; }
    catch { if (!disposed && revision === job.revision && sourceFile === job.file) get("batch-evidence-status").textContent = "二組の比較資料の確認欄に渡せませんでした。選んだファイルは保持しています。"; }
    finally { if (pendingHandoff === job) pendingHandoff = null; refreshBatchHandoff(); }
  });
  listen("batch-evidence", "click", async () => {
    if (disposed || get("batch-evidence").disabled || !sourceFile || typeof reviewBatchEvidence !== "function") return;
    const job = { revision, file: sourceFile }; pendingHandoff = job; refreshBatchHandoff();
    get("batch-evidence-status").textContent = "同じファイルを、まとめ資料の確認欄で再確認しています。";
    try { const accepted = await reviewBatchEvidence(job.file);
      if (!disposed && revision === job.revision && sourceFile === job.file) get("batch-evidence-status").textContent = accepted === true ? "まとめ資料の再確認を終えました。一括確認欄に結果を開きました。現在の履歴は変更していません。" : "再確認の完了を確認できませんでした。一括確認欄の表示をご確認ください。選んだファイルは保持しています。";
    } catch { if (!disposed && revision === job.revision && sourceFile === job.file) get("batch-evidence-status").textContent = "まとめ資料の確認欄に渡せませんでした。選んだファイルは保持しています。"; }
    finally { if (pendingHandoff === job) pendingHandoff = null; refreshBatchHandoff(); }
  });
  function refreshQueryAction(result){
    const enabled=typeof applyRecordQuery==="function"&&canReuseReviewedRehearsalQuery(result);
    get("query-apply").hidden=!enabled;get("query-apply").disabled=!enabled;get("query-status").textContent="";
  }
  listen("query-apply","click",()=>{
    if(disposed||get("query-apply").disabled||typeof applyRecordQuery!=="function"||!canReuseReviewedRehearsalQuery(receipt))return;
    const own=revision,reviewed=receipt;
    try{const query=extractReviewedRehearsalQuery(reviewed);requireSyncExport(applyRecordQuery(query));
      if(!disposed&&own===revision&&receipt===reviewed)get("query-status").textContent="資料の検索条件を現在の履歴に設定しました。件数・内容は現在の履歴から再計算しています。資料内の過去の履歴は復旧していません。";
    }catch{if(!disposed&&own===revision&&receipt===reviewed)get("query-status").textContent="検索結果への移動を確認できませんでした。元資料と現在の履歴は保持しています。";}
  });
  let partGeneration=0,partChoices=[];
  function refreshPartChoices(result){
    partGeneration++;partChoices=reviewedRehearsalInputChoices(result);const select=get("input-part");select.textContent="";select.value="";
    const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent="取り出す入力を明示して選んでください";select.append(placeholder);
    for(const choice of partChoices){const option=document.createElement("option");option.value=choice.part;option.textContent=choice.label;select.append(option);}
    select.value="";select.disabled=!partChoices.length;get("input-recovery").hidden=!partChoices.length;get("input-save").disabled=true;get("input-note").textContent="";
  }
  listen("input-part","change",()=>{
    if(disposed)return;partGeneration++;const choice=partChoices.find(item=>item.part===get("input-part").value);
    get("input-save").disabled=!choice;get("input-note").textContent=choice?choice.note+" 読み込む場所: 「"+choice.destination+"」。現在の履歴・ケース集は変わりません。":"";
  });
  listen("input-save","click",()=>{
    if(disposed||!receipt||get("input-save").disabled)return;
    const own=revision,generation=partGeneration,reviewed=receipt,part=get("input-part").value;
    const current=()=>!disposed&&revision===own&&partGeneration===generation&&receipt===reviewed&&get("input-part").value===part;
    try{const recovered=exportReviewedRehearsalPart(reviewed,part);
      requireSyncExport(download({document,prepared:{text:recovered.text,filename:recovered.filename,mimeType:recovered.mimeType}}));
      if(current())get("export-status").textContent=recovered.label+"を保存し始めました。読み込む場所: 「"+recovered.destination+"」。現在の履歴・ケース集は変更していません。";
    }catch{if(current())get("export-status").textContent="選んだ元入力を保存できませんでした。資料と現在の履歴・ケース集は保持しています。";}
  });
  let workspaceGeneration=0,workspaceComparison=null;
  const workspaceToolsAvailable=()=>!disposed&&canExportReviewedRehearsalWorkspace(receipt)&&typeof getWorkspace==="function"&&typeof renderWorkspaceComparison==="function";
  function resetWorkspaceComparison(message="") {
    workspaceGeneration++;workspaceComparison=null;
    get("workspace-comparison-details").textContent="";get("workspace-comparison").hidden=true;
    get("workspace-comparison-status").textContent=message;get("workspace-comparison-save").disabled=true;
    const enabled=workspaceToolsAvailable();get("workspace-compare").disabled=!enabled;get("workspace-compare").hidden=!enabled;
  }
  function workspaceChanged(){if(disposed)return;resetWorkspaceComparison(workspaceComparison?"現在の履歴が変わりました。資料との比較をやり直してください。":"");}
  function refreshAgentExtraction(result) {
    get("agent-select").textContent="";get("agent-select").value="";
    const allowed=canExportReviewedRehearsalWorkspace(result),subjects=allowed?result.scope.filter(row=>row.beforeRecords!==null):[];
    for(const subject of subjects){const option=document.createElement("option");option.value=subject.agent;option.textContent=subject.agent+" / "+subject.beforeRecords+"件";get("agent-select").append(option);}
    get("agent-select").value=subjects[0]?.agent??"";get("agent-select").disabled=!subjects.length;get("agent-save").disabled=!subjects.length;get("agent-recovery").hidden=!subjects.length;
  }
  listen("agent-save","click",()=>{
    if(disposed||!receipt||get("agent-save").disabled)return;
    const own=revision,reviewed=receipt,agent=get("agent-select").value;
    try{const text=exportReviewedRehearsalAgent(reviewed,agent);
      requireSyncExport(download({document,prepared:{text,filename:"ThreeCore-"+agent+"-recovered-rehearsal.json",mimeType:"application/json"}}));
      if(disposed||own!==revision||receipt!==reviewed||get("agent-select").value!==agent)return;
      get("export-status").textContent=agent+"の元入力だけを保存し始めました。現在の履歴には反映していません。読み込む場合は「記録を保存・再確認」で確認してください。";
    }catch{if(!disposed&&own===revision&&receipt===reviewed&&get("agent-select").value===agent)get("export-status").textContent="選んだ対象の元入力を保存できませんでした。元資料と現在の履歴は保持しています。";}
  });
  listen("workspace-compare","click",()=>{
    if(!workspaceToolsAvailable()||get("workspace-compare").disabled)return;
    resetWorkspaceComparison();const own=revision,generation=workspaceGeneration,reviewed=receipt;
    const current=()=>!disposed&&revision===own&&workspaceGeneration===generation&&receipt===reviewed;
    try{const inputs=requireSyncExport(getWorkspace());if(!current())return;
      const report=compareReviewedRehearsalWorkspace(reviewed,inputs),text=encodeRehearsalComparison(report.inputs.before,report.inputs.after);
      const stage=document.createElement("div");requireSyncExport(renderWorkspaceComparison(report,stage));if(!current())return;
      workspaceComparison=Object.freeze({report,text,beforeText:encodeRehearsalWorkspace(report.inputs.before)});
      get("workspace-comparison-details").textContent="";
      for(const child of Array.from(stage.childNodes??stage.children))get("workspace-comparison-details").append(child);
      if(!current())return;
      get("workspace-comparison-status").textContent="現在の履歴 → 資料内の元入力、の向きで比較しました。現在の履歴への適用は行っていません。";
      get("workspace-comparison").hidden=false;get("workspace-comparison-save").disabled=false;
    }catch{if(current())resetWorkspaceComparison("現在の履歴と資料内の元入力を比較できませんでした。元資料と現在の履歴は保持しています。");}
  });
  listen("workspace-comparison-save","click",()=>{
    const saved=workspaceComparison;if(!workspaceToolsAvailable()||!saved||get("workspace-comparison-save").disabled)return;
    const own=revision,generation=workspaceGeneration,reviewed=receipt;
    const current=()=>!disposed&&revision===own&&workspaceGeneration===generation&&receipt===reviewed&&workspaceComparison===saved;
    try{const beforeText=encodeRehearsalWorkspace(requireSyncExport(getWorkspace()));if(!current())return;
      if(beforeText!==saved.beforeText){workspaceChanged();return;}
      requireSyncExport(download({document,prepared:{text:saved.text,filename:"ThreeCore-current-vs-reviewed-workspace.json",mimeType:"application/json"}}));
      if(current())get("export-status").textContent="現在の履歴と資料内の元入力の比較を、両方の入力と一緒に保存し始めました。資料の再確認欄で再計算できます。";
    }catch{if(current())get("export-status").textContent="比較資料を保存できませんでした。元資料と現在の履歴は保持しています。";}
  });
  mountDifferenceQuerySave(document,get,listen,()=>({review:receipt,target:"report",revision,view:differenceView,disposed}),download);
  const fileNotice = createFileSelectionNotice(get("file"), get("file-note"));
  listeners.push(() => fileNotice.dispose());
  const checksumNotice=createFileSelectionNotice(get("checksum-file"),get("checksum-file-note"));
  listeners.push(()=>checksumNotice.dispose());
  function invalidate(message) {
    const own=++revision;checksumRevision++;differenceView++;setDifferenceFilters(get,false,true);selectedDifference=null;get("difference-save").disabled=true;get("difference-detail").hidden=true;get("difference-detail").textContent="";
    const previous=hashAbort;hashAbort=null;receipt=null;differenceOffset=0;resetWorkspaceComparison();refreshAgentExtraction(null);refreshPartChoices(null);refreshQueryAction(null);
    get("batch-evidence-status").textContent = ""; refreshBatchHandoff();
    feedback.clear();checksumNotice.clear();get("checksum-file").value="";
    get("checksum-file-status").textContent="";get("checksum-file-status").setAttribute("aria-busy","false");
    fileNotice.clear();get("previous").disabled=true;get("next").disabled=true;get("difference-status").textContent="";
    for(const name of ["scope", "differences", "digest", "summary", "outcome", "export-status"])get(name).textContent="";
    for(const name of ["save","source-save","checksum-save","evidence-save","workspace-save"])get(name).disabled=true;get("workspace-save").hidden=true;
    get("results").hidden=true;get("status").textContent=message;get("status").className="";get("status").setAttribute("aria-busy","false");
    previous?.abort();if(own!==revision)return null;
    checksumReader.cancel();if(own!==revision)return null;
    fileReader.cancel();return disposed||own!==revision?null:own;
  }
  function reset(message = "保存した確認一覧・復旧比較・条件比較・ケース集の集計・期待結果の確認・記録検索・操作別の資料を選んでください。現在の履歴には反映しません。") {
    sourceText = null; sourceFile = null; sourceLoad = null; get("run").disabled = true;
    get("source").textContent = ""; get("file").value = ""; get("text").value = "";return invalidate(message);
  }
  function row(target, values) {
    const tr = document.createElement("tr");
    for(const value of values) {const td=document.createElement("td");td.textContent=value;tr.append(td);}
    get(target).append(tr); return tr;
  }
  function renderDifferencePage() {
    get("differences").textContent="";get("difference-query-save").disabled=true;
    const view=++differenceView, owner=revision, reviewed=receipt;selectedDifference=null;get("difference-save").disabled=true;
    get("difference-detail").hidden=true;get("difference-detail").textContent="";
    if(!receipt)return;
    const page=readDifferenceFilterPage(get,query=>queryReviewedRehearsalDifferences(receipt,query,differenceOffset));if(!page)return;differenceOffset=page.offset;
    const labels={missing:"項目が不足",unexpected:"余分な項目",type:"値の種類が異なる",value:"値が異なる","array-length":"件数が異なる"};
    for(const diff of page.differences){
      const tr=row("differences",[diff.path,labels[diff.kind]]);
      addDifferenceDetailButton(document,tr,diff.index,()=>inspectReviewedRehearsalDifference(reviewed,diff.index),
        ()=>!disposed&&revision===owner&&differenceView===view&&receipt===reviewed,get("difference-detail"),"保存資料",()=>{selectedDifference=diff.index;get("difference-save").disabled=false;});
    }
    get("difference-query-save").disabled=false;get("difference-status").textContent=differencePageText(page);
    get("previous").disabled=!page.hasPrevious;get("next").disabled=!page.hasNext;
  }
  async function run() {
    if(disposed || sourceText === null) return;
    const own=invalidate("資料を再計算しています。現在の履歴は保持しています。");if(own===null)return;
    const text = sourceText, expectedSha256 = get("expected").value.trim() || null;
    const ownHash = new AbortController(); hashAbort = ownHash; refreshBatchHandoff();
    get("status").setAttribute("aria-busy", "true");
    try {
      const result = await reviewRehearsalReport(text, { expectedSha256, subtle, signal: ownHash.signal });
      if(disposed || own !== revision) return;
      receipt = result;setDifferenceFilters(get,true); get("results").hidden = false; for(const name of ["save","source-save","checksum-save","evidence-save"])get(name).disabled=false;
      const recoverable=canExportReviewedRehearsalWorkspace(result);get("workspace-save").disabled=!recoverable;get("workspace-save").hidden=!recoverable;refreshAgentExtraction(result);resetWorkspaceComparison();refreshPartChoices(result);refreshQueryAction(result);
      const matches = result.matchesRecomputation && result.checksumMatches !== false;
      const expectedDifferences = result.reportOutcome?.kind === "expected-outcomes" && !result.reportOutcome.allMatched;
      get("status").className = matches && !expectedDifferences ? "passed" : "blocked";
      get("status").textContent = !result.matchesRecomputation ? "資料の計算結果に不一致があります。下の項目を確認してください。"
        : result.checksumMatches === false ? "再計算は一致しましたが、指定された照合値と一致しません。別の資料の可能性があります。"
        : expectedDifferences ? "資料の計算結果は再計算と一致しました。資料内には期待結果との差があります。下の内訳を確認してください。"
        : "資料の計算結果は再計算と一致しました。入力の出所や実際の残高を証明するものではありません。";
      get("digest").textContent = "確認した文字列のSHA-256: " + result.sha256 + " / " + result.byteLength + " bytes";
      get("summary").textContent = "資料: " + (reportNames[result.inputSchema] ?? result.inputSchema) + " / 再計算との不一致 " + result.differenceCount + "箇所 / 照合値: " +
        (result.checksumMatches === null ? "指定なし" : result.checksumMatches ? "一致" : "不一致") +
        (result.differencesTruncated ? "。相違一覧は40箇所ずつ表示します。" : "");
      get("outcome").textContent = outcomeText(result.reportOutcome);
      for(const scope of result.scope) row("scope", [scope.agent + (scope.caseId ? " / " + scope.caseId : ""), scope.beforeRecords === null ? "未作成" : scope.beforeRecords + "件",
        [REHEARSAL_OVERVIEW_SCHEMA, REHEARSAL_RECORD_REPORT_SCHEMA, REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA, REHEARSAL_REFERENCE_REPORT_SCHEMA, REHEARSAL_REASON_RECORD_REPORT_SCHEMA,REHEARSAL_RECORD_SUMMARY_SCHEMA,REHEARSAL_PREFIX_REPORT_SCHEMA].includes(result.inputSchema) ? "比較なし" : scope.afterRecords === null ? "未作成" : scope.afterRecords + "件"]);
      renderDifferencePage();
    } catch(error) {
      if(disposed || own !== revision) return;
      const reason = describeRehearsalFileTarget(text, "report") ?? {INVALID_EXPECTED_CHECKSUM:"照合値はSHA-256の64桁で入力してください。使える文字は0〜9とa〜fです。",
        UNSUPPORTED_REVIEW_REPORT:"この形式には対応していません。確認一覧・比較・ケース集の集計・期待結果・記録検索・操作別・検索集計・途中までの再現資料を選んでください。",
        REVIEW_HASH_UNAVAILABLE:"照合値を計算できませんでした。もう一度確認してください。",
        SCENARIO_CONTEXT_OR_EVENTS_CHANGED:"比較資料の口座・資産・元の記録が一致しないため、同じ履歴として比較できません。"}[error?.code]
        ?? "資料の形式や含まれる入力記録を確認できませんでした。2 MiB以内の保存済み資料を選んでください。";
      const retired=invalidate(reason + " 現在の履歴は保持しています。");
      if(retired!==null&&!disposed&&Object.getOwnPropertyDescriptor(error,"code")?.value==="INVALID_EXPECTED_CHECKSUM")
        feedback.field("report-review-expected","照合するSHA-256","64桁で入力してください。使える文字は0〜9とa〜fです。照合値がない場合は空欄にできます。");
    } finally {
      if(hashAbort === ownHash) hashAbort = null;
      refreshBatchHandoff();
      if(!disposed && own === revision) get("status").setAttribute("aria-busy", "false");
    }
  }
  listen("file", "change", async()=>{
    if(disposed) return;
    const file=get("file").files?.[0]; if(!file) { fileNotice.noSelection(); return; }
    const own=reset("選択した資料を読み込んでいます。");if(own===null)return;
    const load = {}; sourceLoad = load; sourceFile = file; refreshBatchHandoff();
    get("status").setAttribute("aria-busy", "true");
    const name = displayFileName(file, "選択した資料");
    if (disposed || own !== revision) return;
    get("source").textContent="確認するファイル: "+(name||"選択した資料");
    try {
      const text = await fileReader.readText(file, { maxBytes: REHEARSAL_REPORT_REVIEW_LIMIT }); if(disposed||own!==revision) return;
      sourceText=text; get("run").disabled=false;
      await run();
    } catch(error) { if(!disposed&&own===revision) { const cleared = reset((describeFileReadError(error,"2 MiB")??"ファイルを読み込めませんでした。2 MiB以内のUTF-8の資料を選んでください。")+" まとめ資料の場合は、下の『まとめた資料として再確認』を使えます。現在の履歴は保持しています。"); if (cleared !== null && !disposed && cleared === revision) { sourceFile = file; get("source").textContent = "まとめ資料として再確認できるファイル: " + (name || "選択した資料"); refreshBatchHandoff(); } } }
    finally { if (sourceLoad === load) { sourceLoad = null; refreshBatchHandoff(); } }
  });
  listen("paste", "click", async()=>{
    if(disposed) return;
    const text=get("text").value;
    const own=reset("貼り付けた資料を確認しています。");if(own===null)return;sourceText=text;
    get("source").textContent="確認する資料: 貼り付けた文字列（元ファイルのバイト列とは異なる場合があります）";
    get("run").disabled=false; await run();
  });
  listen("checksum-file","change",async()=>{
    if(disposed)return;const file=get("checksum-file").files?.[0];if(!file){checksumNotice.noSelection();return;}
    get("checksum-file").value="";const own=++checksumRevision,owner=revision;checksumReader.cancel();
    if(disposed||own!==checksumRevision||owner!==revision)return;checksumNotice.clear();
    get("checksum-file-status").textContent="照合値のファイルを読み込んでいます。";get("checksum-file-status").setAttribute("aria-busy","true");
    try{
      const text=await checksumReader.readText(file,{maxBytes:1024});if(disposed||own!==checksumRevision||owner!==revision)return;
      const value=decodeRehearsalChecksumText(text),name=displayFileName(file,"照合値ファイル");
      if(disposed||own!==checksumRevision||owner!==revision)return;
      get("expected").value=value;if(invalidate("照合値を読み込みました。「選択済みの資料を再確認」を押してください。資料が未選択の場合は先に資料を選んでください。")===null)return;
      get("checksum-file-status").textContent="読み込んだ照合値: "+name+"。再確認すると資料の照合値と比較します。";
    }catch(error){if(disposed||own!==checksumRevision||owner!==revision)return;
      get("checksum-file-status").textContent=(describeFileReadError(error,"1 KiB")??"64桁のSHA-256だけを含むテキストファイルを選んでください。")+" 現在の照合値と確認結果は変更していません。";
    }finally{if(!disposed&&own===checksumRevision&&owner===revision)get("checksum-file-status").setAttribute("aria-busy","false");}
  });
  listen("expected", "input", ()=>{ if(!disposed) invalidate("照合値が変わりました。「選択済みの資料を再確認」を押してください。"); });
  listen("text", "input", ()=>{
    if(disposed) return; sourceText=null;get("run").disabled=true;get("source").textContent="";
    invalidate("貼り付けた内容を確認するボタンを押してください。");
  });
  for(const [name,event] of [["difference-search","input"],["difference-type","change"]])listen(name,event,()=>{if(disposed||!receipt)return;differenceOffset=0;renderDifferencePage();});
  listen("difference-filter-clear","click",()=>{if(disposed||!receipt)return;setDifferenceFilters(get,true,true);differenceOffset=0;renderDifferencePage();});
  listen("previous","click",()=>{if(disposed||!receipt)return;differenceOffset=Math.max(0,differenceOffset-40);renderDifferencePage();});
  listen("next","click",()=>{if(disposed||!receipt)return;differenceOffset+=40;renderDifferencePage();});
  listen("run", "click", run);
  listen("clear", "click", ()=>{if(!disposed) reset();});
  listen("save", "click", ()=>{
    if(disposed||!receipt) return;
    const own=revision; try {
      offerDownload({document,prepared:{text:encodeRehearsalReviewReceipt(receipt),filename:"ThreeCore-report-review-receipt.json",mimeType:"application/json"}});if(disposed||own!==revision)return;
      get("export-status").textContent="確認結果と照合値の控えを保存し始めました。元の資料はこの控えに含まれません。";
    } catch {if(disposed||own!==revision)return; get("export-status").textContent="控えを保存できませんでした。確認結果は保持しています。"; }
  });
  listen("workspace-save","click",()=>{
    if(disposed||!receipt||get("workspace-save").disabled)return;
    const own=revision,reviewed=receipt;
    try{const text=exportReviewedRehearsalWorkspace(reviewed);
      requireSyncExport(download({document,prepared:{text,filename:"ThreeCore-recovered-workspace.json",mimeType:"application/json"}}));
      if(disposed||own!==revision||receipt!==reviewed)return;
      get("export-status").textContent="資料に含まれる全トークンの元入力を、一括履歴JSONとして保存し始めました。現在の履歴には反映していません。読み込む場合は「保存した3トークンの履歴を戻す」で確認してください。";
    }catch{if(!disposed&&own===revision&&receipt===reviewed)get("export-status").textContent="元入力を履歴ファイルとして保存できませんでした。元資料と現在の履歴は保持しています。";}
  });
  for(const [name,original]of [["source-save",true],["checksum-save",false]])listen(name,"click",()=>{
    if(disposed||!receipt||sourceText===null)return;
    const own=revision,data=receipt,text=sourceText;
    try{
      offerDownload({document,prepared:original?{text,filename:"ThreeCore-reviewed-report.json",mimeType:"application/json"}:
        {text:data.sha256+"\n",filename:"ThreeCore-reviewed-report-sha256.txt",mimeType:"text/plain"}});
      if(disposed||own!==revision)return;
      get("export-status").textContent=original?"確認した元資料の保存を開始しました。確認に使った文字列をそのまま含みます。一致・不一致の結果は別の控えに保存してください。":
        "確認した文字列のSHA-256を保存し始めました。元資料と確認結果の控えも一緒に保管してください。";
    }catch{if(disposed||own!==revision)return;get("export-status").textContent=original?"元資料の保存を開始できませんでした。確認結果は保持しています。":"照合値の保存を開始できませんでした。確認結果は保持しています。";}
  });
  listen("difference-save","click",()=>{
    const selected=selectedDifference,reviewed=receipt,owner=revision,view=differenceView;
    if(disposed||!reviewed||selected===null)return;
    const owns=()=>!disposed&&revision===owner&&differenceView===view&&receipt===reviewed&&selectedDifference===selected;
    try{
      offerDownload({document,prepared:{text:encodeRehearsalDifferenceValues(reviewed,selected),filename:"ThreeCore-report-difference-"+(selected+1)+".json",mimeType:"application/json"}});
      if(owns())get("export-status").textContent="選んだ相違の値を省略せずに保存し始めました。元資料と確認結果も一緒に保管してください。";
    }catch{if(owns())get("export-status").textContent="相違の値を保存できませんでした。表示と元資料は保持しています。";}
  });
  listen("evidence-save","click",()=>{
    if(disposed||!receipt)return;
    const own=revision;
    try{
      offerDownload({document,prepared:{text:encodeRehearsalReviewEvidence(receipt),filename:"ThreeCore-review-evidence.json",mimeType:"application/json"}});
      if(disposed||own!==revision)return;
      get("export-status").textContent="元資料・確認結果・照合値を一つにした証拠ファイルの保存を開始しました。不一致がある場合も、その結果を含みます。";
    }catch{if(disposed||own!==revision)return;get("export-status").textContent="証拠ファイルの保存を開始できませんでした。確認結果は保持しています。";}
  });
  reset();
  const evidencePanel=mountRehearsalEvidencePanel(document,{download,subtle});
  function inspectSource(input) {
    if (disposed) return false;
    let value;
    try {
      value = captureDataRecord(input, ["name", "text", "expectedSha256"]);
      validateRehearsalReportBatchSelection([{ name: value.name, byteLength: boundedUtf8Length(value.text, REHEARSAL_REPORT_REVIEW_LIMIT) }]);
      if (value.expectedSha256 !== null && (typeof value.expectedSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(value.expectedSha256))) return false;
    } catch { return false; }
    const own = reset("一括確認で選んだ資料を個別に再確認します。");
    if (own === null || disposed) return false;
    sourceText = value.text; get("expected").value = value.expectedSha256 ?? "";
    get("source").textContent = "一括確認から受け取った元資料: " + value.name;
    get("run").disabled = false;
    observeCallbackResult(run());
    if (!disposed) { get("title").scrollIntoView?.({ block: "start", behavior: "auto" }); get("title").focus?.(); }
    return !disposed;
  }
  return Object.freeze({workspaceChanged,inspectSource,dispose(){if(disposed)return;disposed=true;evidencePanel.dispose();reset("");get("expected").value="";for(const remove of listeners)remove();}});
}

/** Inspect a portable evidence file independently of the active rehearsal and ordinary report. */
export function mountRehearsalEvidencePanel(document, { download, subtle = globalThis.crypto?.subtle }) {
  const get = name => document.getElementById("report-evidence-" + name), reader = createFileReadScope();
  const listeners = []; let revision = 0, disposed = false, hashAbort = null, result = null, sourceText = null, differenceOffset = 0, differenceView = 0, selectedDifference = null;
  const notice = createFileSelectionNotice(get("file"), get("file-note"));
  function listen(name, event, fn) { get(name).addEventListener(event, fn); listeners.push(() => get(name).removeEventListener(event, fn)); }
  mountDifferenceQuerySave(document,get,listen,()=>({review:result,target:get("difference-kind").value==="source"?"evidence-source":"evidence-receipt",revision,view:differenceView,disposed}),download);
  function reset(message) {
    const own=++revision; result=null; sourceText=null; differenceOffset=0;differenceView++;setDifferenceFilters(get,false,true);selectedDifference=null;get("difference-save").disabled=true;get("difference-detail").hidden=true;get("difference-detail").textContent="";get("previous").disabled=true;get("next").disabled=true;get("difference-kind").disabled=true;get("difference-status").textContent="";
    const previous=hashAbort; hashAbort=null; previous?.abort();
    if(own!==revision)return null;
    reader.cancel();
    if(own!==revision)return null;
    notice.clear();
    for (const name of ["summary", "digest", "differences", "outcome", "source", "export-status"]) get(name).textContent = "";
    get("results").hidden = true; get("source-save").disabled = true; get("save").disabled = true;
    get("status").textContent = message; get("status").className = ""; get("status").setAttribute("aria-busy", "false");
    return own;
  }
  function failed(error, own, text = null) {
    if (disposed || own !== revision) return;
    const reason = describeRehearsalFileTarget(text, "evidence") ?? describeFileReadError(error, "6 MiB") ??
      (Object.getOwnPropertyDescriptor(error, "code")?.value === "REVIEW_HASH_UNAVAILABLE"
        ? "照合値を計算できませんでした。もう一度選んでください。"
        : "証拠ファイルを確認できませんでした。「元資料と確認結果をまとめて保存」で作った6 MiB以内のJSONを選んでください。");
    reset(reason + " 現在の履歴や別欄の確認結果は変更していません。");
  }
  function renderDifferencePage() {
    get("differences").textContent="";get("difference-query-save").disabled=true;
    const view=++differenceView,owner=revision,reviewed=result;selectedDifference=null;get("difference-save").disabled=true;
    get("difference-detail").hidden=true;get("difference-detail").textContent="";if(!result)return;
    const source=get("difference-kind").value==="source";
    const page=readDifferenceFilterPage(get,query=>source?queryReviewedRehearsalDifferences(result.reportReview,query,differenceOffset):queryRehearsalEvidenceReceiptDifferences(result,query,differenceOffset));if(!page)return;
    differenceOffset=page.offset;const label=source?"元資料":"確認結果の控え";
    const labels={missing:"項目が不足",unexpected:"余分な項目",type:"値の種類が異なる",value:"値が異なる","array-length":"件数が異なる"};
    for(const diff of page.differences){
      const row=document.createElement("tr");for(const value of [label,diff.path,labels[diff.kind]]){const cell=document.createElement("td");cell.textContent=value;row.append(cell);}get("differences").append(row);
      addDifferenceDetailButton(document,row,diff.index,()=>source?inspectReviewedRehearsalDifference(reviewed.reportReview,diff.index):inspectRehearsalEvidenceReceiptDifference(reviewed,diff.index),
        ()=>!disposed&&revision===owner&&differenceView===view&&result===reviewed,get("difference-detail"),source?"元資料":"保存された確認結果の控え",()=>{selectedDifference=diff.index;get("difference-save").disabled=false;});
    }
    get("difference-query-save").disabled=false;get("difference-status").textContent=differencePageText(page,label);
    get("previous").disabled=!page.hasPrevious;get("next").disabled=!page.hasNext;
  }
  async function inspect(text, own) {
    if (disposed || own !== revision) return;
    const control = new AbortController(); hashAbort = control;
    try {
      const checked = await reviewRehearsalEvidence(text, { subtle, signal: control.signal });
      if (disposed || own !== revision) return;
      result = checked; sourceText = decodeRehearsalReviewEvidence(text).sourceText;
      const report = checked.reportReview, expectationDiff = report.reportOutcome?.kind === "expected-outcomes" && !report.reportOutcome.allMatched;
      const matches = checked.matchesReceipt && report.matchesRecomputation && report.checksumMatches !== false;
      get("status").className = matches && !expectationDiff ? "passed" : "blocked";
      get("status").textContent = !checked.matchesReceipt ? "証拠内の確認結果の控えが、今回の再計算と一致しません。下の相違を確認してください。"
        : !report.matchesRecomputation ? "控えは再現できましたが、元資料の計算結果に不一致があります。"
        : report.checksumMatches === false ? "控えは再現できましたが、元資料は記録された照合値と一致しません。"
        : expectationDiff ? "証拠内の控えと再計算は一致しました。元資料には期待結果との差があります。"
        : "証拠内の控えと再計算は一致しました。入力の出所や実際の残高を証明するものではありません。";
      get("summary").textContent = "控えとの相違 " + checked.differenceCount + "箇所 / 元資料の再計算との相違 " + report.differenceCount + "箇所 / 記録された照合値: " +
        (report.checksumMatches === null ? "指定なし" : report.checksumMatches ? "一致" : "不一致");
      get("digest").textContent = "元資料のSHA-256: " + report.sha256 + " / " + report.byteLength + " bytes";
      get("outcome").textContent = outcomeText(report.reportOutcome);
      setDifferenceFilters(get,true);get("difference-kind").disabled=false;get("difference-kind").value=checked.differenceCount?"receipt":"source";renderDifferencePage();
      get("results").hidden = false; get("source-save").disabled = false; get("save").disabled = false;
    } catch (error) { failed(error, own, text); }
    finally { if (hashAbort === control) hashAbort = null; if (!disposed && own === revision) get("status").setAttribute("aria-busy", "false"); }
  }
  listen("file", "change", async () => {
    if (disposed) return; const file = get("file").files?.[0]; if (!file) { notice.noSelection(); return; }
    const own=reset("証拠ファイルを読み込んでいます。"); if(disposed||own===null)return; get("file").value = ""; get("text").value = "";
    get("status").setAttribute("aria-busy", "true");
    const name = displayFileName(file, "証拠ファイル"); if (disposed || own !== revision) return;
    get("source").textContent = "確認する証拠ファイル: " + name;
    try {
      const text = await reader.readText(file, { maxBytes: REHEARSAL_REVIEW_EVIDENCE_LIMIT });
      if (!disposed && own === revision) await inspect(text, own);
    } catch (error) { failed(error, own); }
  });
  listen("paste", "click", () => {
    if (disposed) return; const text = get("text").value;
    const own=reset("貼り付けた証拠ファイルを確認しています。"); if(disposed||own===null)return; get("text").value = "";
    get("source").textContent = "確認する証拠: 貼り付けたJSON"; get("status").setAttribute("aria-busy", "true");
    void inspect(text, own);
  });
  listen("text", "input", () => { if (!disposed) reset("貼り付けた証拠ファイルを確認するボタンを押してください。"); });
  listen("clear", "click", () => { if (disposed) return; const own=reset("証拠ファイルの確認をクリアしました。"); if(disposed||own===null)return; get("file").value = ""; get("text").value = ""; });
  listen("difference-kind","change",()=>{if(disposed||!result)return;setDifferenceFilters(get,true,true);differenceOffset=0;renderDifferencePage();});
  for(const [name,event] of [["difference-search","input"],["difference-type","change"]])listen(name,event,()=>{if(disposed||!result)return;differenceOffset=0;renderDifferencePage();});
  listen("difference-filter-clear","click",()=>{if(disposed||!result)return;setDifferenceFilters(get,true,true);differenceOffset=0;renderDifferencePage();});
  listen("previous","click",()=>{if(disposed||!result)return;differenceOffset=Math.max(0,differenceOffset-40);renderDifferencePage();});
  listen("next","click",()=>{if(disposed||!result)return;differenceOffset+=40;renderDifferencePage();});
  listen("difference-save","click",()=>{
    const selected=selectedDifference,reviewed=result,owner=revision,view=differenceView;
    if(disposed||!reviewed||selected===null)return;
    const kind=get("difference-kind").value==="source"?"source":"receipt";
    const owns=()=>!disposed&&revision===owner&&differenceView===view&&result===reviewed&&selectedDifference===selected;
    try{
      requireSyncExport(download({document,prepared:{text:encodeRehearsalDifferenceValues(reviewed,selected,"evidence-"+kind),filename:"ThreeCore-evidence-"+kind+"-difference-"+(selected+1)+".json",mimeType:"application/json"}}));
      if(owns())get("export-status").textContent="証拠から選んだ相違の値を省略せずに保存し始めました。証拠ファイルも一緒に保管してください。";
    }catch{if(owns())get("export-status").textContent="相違の値を保存できませんでした。確認結果と証拠は保持しています。";}
  });
  for (const name of ["source-save", "save"]) listen(name, "click", () => {
    if (disposed || !result || sourceText === null) return; const own = revision;
    try {
      requireSyncExport(download({ document, prepared: name === "source-save"
        ? { text: sourceText, filename: "ThreeCore-evidence-source-report.json", mimeType: "application/json" }
        : { text: JSON.stringify(result, null, 2) + "\n", filename: "ThreeCore-evidence-verification.json", mimeType: "application/json" } }));
      if (disposed || own !== revision) return;
      get("export-status").textContent = name === "source-save" ? "証拠に含まれる元資料の保存を開始しました。元の文字列をそのまま取り出しています。"
        : "証拠の再確認結果を保存し始めました。検出した不一致も結果に含みます。";
    } catch { if (!disposed && own === revision) get("export-status").textContent = "保存を開始できませんでした。確認結果は保持しています。"; }
  });
  reset("まとめて保存した証拠を選ぶと、元資料と確認結果の控えを再計算で確かめます。");
  return Object.freeze({ dispose() { if (disposed) return; disposed = true; reset(""); get("file").value = ""; get("text").value = ""; notice.dispose(); for (const remove of listeners) remove(); } });
}
