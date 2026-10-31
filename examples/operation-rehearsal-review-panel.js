import { createRehearsalFieldFeedback } from "./operation-rehearsal-scenario-panel.js";
import { createFileSelectionNotice } from "./file-read-panel.js";
import { createFileReadScope } from "../src/security-file.js";
import { describeFileReadError, displayFileName, describeRehearsalFileTarget } from "../src/file-read-status.js";
import { requireSyncExport } from "../src/export-policy.js";
import { encodeRehearsalDifferenceQuery, encodeRehearsalDifferenceValues, inspectReviewedRehearsalDifference, inspectRehearsalEvidenceReceiptDifference, reviewRehearsalReport, encodeRehearsalReviewReceipt, encodeRehearsalReviewEvidence, queryReviewedRehearsalDifferences, queryRehearsalEvidenceReceiptDifferences, reviewRehearsalEvidence, decodeRehearsalReviewEvidence, REHEARSAL_REVIEW_EVIDENCE_LIMIT, decodeRehearsalChecksumText, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
import { REHEARSAL_OVERVIEW_SCHEMA } from "../src/operation-rehearsal-overview.js";
import { REHEARSAL_RECORD_REPORT_SCHEMA, REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA } from "../src/operation-rehearsal-records.js";

const reportNames = {
  "threecore.operation-rehearsal-overview.v1": "確認一覧",
  "threecore.operation-rehearsal-comparison.v1": "復旧比較",
  "threecore.operation-rehearsal-scenario.v1": "条件比較",
  "threecore.operation-rehearsal-scenario-set-report.v1": "ケース集の集計",
  "threecore.operation-rehearsal-check-report.v1": "期待結果の確認資料",
  "threecore.operation-rehearsal-record-query.v1": "記録の検索資料",
  "threecore.operation-rehearsal-record-query.v2": "検索する情報を指定した記録資料"
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
  if (outcome.kind === "expected-outcomes") return "含まれる期待結果: " + outcome.cases + "ケース中、一致 " +
    outcome.matched + "件、差あり " + outcome.differing + "件。期待値の作成方法: " +
    (outcome.expectationOrigin === "recorded-calculation" ? "計算結果から記録した基準" : "手動で指定した期待値") +
    "。資料の再計算の一致と、期待値への一致は別に確認してください。";
  const kinds = { all: "すべて", open: "運用開始", settle: "決済", deposit: "入金", withdraw: "出金", reserve: "還元予約", release: "予約解除" };
  const decisions = { all: "すべて", accepted: "条件内", rejected: "条件外" };
  return "検索対象の全記録 " + outcome.totalRecords + "件 / 条件に一致 " + outcome.matchedRecords +
    "件。対象: " + (outcome.query.agent === "all" ? "すべて" : outcome.query.agent) + " / 種類: " +
    kinds[outcome.query.kind] + " / 判定: " + decisions[outcome.query.decision] + " / 検索語: " +
    (outcome.query.search || "指定なし") + "。"+(outcome.query.searchScope?"検索場所: "+(outcome.query.searchScope==="recorded"?"記録に書かれた情報":"保存元と記録の両方")+"。":"")+"件数は資料に含まれる試算記録の範囲です。";
}

export function mountRehearsalReviewPanel(document, { download, subtle = globalThis.crypto?.subtle }) {
  const offerDownload = payload => requireSyncExport(download(payload));
  const fileReader = createFileReadScope(), checksumReader=createFileReadScope();
  let checksumRevision=0,differenceOffset=0,differenceView=0,selectedDifference=null;
  const get = name => document.getElementById("report-review-" + name);
  const feedback=createRehearsalFieldFeedback(document,"report-review-status");
  let revision = 0, disposed = false, sourceText = null, receipt = null;
  let hashAbort = null;
  const listeners = [];
  function listen(name, event, fn) { get(name).addEventListener(event, fn); listeners.push(()=>get(name).removeEventListener(event, fn)); }
  mountDifferenceQuerySave(document,get,listen,()=>({review:receipt,target:"report",revision,view:differenceView,disposed}),download);
  const fileNotice = createFileSelectionNotice(get("file"), get("file-note"));
  listeners.push(() => fileNotice.dispose());
  const checksumNotice=createFileSelectionNotice(get("checksum-file"),get("checksum-file-note"));
  listeners.push(()=>checksumNotice.dispose());
  function invalidate(message) {
    const own=++revision;checksumRevision++;differenceView++;setDifferenceFilters(get,false,true);selectedDifference=null;get("difference-save").disabled=true;get("difference-detail").hidden=true;get("difference-detail").textContent="";
    const previous=hashAbort;hashAbort=null;receipt=null;differenceOffset=0;
    feedback.clear();checksumNotice.clear();get("checksum-file").value="";
    get("checksum-file-status").textContent="";get("checksum-file-status").setAttribute("aria-busy","false");
    fileNotice.clear();get("previous").disabled=true;get("next").disabled=true;get("difference-status").textContent="";
    for(const name of ["scope", "differences", "digest", "summary", "outcome", "export-status"])get(name).textContent="";
    for(const name of ["save","source-save","checksum-save","evidence-save"])get(name).disabled=true;
    get("results").hidden=true;get("status").textContent=message;get("status").className="";get("status").setAttribute("aria-busy","false");
    previous?.abort();if(own!==revision)return null;
    checksumReader.cancel();if(own!==revision)return null;
    fileReader.cancel();return disposed||own!==revision?null:own;
  }
  function reset(message = "保存した確認一覧・復旧比較・条件比較・ケース集の集計・期待結果の確認・記録の検索資料を選んでください。現在の履歴には反映しません。") {
    sourceText = null; get("run").disabled = true;
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
    const ownHash = new AbortController(); hashAbort = ownHash;
    get("status").setAttribute("aria-busy", "true");
    try {
      const result = await reviewRehearsalReport(text, { expectedSha256, subtle, signal: ownHash.signal });
      if(disposed || own !== revision) return;
      receipt = result;setDifferenceFilters(get,true); get("results").hidden = false; for(const name of ["save","source-save","checksum-save","evidence-save"])get(name).disabled=false;
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
        [REHEARSAL_OVERVIEW_SCHEMA, REHEARSAL_RECORD_REPORT_SCHEMA, REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA].includes(result.inputSchema) ? "比較なし" : scope.afterRecords === null ? "未作成" : scope.afterRecords + "件"]);
      renderDifferencePage();
    } catch(error) {
      if(disposed || own !== revision) return;
      const reason = describeRehearsalFileTarget(text, "report") ?? {INVALID_EXPECTED_CHECKSUM:"照合値はSHA-256の64桁で入力してください。使える文字は0〜9とa〜fです。",
        UNSUPPORTED_REVIEW_REPORT:"この形式には対応していません。確認一覧・復旧比較・条件比較・ケース集の集計・期待結果の確認・記録の検索資料を選んでください。",
        REVIEW_HASH_UNAVAILABLE:"照合値を計算できませんでした。もう一度確認してください。",
        SCENARIO_CONTEXT_OR_EVENTS_CHANGED:"比較資料の口座・資産・元の記録が一致しないため、同じ履歴として比較できません。"}[error?.code]
        ?? "資料の形式や含まれる入力記録を確認できませんでした。2 MiB以内の保存済み資料を選んでください。";
      const retired=invalidate(reason + " 現在の履歴は保持しています。");
      if(retired!==null&&!disposed&&Object.getOwnPropertyDescriptor(error,"code")?.value==="INVALID_EXPECTED_CHECKSUM")
        feedback.field("report-review-expected","照合するSHA-256","64桁で入力してください。使える文字は0〜9とa〜fです。照合値がない場合は空欄にできます。");
    } finally {
      if(hashAbort === ownHash) hashAbort = null;
      if(!disposed && own === revision) get("status").setAttribute("aria-busy", "false");
    }
  }
  listen("file", "change", async()=>{
    if(disposed) return;
    const file=get("file").files?.[0]; if(!file) { fileNotice.noSelection(); return; }
    const own=reset("選択した資料を読み込んでいます。");if(own===null)return;
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
  return Object.freeze({dispose(){if(disposed)return;disposed=true;evidencePanel.dispose();reset("");get("expected").value="";for(const remove of listeners)remove();}});
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
