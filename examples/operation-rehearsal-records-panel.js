import { requireSyncExport } from "../src/export-policy.js";
import { indexRehearsalRecords,queryRehearsalRecords,relatedRehearsalRecords,encodeRehearsalRecordReport,REHEARSAL_RECORD_QUERY } from "../src/operation-rehearsal-records.js";
import { formatRehearsalUnits } from "../src/operation-rehearsal.js";
import { SCENARIO_LABELS } from "./operation-rehearsal-scenario-panel.js";
export function mountRehearsalRecordsPanel(document,{download,reasons,kinds}){
  const offerDownload = payload => requireSyncExport(download(payload));
  const get=name=>document.getElementById("record-browser-"+name);let index=null,report=null,selected="",offset=0,disposed=false,revision=0;const listeners=[];
  function listen(name,event,fn){get(name).addEventListener(event,fn);listeners.push(()=>get(name).removeEventListener(event,fn));}
  function row(target,values){const tr=document.createElement("tr");for(const value of values){const td=document.createElement("td");td.textContent=value;tr.append(td);}get(target).append(tr);}
  const decision=item=>item.result.withinEnteredLimits?"仮の条件内":"見送り: "+item.result.reasons.map(code=>reasons[code]??code).join("・");
  const eventLabels={id:"記録ID",kind:"種類",agent:"記録上の対象",chainId:"記録上のネットワーク",account:"記録上の口座",operationId:"操作ID",reservationId:"予約ID",origin:"記録上のサイト",spender:"記録上の利用先契約",principal:"元本",fee:"費用",grossReturn:"元本を含む戻り額",amount:"金額",exitFeeReserve:"確保する決済費用"};
  const moneyFields=new Set(["principal","fee","grossReturn","amount","exitFeeReserve"]);
  function detail(){for(const name of["detail","event","balances","related","related-status"])get(name).textContent="";
    const item=report?.rows.find(row=>row.key===selected);if(!item)return;
    get("detail").textContent="保存元 "+item.agent+" の "+item.recordNumber+"番目 / ID "+item.event.id+" / ネットワーク "+item.chainId+" / 口座 "+item.account+" / 資産 "+item.asset.symbol+" ("+item.asset.address+")。"+decision(item);
    const money=value=>formatRehearsalUnits(value,item.asset.decimals)+" "+item.asset.symbol;
    for(const [field,value]of Object.entries(item.event))row("event",[eventLabels[field]??field,moneyFields.has(field)?money(value):field==="kind"?kinds[value]:String(value)]);
    for(const change of item.changes)row("balances",[SCENARIO_LABELS[change.field],money(change.before),money(change.after),(BigInt(change.delta)>0n?"+":"")+money(change.delta)]);
    const related=relatedRehearsalRecords(index,selected);
    get("related-status").textContent=item.reference?"同じ保存元・同じ"+(item.reference.kind==="operation"?"操作":"予約")+"ID「"+item.reference.id+"」を持つ他の記録 "+related.length+"件。対応付けはIDの一致で、実行の証明ではありません。":"この記録には操作ID・予約IDがありません。";
    for(const other of related)row("related",[other.recordNumber+"番目: "+other.event.id,kinds[other.event.kind],decision(other)]);
  }
  function render(){revision++;
    for(const name of["rows","select","detail","event","balances","related","related-status","export-status"])get(name).textContent="";
    get("save").disabled=true;get("prev").disabled=true;get("next").disabled=true;get("select").disabled=true;
    if(!index){get("status").textContent="履歴を作成または復旧すると、ここから記録を探せます。";get("scope").textContent="";return;}
    try{report=queryRehearsalRecords(index,Object.fromEntries(Object.keys(REHEARSAL_RECORD_QUERY).map(key=>[key,get(key).value||REHEARSAL_RECORD_QUERY[key]])));}
    catch{report=null;selected="";get("status").textContent="検索条件を確認してください。検索語は80文字以内です。";return;}
    const size=Number(get("size").value||"10");if(![10,25,50].includes(size))return;
    offset=Math.max(0,Math.min(offset,Math.max(0,Math.ceil(report.rows.length/size)-1)*size));
    const shown=report.rows.slice(offset,offset+size);if(!shown.some(row=>row.key===selected))selected=shown[0]?.key??"";
    get("scope").textContent=index.subjects.map(item=>item.agent+": "+(item.present?item.recordCount+"件":"未作成")).join(" / ");
    for(const item of shown){row("rows",[item.agent,item.recordNumber+"番目: "+item.event.id,kinds[item.event.kind],decision(item),item.reference?.id??"なし"]);
      const option=document.createElement("option");option.value=item.key;option.textContent=item.agent+" / "+item.recordNumber+"番目 / "+item.event.id;get("select").append(option);}
    get("select").value=selected;get("select").disabled=!shown.length;get("prev").disabled=offset===0;get("next").disabled=offset+size>=report.rows.length;
    get("save").disabled=!index.inputs.ledgers.length;
    get("status").textContent="一致 "+report.matchedRecords+"件 / 全 "+report.totalRecords+"件。"+(shown.length?(offset+1)+"～"+(offset+shown.length)+"件目を表示。":"一致する記録はありません。")+"保存はページをまたぐ全一致記録と元入力が対象です。";detail();
  }
  for(const name of["agent","kind","decision","size"])listen(name,"change",()=>{if(disposed)return;offset=0;render();});
  listen("search","input",()=>{if(disposed)return;offset=0;render();});
  listen("clear","click",()=>{if(disposed)return;for(const [name,value]of Object.entries(REHEARSAL_RECORD_QUERY))get(name).value=value;offset=0;render();});
  for(const [name,direction]of[["prev",-1],["next",1]])listen(name,"click",()=>{if(disposed||!report)return;offset+=direction*Number(get("size").value||"10");render();});
  listen("select","change",()=>{if(disposed)return;selected=get("select").value;detail();});
  listen("save","click",()=>{if(disposed||!index||!report||!index.inputs.ledgers.length)return;
    const own=revision; try{offerDownload({document,prepared:{text:encodeRehearsalRecordReport(index.inputs,report.query),filename:"ThreeCore-record-query.json",mimeType:"application/json"}});if(disposed||own!==revision)return;get("export-status").textContent="検索条件・全一致記録・元入力の保存を開始しました。";}
    catch{if(disposed||own!==revision)return;get("export-status").textContent="検索結果を保存できませんでした。現在の履歴は保持しています。";}
  });
  function refresh(input) {
    if(disposed)return;
    const own=++revision;
    let next;
    try {next=input?indexRehearsalRecords(input):null;}
    catch(error){if(disposed||own!==revision)return;throw error;}
    if(disposed||own!==revision)return;
    index=next;report=null;
    if(!next){selected="";offset=0;}
    render();
  }
  render();return Object.freeze({refresh,dispose(){
    if(disposed)return;
    disposed=true;revision++;index=null;report=null;selected="";render();
    for(const remove of listeners)remove();
  }});
}
