import { createFileSelectionNotice } from "./file-read-panel.js";
import { createFileReadScope } from "../src/security-file.js";
import { describeFileReadError, displayFileName, decodeRehearsalForPanel } from "../src/file-read-status.js";
import { requireSyncExport } from "../src/export-policy.js";
import { createRehearsalScenarioSet, decodeRehearsalScenarioSet, encodeRehearsalScenarioSet,
  reportRehearsalScenarioSet, encodeRehearsalScenarioSetReport, REHEARSAL_SCENARIO_SET_LIMIT, REHEARSAL_SCENARIO_SET_CASES } from "../src/operation-rehearsal-scenario-set.js";
import { encodeRehearsalScenario, compareRehearsalScenario } from "../src/operation-rehearsal-scenario.js";
import { formatRehearsalUnits } from "../src/operation-rehearsal.js";
import { SCENARIO_LABELS, createRehearsalFieldFeedback } from "./operation-rehearsal-scenario-panel.js";
import { captureRehearsalCheckSuite, encodeRehearsalCheckSuite } from "../src/operation-rehearsal-check-suite.js";

export function mountRehearsalScenarioSetPanel(document, { download, getComparison, store=createRehearsalScenarioSet() }) {
  const offerDownload = payload => requireSyncExport(download(payload));
  const fileReader = createFileReadScope();
  const get=name=>document.getElementById("scenario-set-"+name);
  const feedback=createRehearsalFieldFeedback(document,"scenario-set-status");
  let viewRevision=0,visibleIds=new Set();
  let disposed=false, revision=0, pending=null, report=reportRehearsalScenarioSet(store.state().current), selectedId="";
  const listeners=[];
  function listen(name,event,fn){get(name).addEventListener(event,fn);listeners.push(()=>get(name).removeEventListener(event,fn));}
  const fileNotice = createFileSelectionNotice(get("file"), get("file-note"));
  listeners.push(() => fileNotice.dispose());
  function cancel(message="確認中の変更を取り消しました。確定したケースは保持しています。"){
    const own=++revision;pending=null;feedback.clear();fileNotice.clear();get("status").setAttribute("aria-busy", "false");
    get("apply").disabled=true;get("preview").textContent="";get("changes").textContent="";
    get("review").hidden=true;get("status").textContent=message;get("source").textContent="";
    fileReader.cancel();if(disposed||own!==revision)return null;
    store.cancel();return disposed||own!==revision?null:own;
  }
  function cells(target,values){const tr=document.createElement("tr");for(const value of values){const td=document.createElement("td");td.textContent=value;tr.append(td);}get(target).append(tr);return tr;}
  function context(item) {
    if(!item)return "なし";
    const changes=compareRehearsalScenario(item.before,item.after).parameters.filter(row=>row.changed).map(row=>{
      const value=v=>row.field==="paused"?(v?"停止":"停止なし"):row.field==="buybackBps"?String(Number(v)/100)+"%":formatRehearsalUnits(v,item.before.asset.decimals)+" "+item.before.asset.symbol;
      return SCENARIO_LABELS[row.field]+": "+value(row.before)+" → "+value(row.after);
    }).join(" / ");
    return item.label+" / "+item.before.agent+" / ネットワーク "+item.before.chainId+" / 口座 "+item.before.account+
      " / 資産 "+item.before.asset.symbol+" ("+item.before.asset.address+") / "+item.before.events.length+"件 / "+(changes||"条件変更なし");
  }
  function showReview(review,source="画面で指定した変更"){
    pending=review;get("apply").disabled=!review.changed;get("review").hidden=false;get("changes").textContent="";
    const ids=[...new Set([...review.before.cases,...review.after.cases].map(item=>item.id))];
    for(const id of ids){const before=review.before.cases.find(item=>item.id===id),after=review.after.cases.find(item=>item.id===id);
      if(JSON.stringify(before)!==JSON.stringify(after))cells("changes",[id,context(before),context(after)]);}
    get("preview").textContent="ケース数 "+review.before.cases.length+" → "+review.after.cases.length+"。"+
      (review.changed?"まだ反映していません。変更する対象を確認して確定してください。":"内容は同じです。変更は不要です。");
    get("source").textContent="確認元: "+source;get("status").textContent="変更内容を確認してください。元の試算履歴は変更しません。";
  }
  function fail(error,localEdit=false){
    const own=cancel((describeFileReadError(error,"1 MiB")??"ケースを確認できませんでした。IDの重複、名前、資料形式、最大12件・1 MiBの制限を確認してください。")+" 確定済みのケースは保持しています。");
    if(own===null||!localEdit||disposed)return;
    const code=error&&Object.getOwnPropertyDescriptor(error,"code")?.value;
    const messages={INVALID_SCENARIO_ID:["id","ケースID","先頭は英数字、全体は英数字・ハイフン・下線で1〜64文字にしてください。"],
      DUPLICATE_SCENARIO_ID:["id","ケースID","すでに使われています。別のIDにするか、既存ケースを置き換える操作を選んでください。"],
      SCENARIO_NOT_FOUND:["id","ケースID","保存済みのケースにありません。一覧から対象を選ぶか、保存済みのIDを入力してください。"],
      INVALID_SCENARIO_LABEL:["label","ケースの名前","1〜80文字で入力してください。空白だけの名前、改行や制御文字は使えません。"]};
    if(Object.hasOwn(messages,code)){const [field,label,message]=messages[code];feedback.field("scenario-set-"+field,label,message);}
  }
  function availability(){
    const count=store.state().current.cases.length,available=Boolean(getComparison());
    get("add").disabled=!available||count>=REHEARSAL_SCENARIO_SET_CASES;get("replace").disabled=!available;
    get("capacity").textContent=count<REHEARSAL_SCENARIO_SET_CASES?"ケース集にはあと"+(REHEARSAL_SCENARIO_SET_CASES-count)+"件追加できます。":
      "ケース集は上限の"+REHEARSAL_SCENARIO_SET_CASES+"件です。保存、名前変更、置き換え、削除は引き続き使えます。";
  }
  function selectCase(id){
    if(disposed||!visibleIds.has(id))return;
    if(cancel("ケースの詳細を表示しています。")===null)return;selectedId=id;get("select").value=id;detail();
    const entry=report.rows.find(row=>row.id===selectedId);if(entry){get("id").value=entry.id;get("label").value=entry.label;}
  }
  function detail(){
    get("metrics").textContent="";const entry=report.rows.find(item=>item.id===selectedId);
    get("case-save").disabled=!entry;get("case-baseline-save").disabled=!entry;
    if(!entry){get("detail").textContent="表示するケースがありません。";return;}
    get("detail").textContent=entry.id+" — "+entry.label+" / "+entry.agent+" / ネットワーク "+entry.chainId+" / 口座 "+entry.account+
      " / 資産 "+entry.asset.symbol+" ("+entry.asset.address+")。変更条件 "+entry.summary.changedParameters+"項目、結果が変わる記録 "+
      entry.summary.changedRecords+"件。保存時の入力に基づく比較です。";
    const money=value=>formatRehearsalUnits(value,entry.asset.decimals)+" "+entry.asset.symbol;
    for(const row of entry.metrics)cells("metrics",[SCENARIO_LABELS[row.field],money(row.before),money(row.after),(BigInt(row.delta)>0n?"+":"")+money(row.delta)]);
  }
  function render(){
    const ownView=++viewRevision;
    report=reportRehearsalScenarioSet(store.state().current);
    const agent=get("agent").value||"all",outcome=get("outcome").value||"all";
    const shown=report.rows.filter(row=>(agent==="all"||row.agent===agent)&&(outcome==="all"||
      (outcome==="changed"&&row.summary.changedRecords>0)||(outcome==="rejected"&&row.summary.newlyRejected>0)));
    visibleIds=new Set(shown.map(row=>row.id));
    get("rows").textContent="";get("select").textContent="";
    for(const row of shown){const tr=cells("rows",[row.id,row.label,row.agent,row.summary.changedParameters+"項目",row.summary.changedRecords+"件",row.summary.newlyRejected+"件"]);
      const td=document.createElement("td"),button=document.createElement("button");button.type="button";button.textContent="選択";
      button.setAttribute("aria-label",row.id+" — "+row.label+" を選択");
      button.addEventListener("click",()=>{if(disposed||ownView!==viewRevision)return;selectCase(row.id);get("select").focus?.();});td.append(button);tr.append(td);
      const option=document.createElement("option");option.value=row.id;option.textContent=row.id+" — "+row.label;get("select").append(option);}
    if(!shown.some(row=>row.id===selectedId))selectedId=shown[0]?.id??"";
    get("select").value=selectedId;get("select").disabled=!shown.length;
    get("count").textContent="表示 "+shown.length+"件 / 保存中 "+report.rows.length+"件（最大12件）。絞り込み中もケース集の保存は全件が対象です。";
    get("save").disabled=!report.rows.length;get("report-save").disabled=!report.rows.length;get("baseline-save").disabled=!report.rows.length;get("undo").disabled=!store.state().canUndo;
    get("export-status").textContent="";detail();availability();
  }
  function put(replace){
    if(disposed)return;const own=cancel();if(own===null)return;const comparison=getComparison();if(disposed||own!==revision)return;if(!comparison){get("status").textContent="先に上の条件比較を完了してください。";return;}
    if(!replace&&store.state().current.cases.length>=REHEARSAL_SCENARIO_SET_CASES){get("status").textContent="ケース集は12件で上限です。新しいケースを追加するには、保存済みのケースを確認して削除するか、既存ケースの置き換えを使ってください。";return;}
    try{const reviewed=store.previewPut({id:get("id").value,label:get("label").value,before:comparison.inputs.before,after:comparison.inputs.after},replace);if(!disposed&&own===revision)showReview(reviewed);}catch(error){if(!disposed&&own===revision)fail(error,true);}
  }
  listen("add","click",()=>put(false));listen("replace","click",()=>put(true));
  for(const action of ["rename","remove"])listen(action,"click",()=>{
    if(disposed)return;const own=cancel();if(own===null)return;try{const reviewed=action==="rename"?store.previewRename(get("id").value,get("label").value):store.previewRemove(get("id").value);if(!disposed&&own===revision)showReview(reviewed);}catch(error){if(!disposed&&own===revision)fail(error,true);}
  });
  listen("apply","click",()=>{if(disposed||!pending)return;const own=revision;try{store.commit(pending);if(disposed||own!==revision)return;const done=cancel("ケース集の変更を確定しました。元の試算履歴は保持しています。");if(done===null)return;render();if(!disposed&&done===revision)get("status").focus?.();}catch{if(!disposed&&own===revision)fail();}});
  listen("cancel","click",()=>{if(!disposed)cancel();});
  listen("undo","click",()=>{if(disposed)return;const own=revision;try{store.undo();if(disposed||own!==revision)return;if(cancel("ケース集の直前の変更を取り消しました。")===null)return;render();}catch{if(!disposed&&own===revision)fail();}});
  for(const name of ["id","label"])listen(name,"input",()=>{if(!disposed)cancel("指定が変わりました。変更前にもう一度確認してください。");});
  for(const name of ["agent","outcome"])listen(name,"change",()=>{if(!disposed)render();});
  listen("select","change",()=>{
    selectCase(get("select").value);
  });
  listen("file","change",async()=>{
    if(disposed)return;const file=get("file").files?.[0];if(!file){fileNotice.noSelection();return;}
    const own=cancel("ケース集のファイルを確認しています（最大30秒）。");if(own===null)return;get("status").setAttribute("aria-busy", "true");get("file").value="";get("text").value="";
    try{
      const text = await fileReader.readText(file, { maxBytes: REHEARSAL_SCENARIO_SET_LIMIT });if(disposed||own!==revision)return;
      const data=decodeRehearsalForPanel(text, "cases", decodeRehearsalScenarioSet);
      const name = displayFileName(file, "ケース集ファイル");
      if (disposed || own !== revision) return;
      showReview(store.previewImport(data),name);
    }catch(error){if(!disposed&&own===revision)fail(error);}finally{if(!disposed&&own===revision)get("status").setAttribute("aria-busy","false");}
  });
  listen("text","input",()=>{if(!disposed)cancel("貼り付けたケース集を確認してください。");});
  listen("paste","click",()=>{if(disposed)return;const text=get("text").value;get("text").value="";const own=cancel();if(own===null)return;try{const reviewed=store.previewImport(decodeRehearsalForPanel(text,"cases",decodeRehearsalScenarioSet));if(!disposed&&own===revision)showReview(reviewed,"貼り付けたケース集");}catch(error){if(!disposed&&own===revision)fail(error);}});
  for(const [name,reportOnly]of[["save",false],["report-save",true]])listen(name,"click",()=>{
    if(disposed||!store.state().current.cases.length)return;
    const own=revision; try{offerDownload({document,prepared:{text:reportOnly?encodeRehearsalScenarioSetReport(store.state().current):encodeRehearsalScenarioSet(store.state().current),
      filename:reportOnly?"ThreeCore-scenario-set-report.json":"ThreeCore-scenario-set.json",mimeType:"application/json"}});if(disposed||own!==revision)return;
      get("export-status").textContent=reportOnly?"全ケースを再計算した集計資料の保存を開始しました。":"全ケースの入力記録の保存を開始しました。";
    }catch{if(disposed||own!==revision)return;get("export-status").textContent="ケース集を保存できませんでした。画面のケースは保持しています。";}
  });
  listen("case-save","click",()=>{
    if(disposed)return;const item=store.state().current.cases.find(row=>row.id===selectedId);if(!item)return;
    const own=revision; try{offerDownload({document,prepared:{text:encodeRehearsalScenario(item.before,item.after),filename:"ThreeCore-case-"+item.id+"-comparison.json",mimeType:"application/json"}});if(disposed||own!==revision)return;get("export-status").textContent="選択したケースの比較資料を保存し始めました。";}catch{if(disposed||own!==revision)return;get("export-status").textContent="比較資料を保存できませんでした。";}
  });
  for(const [name,selectedOnly]of[["baseline-save",false],["case-baseline-save",true]])listen(name,"click",()=>{
    if(disposed)return;const current=store.state().current;
    const chosen=current.cases.find(row=>row.id===selectedId);
    if(!current.cases.length||(selectedOnly&&!chosen))return;
    const input=selectedOnly?{...current,cases:[chosen]}:current;
    const own=revision; try{offerDownload({document,prepared:{text:encodeRehearsalCheckSuite(captureRehearsalCheckSuite(input)),
      filename:selectedOnly?"ThreeCore-case-"+chosen.id+"-expected-outcomes.json":"ThreeCore-expected-outcomes.json",mimeType:"application/json"}});if(disposed||own!==revision)return;
      get("export-status").textContent=(selectedOnly?"選択したケース "+chosen.id:"全ケース")+"の現在の計算結果を、今後の比較に使う期待結果として保存し始めました。";
    }catch(error){if(disposed||own!==revision)return;get("export-status").textContent=error?.code==="FILE_TOO_LARGE"
      ?"期待結果が保存上限の1 MiBを超えました。ケースを削除せず、「選択したケースの期待結果を保存」で1件ずつ保存できます。画面のケースは保持しています。"
      :"期待結果の保存を開始できませんでした。もう一度保存してください。画面のケースは保持しています。";}
  });
  function sourceChanged(){if(disposed||cancel("上の比較が変わりました。保存中のケースは保持しています。")===null)return;availability();}
  render();sourceChanged();
  return Object.freeze({sourceChanged,refresh(){if(disposed)return;const own=cancel("保存済みのケース集を表示しています。");if(own===null)return;selectedId="";render();if(disposed||own!==revision)return;
    const chosen=report.rows.find(row=>row.id===selectedId);get("id").value=chosen?.id??"";get("label").value=chosen?.label??"";sourceChanged();},dispose(){if(disposed)return;disposed=true;cancel("");store.dispose();report=null;selectedId="";
    for(const name of ["rows","select","metrics","detail","count","capacity","export-status","source"])get(name).textContent="";
    for(const name of ["add","replace","apply","save","report-save","case-save","baseline-save","case-baseline-save","undo"])get(name).disabled=true;
    for(const name of ["id","label","text","file"])get(name).value="";for(const remove of listeners)remove();}});
}
