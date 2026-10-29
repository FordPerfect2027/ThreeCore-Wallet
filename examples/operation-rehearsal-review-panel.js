import { reviewRehearsalReport, encodeRehearsalReviewReceipt, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
import { REHEARSAL_OVERVIEW_SCHEMA } from "../src/operation-rehearsal-overview.js";

export function mountRehearsalReviewPanel(document, { download, subtle = globalThis.crypto?.subtle }) {
  const get = name => document.getElementById("report-review-" + name);
  let revision = 0, disposed = false, sourceText = null, receipt = null;
  const listeners = [];
  function listen(name, event, fn) { get(name).addEventListener(event, fn); listeners.push(()=>get(name).removeEventListener(event, fn)); }
  function invalidate(message) {
    revision++; receipt = null;
    for(const name of ["scope", "differences", "digest", "summary", "export-status"]) get(name).textContent = "";
    get("save").disabled = true; get("results").hidden = true;
    get("status").textContent = message; get("status").className = "";
    get("status").setAttribute("aria-busy", "false");
  }
  function reset(message = "保存した確認一覧・復旧比較・条件比較・ケース集の集計資料を選んでください。現在の履歴には反映しません。") {
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
    get("status").setAttribute("aria-busy", "true");
    try {
      const result = await reviewRehearsalReport(text, { expectedSha256, subtle });
      if(disposed || own !== revision) return;
      receipt = result; get("results").hidden = false; get("save").disabled = false;
      const matches = result.matchesRecomputation && result.checksumMatches !== false;
      get("status").className = matches ? "passed" : "blocked";
      get("status").textContent = !result.matchesRecomputation ? "資料の計算結果に不一致があります。下の項目を確認してください。"
        : result.checksumMatches === false ? "再計算は一致しましたが、指定された照合値と一致しません。別の資料の可能性があります。"
        : "資料の計算結果は再計算と一致しました。入力の出所や実際の残高を証明するものではありません。";
      get("digest").textContent = "確認した文字列のSHA-256: " + result.sha256 + " / " + result.byteLength + " bytes";
      get("summary").textContent = "形式: " + result.inputSchema + " / 不一致箇所 " + result.differenceCount + "件 / 照合値: " +
        (result.checksumMatches === null ? "指定なし" : result.checksumMatches ? "一致" : "不一致") +
        (result.differencesTruncated ? "。差分は先頭40箇所を表示しています。" : "");
      for(const scope of result.scope) row("scope", [scope.agent + (scope.caseId ? " / " + scope.caseId : ""), scope.beforeRecords === null ? "未作成" : scope.beforeRecords + "件",
        result.inputSchema === REHEARSAL_OVERVIEW_SCHEMA ? "比較なし" : scope.afterRecords === null ? "未作成" : scope.afterRecords + "件"]);
      const labels = {missing:"項目が不足",unexpected:"余分な項目",type:"値の種類が異なる",value:"値が異なる","array-length":"件数が異なる"};
      for(const diff of result.differences) row("differences",[diff.path,labels[diff.kind]]);
    } catch(error) {
      if(disposed || own !== revision) return;
      const reason = {INVALID_EXPECTED_CHECKSUM:"照合値はSHA-256の64桁の英数字で入力してください。",
        UNSUPPORTED_REVIEW_REPORT:"この形式は確認一覧・復旧比較・条件比較・ケース集の集計資料ではありません。",
        REVIEW_HASH_UNAVAILABLE:"照合値を計算できませんでした。もう一度確認してください。",
        SCENARIO_CONTEXT_OR_EVENTS_CHANGED:"比較資料の口座・資産・元の記録が一致しないため、同じ履歴として比較できません。"}[error?.code]
        ?? "資料の形式や含まれる入力記録を確認できませんでした。2 MiB以内の保存済み資料を選んでください。";
      invalidate(reason + " 現在の履歴は保持しています。");
    } finally { if(!disposed && own === revision) get("status").setAttribute("aria-busy", "false"); }
  }
  listen("file", "change", async()=>{
    if(disposed) return;
    const file=get("file").files?.[0]; if(!file) return;
    reset("選択した資料を読み込んでいます。"); const own=revision;
    get("status").setAttribute("aria-busy", "true");
    const name=typeof file.name==="string"?file.name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,"").slice(0,160):"選択した資料";
    get("source").textContent="確認するファイル: "+(name||"選択した資料");
    try {
      if(!Number.isSafeInteger(file.size)||file.size<1||file.size>REHEARSAL_REPORT_REVIEW_LIMIT) throw new Error("Size");
      const buffer=await file.arrayBuffer(); if(disposed||own!==revision) return;
      if(buffer.byteLength!==file.size||buffer.byteLength>REHEARSAL_REPORT_REVIEW_LIMIT) throw new Error("Size changed");
      sourceText=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(buffer); get("run").disabled=false;
      await run();
    } catch { if(!disposed&&own===revision) reset("ファイルを読み込めませんでした。2 MiB以内のUTF-8の資料を選んでください。現在の履歴は保持しています。"); }
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
    try {
      download({document,prepared:{text:encodeRehearsalReviewReceipt(receipt),filename:"ThreeCore-report-review-receipt.json",mimeType:"application/json"}});
      get("export-status").textContent="確認結果と照合値の控えを保存し始めました。元の資料はこの控えに含まれません。";
    } catch { get("export-status").textContent="控えを保存できませんでした。確認結果は保持しています。"; }
  });
  reset();
  return Object.freeze({dispose(){if(disposed)return;reset("");disposed=true;get("expected").value="";for(const remove of listeners)remove();}});
}
