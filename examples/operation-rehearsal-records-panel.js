import { requireSyncExport } from "../src/export-policy.js";
import {summarizeRehearsalRecords,encodeRehearsalRecordSummary,rehearsalRecordSummaryCsv,encodeRehearsalRecordPrefix,extractRehearsalRecordPrefix} from "../src/operation-rehearsal-records.js";
import { REHEARSAL_RECORD_REASON_LABELS,queryRehearsalReasonRecords,encodeRehearsalReasonRecordReport,rehearsalReasonRecordCsv,reportRehearsalReference,encodeRehearsalReferenceReport,rehearsalReferenceCsv,indexRehearsalRecords,queryRehearsalRecords,relatedRehearsalRecords,encodeRehearsalRecordReport,rehearsalRecordCsv,queryRehearsalContextRecords,encodeRehearsalContextRecordReport,rehearsalContextRecordCsv,REHEARSAL_RECORD_QUERY } from "../src/operation-rehearsal-records.js";
import { formatRehearsalUnits } from "../src/operation-rehearsal.js";
import { SCENARIO_LABELS } from "./operation-rehearsal-scenario-panel.js";
export function mountRehearsalRecordsPanel(document,{download,reasons,kinds}){
  const offerDownload = payload => requireSyncExport(download(payload));
  const get=name=>document.getElementById("record-browser-"+name);let index=null,report=null,selected="",offset=0,disposed=false,revision=0,detailRevision=0,backView=null;const listeners=[];
  function listen(name,event,fn){get(name).addEventListener(event,fn);listeners.push(()=>get(name).removeEventListener(event,fn));}
  get("reason").textContent="";
  for(const [value,label]of [["all","すべて"],...Object.entries(REHEARSAL_RECORD_REASON_LABELS)]){const option=document.createElement("option");option.value=value;option.textContent=label;get("reason").append(option);}
  get("reason").value="all";
  function queryInput(){const query=Object.fromEntries(Object.keys(REHEARSAL_RECORD_QUERY).map(key=>[key,get(key).value||REHEARSAL_RECORD_QUERY[key]]));
    const scope=get("search-scope").value||"stored",reason=get("reason").value||"all";return reason!=="all"?{...query,searchScope:scope,reason}:scope==="stored"?query:{...query,searchScope:scope};}
  const queryRows=(input)=>Object.hasOwn(input,"reason")?queryRehearsalReasonRecords(index,input):Object.hasOwn(input,"searchScope")?queryRehearsalContextRecords(index,input):queryRehearsalRecords(index,input);
  const encode=(csv=false)=>Object.hasOwn(report.query,"reason")?(csv?rehearsalReasonRecordCsv:encodeRehearsalReasonRecordReport)(index.inputs,report.query):Object.hasOwn(report.query,"searchScope")?(csv?rehearsalContextRecordCsv:encodeRehearsalContextRecordReport)(index.inputs,report.query):(csv?rehearsalRecordCsv:encodeRehearsalRecordReport)(index.inputs,report.query);
  function row(target,values){const tr=document.createElement("tr");for(const value of values){const td=document.createElement("td");td.textContent=value;tr.append(td);}get(target).append(tr);return tr;}
  const decision=item=>item.result.withinEnteredLimits?"仮の条件内":"見送り: "+item.result.reasons.map(code=>reasons[code]??code).join("・");
  const eventLabels={id:"記録ID",kind:"種類",agent:"記録上の対象",chainId:"記録上のネットワーク",account:"記録上の口座",operationId:"操作ID",reservationId:"予約ID",origin:"記録上のサイト",spender:"記録上の利用先契約",principal:"元本",fee:"費用",grossReturn:"元本を含む戻り額",amount:"金額",exitFeeReserve:"確保する決済費用"};
  const moneyFields=new Set(["principal","fee","grossReturn","amount","exitFeeReserve"]);
  const summaryQuery=()=>({...report.query,searchScope:report.query.searchScope??"stored",reason:report.query.reason??"all"});
  function renderSummary(){
    const summary=summarizeRehearsalRecords(index,summaryQuery()),lines=[];
    for(const item of summary.rows){
      if(!item.present){lines.push(item.agent+": 未作成（金額不明）");continue;}
      const money=value=>formatRehearsalUnits(value,item.context.asset.decimals)+" "+item.context.asset.symbol;
      lines.push(item.agent+": 一致 "+item.matchedRecords+"件 / 条件内 "+item.acceptedRecords+"件 / 見送り "+item.rejectedRecords+"件",
        "種類別: "+Object.entries(item.kindCounts).map(([kind,count])=>(kinds[kind]??kind)+" "+count+"件").join(" / "),
        "一致記録による増減: "+Object.entries(item.balanceChanges).map(([field,value])=>(SCENARIO_LABELS[field]??field)+" "+money(value)).join(" / "),
        "条件内の記録の費用合計: "+money(item.acceptedFeeUnits),
        "見送り理由別: "+(item.reasonCounts.length?item.reasonCounts.map(row=>(reasons[row.reason]??row.reason)+" "+row.records+"件").join(" / "):"なし"));
    }
    get("summary").textContent=lines.join("\n");get("summary-save").disabled=false;get("summary-csv-save").disabled=false;
  }
  function referenceDetail(item) {
    get("reference-summary").textContent="";get("reference-summary").hidden=true;get("reference-save").disabled=true;get("reference-csv-save").disabled=true;
    if(!item?.reference)return;
    const report=reportRehearsalReference(index,item.key),summary=report.summary,operation=report.reference.kind==="operation";
    const money=value=>value===null?"記録なし":formatRehearsalUnits(value,item.asset.decimals)+" "+item.asset.symbol;
    const phase=summary.phase==="not-started"?"条件内の開始記録なし":operation?(summary.phase==="open"?"未決済":"決済済み（試算）"):(summary.phase==="open"?"予約中":"予約取消済み（試算）");
    const lines=[(operation?"操作":"予約")+"ID: "+report.reference.id+" / "+phase,
      "開始の記録: "+(summary.openingRecordId??"なし")+" / "+(operation?"決済":"取消")+"の記録: "+(summary.closingRecordId??"なし"),
      "関連する全"+report.recordCount+"件: 条件内 "+summary.acceptedRecords+"件 / 見送り "+summary.rejectedRecords+"件"];
    if(operation)lines.push("元本: "+money(summary.principalUnits)+" / 未決済元本: "+money(summary.pendingPrincipalUnits),
      "元本を含む戻り額: "+money(summary.grossReturnUnits),"開始費用: "+money(summary.entryFeeUnits)+" / 決済費用: "+money(summary.exitFeeUnits)+" / 費用合計: "+money(summary.totalFeeUnits),
      "この操作の累計実現損益: "+money(summary.realizedPnlUnits)+"。未決済の評価損益は含みません。");
    else lines.push("予約した額: "+money(summary.reservedAmountUnits)+" / 取り消した額: "+money(summary.releasedAmountUnits)+" / 予約中: "+money(summary.pendingReservedAmountUnits),"予約と取消の記録です。送金や買戻しを実行した記録ではありません。");
    lines.push("同じ保存元・同じIDの全記録から再計算しています。現在の検索条件や選択した記録の時点で切り取った結果ではありません。見送られた試行を金額に計上しません。");
    get("reference-summary").textContent=lines.join("\n");get("reference-summary").hidden=false;get("reference-save").disabled=false;get("reference-csv-save").disabled=false;
  }
  function detail(){const detailOwn=++detailRevision;for(const name of["detail","event","balances","related","related-status"])get(name).textContent="";
    const item=report?.rows.find(row=>row.key===selected);referenceDetail(item);
    get("prefix-save").disabled=!item;get("prefix-report-save").disabled=!item;get("prefix-note").textContent="";if(!item)return;
    const fullCount=index.subjects.find(subject=>subject.agent===item.agent).recordCount;
    get("prefix-note").textContent=item.agent+" の全"+fullCount+"件中、先頭からこの記録を含む"+item.recordNumber+"件を切り出します。後続"+(fullCount-item.recordNumber)+"件と他のトークンは再現入力に含みません。現在の履歴は変更しません。";
    get("detail").textContent="保存元 "+item.agent+" の "+item.recordNumber+"番目 / ID "+item.event.id+" / ネットワーク "+item.chainId+" / 口座 "+item.account+" / 資産 "+item.asset.symbol+" ("+item.asset.address+")。"+decision(item);
    const money=value=>formatRehearsalUnits(value,item.asset.decimals)+" "+item.asset.symbol;
    for(const [field,value]of Object.entries(item.event))row("event",[eventLabels[field]??field,moneyFields.has(field)?money(value):field==="kind"?kinds[value]:String(value)]);
    for(const change of item.changes)row("balances",[SCENARIO_LABELS[change.field],money(change.before),money(change.after),(BigInt(change.delta)>0n?"+":"")+money(change.delta)]);
    const related=relatedRehearsalRecords(index,selected);
    get("related-status").textContent=item.reference?"同じ保存元・同じ"+(item.reference.kind==="operation"?"操作":"予約")+"ID「"+item.reference.id+"」を持つ他の記録 "+related.length+"件。対応付けはIDの一致で、実行の証明ではありません。":"この記録には操作ID・予約IDがありません。";
    if(related.length)get("related-status").textContent+="「詳しく見る」を押すと、この保存元の全記録表示に切り替わります。";
    const own=revision,sourceIndex=index;
    for(const other of related){
      const tr=row("related",[other.recordNumber+"番目: "+other.event.id,kinds[other.event.kind],decision(other)]);
      const td=document.createElement("td"),button=document.createElement("button");
      button.type="button";button.textContent="詳しく見る";
      button.setAttribute("aria-label",other.agent+" の "+other.recordNumber+"番目、"+other.event.id+" を詳しく見る");
      button.addEventListener("click",()=>{
        if(disposed||own!==revision||detailOwn!==detailRevision||sourceIndex!==index)return;
        const size=Number(get("size").value||"10");
        if(![10,25,50].includes(size))return;
        const rows=sourceIndex.rows.filter(entry=>entry.agent===other.agent);
        const position=rows.findIndex(entry=>entry.key===other.key);
        if(position<0)return;
        const query=Object.fromEntries([...Object.keys(REHEARSAL_RECORD_QUERY),"reason"].map(name=>[name,get(name).value|| (name==="reason"?"all":"")]));
        backView={index:sourceIndex,query,selected,offset,size,searchScope:get("search-scope").value||"stored"};
        get("agent").value=other.agent;get("kind").value="all";get("decision").value="all";get("search").value="";get("search-scope").value="stored";get("reason").value="all";
        selected=other.key;offset=Math.floor(position/size)*size;render();
        get("select").focus?.();
      });
      td.append(button);tr.append(td);
    }
  }
  function render(){revision++;
    get("summary").textContent="";get("summary-save").disabled=true;get("summary-csv-save").disabled=true;get("prefix-note").textContent="";get("prefix-save").disabled=true;get("prefix-report-save").disabled=true;
    for(const name of["rows","select","detail","event","balances","related","related-status","export-status"])get(name).textContent="";
    get("reference-summary").textContent="";get("reference-summary").hidden=true;get("reference-save").disabled=true;get("reference-csv-save").disabled=true;
    get("back").disabled=!backView||backView.index!==index;
    get("save").disabled=true;get("csv-save").disabled=true;get("prev").disabled=true;get("next").disabled=true;get("select").disabled=true;
    if(!index){get("status").textContent="履歴を作成または復旧すると、ここから記録を探せます。";get("scope").textContent="";return;}
    try{report=queryRows(queryInput());renderSummary();}
    catch{report=null;selected="";get("status").textContent="検索条件を確認してください。検索語は80文字以内です。";return;}
    const size=Number(get("size").value||"10");if(![10,25,50].includes(size))return;
    offset=Math.max(0,Math.min(offset,Math.max(0,Math.ceil(report.rows.length/size)-1)*size));
    const shown=report.rows.slice(offset,offset+size);if(!shown.some(row=>row.key===selected))selected=shown[0]?.key??"";
    get("scope").textContent=index.subjects.map(item=>item.agent+": "+(item.present?item.recordCount+"件":"未作成")).join(" / ");
    const listOwn=revision,sourceIndex=index,sourceReport=report;
    for(const item of shown){const tr=row("rows",[item.agent,item.recordNumber+"番目: "+item.event.id,kinds[item.event.kind],decision(item),item.reference?.id??"なし"]);
      const cell=document.createElement("td"),pick=document.createElement("button");pick.type="button";pick.textContent="詳しく見る";
      pick.setAttribute("aria-label",item.agent+" の "+item.recordNumber+"番目、"+item.event.id+" を詳しく見る");
      pick.addEventListener("click",()=>{
        if(disposed||listOwn!==revision||sourceIndex!==index||sourceReport!==report)return;
        selected=item.key;get("select").value=selected;detail();get("select").focus?.();
      });cell.append(pick);tr.append(cell);
      const option=document.createElement("option");option.value=item.key;option.textContent=item.agent+" / "+item.recordNumber+"番目 / "+item.event.id;get("select").append(option);}
    get("select").value=selected;get("select").disabled=!shown.length;get("prev").disabled=offset===0;get("next").disabled=offset+size>=report.rows.length;
    get("save").disabled=!index.inputs.ledgers.length;get("csv-save").disabled=get("save").disabled;
    get("status").textContent="一致 "+report.matchedRecords+"件 / 全 "+report.totalRecords+"件。"+(shown.length?(offset+1)+"～"+(offset+shown.length)+"件目を表示。":"一致する記録はありません。")+"保存はページをまたぐ全一致記録と元入力が対象です。";detail();
  }
  for(const name of["agent","kind","decision","size","search-scope","reason"])listen(name,"change",()=>{if(disposed)return;backView=null;offset=0;render();});
  listen("search","input",()=>{if(disposed)return;backView=null;offset=0;render();});
  listen("clear","click",()=>{if(disposed)return;backView=null;for(const [name,value]of Object.entries(REHEARSAL_RECORD_QUERY))get(name).value=value;get("search-scope").value="stored";get("reason").value="all";offset=0;render();});
  for(const [name,direction]of[["prev",-1],["next",1]])listen(name,"click",()=>{if(disposed||!report)return;offset+=direction*Number(get("size").value||"10");render();});
  listen("back","click",()=>{
    if(disposed||!backView||backView.index!==index)return;
    const previous=backView;backView=null;
    for(const [name,value]of Object.entries(previous.query))get(name).value=value;
    get("search-scope").value=previous.searchScope;get("size").value=String(previous.size);selected=previous.selected;offset=previous.offset;render();
    get("select").focus?.();
  });
  listen("select","change",()=>{if(disposed)return;selected=get("select").value;detail();});
  for(const [name,csv]of [["summary-save",false],["summary-csv-save",true]])listen(name,"click",()=>{
    if(disposed||!index||!report||get(name).disabled)return;const own=revision,source=index;
    try{const text=(csv?rehearsalRecordSummaryCsv:encodeRehearsalRecordSummary)(source.inputs,summaryQuery());
      offerDownload({document,prepared:{text,filename:"ThreeCore-record-summary."+(csv?"csv":"json"),mimeType:csv?"text/csv;charset=utf-8":"application/json"}});
      if(!disposed&&own===revision&&source===index)get("export-status").textContent="全一致記録のトークン別集計を保存し始めました。金額は一致記録による増減で、最終残高ではありません。";
    }catch{if(!disposed&&own===revision&&source===index)get("export-status").textContent="集計を保存できませんでした。履歴と検索条件は保持しています。";}
  });
  for(const [name,reportFile]of [["prefix-save",false],["prefix-report-save",true]])listen(name,"click",()=>{
    if(disposed||!index||!report||get(name).disabled)return;const item=report.rows.find(row=>row.key===selected);if(!item)return;
    const own=revision,detailOwn=detailRevision,source=index;
    try{const text=(reportFile?encodeRehearsalRecordPrefix:extractRehearsalRecordPrefix)(source.inputs,item.key);
      offerDownload({document,prepared:{text,filename:"ThreeCore-"+item.agent+"-through-record-"+item.recordNumber+(reportFile?"-report":"")+".json",mimeType:"application/json"}});
      if(!disposed&&own===revision&&detailOwn===detailRevision&&source===index)get("export-status").textContent=reportFile?"先頭から選んだ記録までの再現資料を保存し始めました。確認用に元の全入力も含みます。資料の再確認欄で確認できます。":"先頭から選んだ記録までの入力だけを保存し始めました。「記録を保存・再確認」で確認できます。現在の履歴は変更していません。";
    }catch{if(!disposed&&own===revision&&detailOwn===detailRevision&&source===index)get("export-status").textContent="再現入力を保存できませんでした。元の全履歴と表示は保持しています。";}
  });
  listen("save","click",()=>{if(disposed||!index||!report||!index.inputs.ledgers.length)return;
    const own=revision; try{offerDownload({document,prepared:{text:encode(),filename:"ThreeCore-record-query.json",mimeType:"application/json"}});if(disposed||own!==revision)return;get("export-status").textContent="検索条件・全一致記録・元入力の保存を開始しました。";}
    catch{if(disposed||own!==revision)return;get("export-status").textContent="検索結果を保存できませんでした。現在の履歴は保持しています。";}
  });
  listen("csv-save","click",()=>{if(disposed||!index||!report||!index.inputs.ledgers.length)return;
    const own=revision;try{const matched=report.matchedRecords;offerDownload({document,prepared:{text:encode(true),filename:"ThreeCore-record-query.csv",mimeType:"text/csv;charset=utf-8"}});if(disposed||own!==revision)return;
      get("export-status").textContent="検索に一致する全"+matched+"件のCSV保存を開始しました。"+(matched?"":"一致する記録がないため列名だけを含みます。")+"CSVは閲覧用です。元入力を含む検証資料にはJSON保存を使ってください。";
    }catch{if(disposed||own!==revision)return;get("export-status").textContent="CSVを保存できませんでした。現在の履歴と検索条件は保持しています。";}
  });
  /** Select a current original record, preserving the previous browsing view for Back. */
  function openRecord(key) {
    if(disposed||!index||typeof key!=="string")return false;
    const sourceIndex=index,own=revision,item=sourceIndex.rows.find(row=>row.key===key);
    if(!item)return false;
    const size=Number(get("size").value||"10");if(![10,25,50].includes(size))return false;
    const query=Object.fromEntries([...Object.keys(REHEARSAL_RECORD_QUERY),"reason"].map(name=>[name,get(name).value|| (name==="reason"?"all":"")]));
    const previous={index:sourceIndex,query,selected,offset,size,searchScope:get("search-scope").value||"stored"};
    if(disposed||index!==sourceIndex||revision!==own)return false;
    const position=sourceIndex.rows.filter(row=>row.agent===item.agent).findIndex(row=>row.key===key);
    backView=previous;get("agent").value=item.agent;get("kind").value="all";get("decision").value="all";
    get("search").value="";get("search-scope").value="stored";get("reason").value="all";selected=key;offset=Math.floor(position/size)*size;
    render();if(disposed||index!==sourceIndex)return false;get("select").focus?.();return true;
  }
  for(const [name,format]of [["reference-save","json"],["reference-csv-save","csv"]])listen(name,"click",()=>{
    if(disposed||!index||!report||get(name).disabled)return;
    const item=report.rows.find(row=>row.key===selected);if(!item?.reference)return;
    const own=revision,detailOwn=detailRevision,source=index;
    try{const text=(format==="csv"?rehearsalReferenceCsv:encodeRehearsalReferenceReport)(source.inputs,item.key);
      offerDownload({document,prepared:{text,filename:"ThreeCore-reference-lifecycle."+format,mimeType:format==="csv"?"text/csv;charset=utf-8":"application/json"}});
      if(disposed||own!==revision||detailOwn!==detailRevision||source!==index)return;
      get("export-status").textContent=format==="csv"?"この操作・予約の全関連記録と集計のCSV保存を開始しました。CSVは閲覧用です。元入力を再計算する資料にはJSONを使ってください。":"この操作・予約の全関連記録と、再計算に必要な元入力の保存を開始しました。資料の再確認欄で確認できます。";
    }catch{if(!disposed&&own===revision&&detailOwn===detailRevision&&source===index)get("export-status").textContent="関連記録の資料を保存できませんでした。元の履歴と表示は保持しています。";}
  });
  function refresh(input) {
    if(disposed)return;
    const own=++revision;
    let next;
    try {next=input?indexRehearsalRecords(input):null;}
    catch(error){if(disposed||own!==revision)return;throw error;}
    if(disposed||own!==revision)return;
    index=next;report=null;backView=null;
    if(!next){selected="";offset=0;}
    render();
  }
  render();return Object.freeze({refresh,openRecord,dispose(){
    if(disposed)return;
    disposed=true;revision++;index=null;report=null;backView=null;selected="";render();
    for(const remove of listeners)remove();
  }});
}
