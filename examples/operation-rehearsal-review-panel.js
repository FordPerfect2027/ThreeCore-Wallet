import { createRehearsalFieldFeedback } from "./operation-rehearsal-scenario-panel.js";
import { createFileSelectionNotice } from "./file-read-panel.js";
import { createFileReadScope } from "../src/security-file.js";
import { describeFileReadError, displayFileName, describeRehearsalFileTarget } from "../src/file-read-status.js";
import { requireSyncExport } from "../src/export-policy.js";
import { reviewRehearsalReport, encodeRehearsalReviewReceipt, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
import { REHEARSAL_OVERVIEW_SCHEMA } from "../src/operation-rehearsal-overview.js";
import { REHEARSAL_RECORD_REPORT_SCHEMA } from "../src/operation-rehearsal-records.js";

const reportNames = {
  "threecore.operation-rehearsal-overview.v1": "確認一覧",
  "threecore.operation-rehearsal-comparison.v1": "復旧比較",
  "threecore.operation-rehearsal-scenario.v1": "条件比較",
  "threecore.operation-rehearsal-scenario-set-report.v1": "ケース集の集計",
  "threecore.operation-rehearsal-check-report.v1": "期待結果の確認資料",
  "threecore.operation-rehearsal-record-query.v1": "記録の検索資料"
};
function outcomeText(outcome) {
  if (!outcome) return "";
  if (outcome.kind === "expected-outcomes") return "含まれる期待結果: " + outcome.cases + "ケース中、一致 " +
    outcome.matched + "件、差あり " + outcome.differing + "件。期待値の作成方法: " +
    (outcome.expectationOrigin === "recorded-calculation" ? "計算結果から記録した基準" : "手動で指定した期待値") +
    "。資料の再計算の一致と、期待値への一致は別に確認してください。";
  const kinds = { all: "すべて", open: "運用開始", settle: "決済", deposit: "入金", withdraw: "出金", reserve: "還元予約", release: "予約解除" };
  const decisions = { all: "すべて", accepted: "条件内", rejected: "条件外" };
  return "検索対象の全記録 " + outcome.totalRecords + "件 / 条件に一致 " + outcome.matchedRecords +
    "件。対象: " + (outcome.query.agent === "all" ? "すべて" : outcome.query.agent) + " / 種類: " +
    kinds[outcome.query.kind] + " / 判定: " + decisions[outcome.query.decision] + " / 検索語: " +
    (outcome.query.search || "指定なし") + "。件数は資料に含まれる試算記録の範囲です。";
}

export function mountRehearsalReviewPanel(document, { download, subtle = globalThis.crypto?.subtle }) {
  const offerDownload = payload => requireSyncExport(download(payload));
  const fileReader = createFileReadScope();
  const get = name => document.getElementById("report-review-" + name);
  const feedback=createRehearsalFieldFeedback(document,"report-review-status");
  let revision = 0, disposed = false, sourceText = null, receipt = null;
  let hashAbort = null;
  const listeners = [];
  function listen(name, event, fn) { get(name).addEventListener(event, fn); listeners.push(()=>get(name).removeEventListener(event, fn)); }
  const fileNotice = createFileSelectionNotice(get("file"), get("file-note"));
  listeners.push(() => fileNotice.dispose());
  function invalidate(message) {
    feedback.clear();
    fileNotice.clear();
    revision++; receipt = null;
    const previous = hashAbort; hashAbort = null; previous?.abort();
    fileReader.cancel();
    for(const name of ["scope", "differences", "digest", "summary", "outcome", "export-status"]) get(name).textContent = "";
    for(const name of ["save","source-save","checksum-save"])get(name).disabled=true; get("results").hidden = true;
    get("status").textContent = message; get("status").className = "";
    get("status").setAttribute("aria-busy", "false");
  }
  function reset(message = "保存した確認一覧・復旧比較・条件比較・ケース集の集計・期待結果の確認・記録の検索資料を選んでください。現在の履歴には反映しません。") {
    sourceText = null; invalidate(message); get("run").disabled = true;
    get("source").textContent = ""; get("file").value = ""; get("text").value = "";
  }
  function row(target, values) {
    const tr = document.createElement("tr");
    for(const value of values) {const td=document.createElement("td");td.textContent=value;tr.append(td);}
    get(target).append(tr);
  }
  async function run() {
    if(disposed || sourceText === null) return;
    invalidate("資料を再計算しています。現在の履歴は保持しています。");
    const own = revision, text = sourceText, expectedSha256 = get("expected").value.trim() || null;
    const ownHash = new AbortController(); hashAbort = ownHash;
    get("status").setAttribute("aria-busy", "true");
    try {
      const result = await reviewRehearsalReport(text, { expectedSha256, subtle, signal: ownHash.signal });
      if(disposed || own !== revision) return;
      receipt = result; get("results").hidden = false; for(const name of ["save","source-save","checksum-save"])get(name).disabled=false;
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
        (result.differencesTruncated ? "。差分は先頭40箇所を表示しています。" : "");
      get("outcome").textContent = outcomeText(result.reportOutcome);
      for(const scope of result.scope) row("scope", [scope.agent + (scope.caseId ? " / " + scope.caseId : ""), scope.beforeRecords === null ? "未作成" : scope.beforeRecords + "件",
        [REHEARSAL_OVERVIEW_SCHEMA, REHEARSAL_RECORD_REPORT_SCHEMA].includes(result.inputSchema) ? "比較なし" : scope.afterRecords === null ? "未作成" : scope.afterRecords + "件"]);
      const labels = {missing:"項目が不足",unexpected:"余分な項目",type:"値の種類が異なる",value:"値が異なる","array-length":"件数が異なる"};
      for(const diff of result.differences) row("differences",[diff.path,labels[diff.kind]]);
    } catch(error) {
      if(disposed || own !== revision) return;
      const reason = describeRehearsalFileTarget(text, "report") ?? {INVALID_EXPECTED_CHECKSUM:"照合値はSHA-256の64桁で入力してください。使える文字は0〜9とa〜fです。",
        UNSUPPORTED_REVIEW_REPORT:"この形式には対応していません。確認一覧・復旧比較・条件比較・ケース集の集計・期待結果の確認・記録の検索資料を選んでください。",
        REVIEW_HASH_UNAVAILABLE:"照合値を計算できませんでした。もう一度確認してください。",
        SCENARIO_CONTEXT_OR_EVENTS_CHANGED:"比較資料の口座・資産・元の記録が一致しないため、同じ履歴として比較できません。"}[error?.code]
        ?? "資料の形式や含まれる入力記録を確認できませんでした。2 MiB以内の保存済み資料を選んでください。";
      invalidate(reason + " 現在の履歴は保持しています。");
      if(!disposed&&Object.getOwnPropertyDescriptor(error,"code")?.value==="INVALID_EXPECTED_CHECKSUM")
        feedback.field("report-review-expected","照合するSHA-256","64桁で入力してください。使える文字は0〜9とa〜fです。照合値がない場合は空欄にできます。");
    } finally {
      if(hashAbort === ownHash) hashAbort = null;
      if(!disposed && own === revision) get("status").setAttribute("aria-busy", "false");
    }
  }
  listen("file", "change", async()=>{
    if(disposed) return;
    const file=get("file").files?.[0]; if(!file) { fileNotice.noSelection(); return; }
    reset("選択した資料を読み込んでいます。"); const own=revision;
    get("status").setAttribute("aria-busy", "true");
    const name = displayFileName(file, "選択した資料");
    if (disposed || own !== revision) return;
    get("source").textContent="確認するファイル: "+(name||"選択した資料");
    try {
      const text = await fileReader.readText(file, { maxBytes: REHEARSAL_REPORT_REVIEW_LIMIT }); if(disposed||own!==revision) return;
      sourceText=text; get("run").disabled=false;
      await run();
    } catch(error) { if(!disposed&&own===revision) reset((describeFileReadError(error,"2 MiB")??"ファイルを読み込めませんでした。2 MiB以内のUTF-8の資料を選んでください。")+" 現在の履歴は保持しています。"); }
  });
  listen("paste", "click", async()=>{
    if(disposed) return;
    const text=get("text").value;
    reset("貼り付けた資料を確認しています。"); sourceText=text;
    get("source").textContent="確認する資料: 貼り付けた文字列（元ファイルのバイト列とは異なる場合があります）";
    get("run").disabled=false; await run();
  });
  listen("expected", "input", ()=>{ if(!disposed) invalidate("照合値が変わりました。「選択済みの資料を再確認」を押してください。"); });
  listen("text", "input", ()=>{
    if(disposed) return; sourceText=null; invalidate("貼り付けた内容を確認するボタンを押してください。");
    get("run").disabled=true; get("source").textContent="";
  });
  listen("run", "click", run);
  listen("clear", "click", ()=>{if(!disposed) reset();});
  listen("save", "click", ()=>{
    if(disposed||!receipt) return;
    const own=revision; try {
      offerDownload({document,prepared:{text:encodeRehearsalReviewReceipt(receipt),filename:"ThreeCore-report-review-receipt.json",mimeType:"application/json"}});if(disposed||own!==revision)return;
      get("export-status").textContent="確認結果と照合値の控えを保存し始めました。元の資料はこの控えに含まれません。";
    } catch {if(disposed||own!==revision)return; get("export-status").textContent="控えを保存できませんでした。確認結果は保持しています。"; }
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
  reset();
  return Object.freeze({dispose(){if(disposed)return;reset("");disposed=true;get("expected").value="";for(const remove of listeners)remove();}});
}
