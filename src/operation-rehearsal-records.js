import { captureDataRecord } from "./security-data.js";
import { boundedUtf8Length } from "./security-json.js";
import { validateRehearsal, encodeRehearsal, evaluateRehearsal, RehearsalError } from "./operation-rehearsal.js";
import { validateRehearsalWorkspace, REHEARSAL_AGENTS } from "./operation-rehearsal-workspace.js";
export const REHEARSAL_RECORD_REPORT_SCHEMA="threecore.operation-rehearsal-record-query.v1";
export const REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA="threecore.operation-rehearsal-record-query.v2";
export const REHEARSAL_RECORD_BALANCES=Object.freeze(["cash","outstanding","realizedPnl","reservedExitFees","reservedAllocations","availableCash"]);
export const REHEARSAL_RECORD_QUERY=Object.freeze({agent:"all",kind:"all",decision:"all",search:""});
const KINDS=["open","settle","deposit","withdraw","reserve","release"],indexes=new WeakSet(),recordViews=new WeakMap();
const fail=code=>{throw new RehearsalError(code);};
const validIndex=index=>{if(!indexes.has(index))fail("INVALID_RECORD_INDEX");};
export function validateRehearsalRecordQuery(input){let data;try{data=captureDataRecord(input,["agent","kind","decision","search"]);}catch{fail("INVALID_RECORD_QUERY");}
  if(!["all",...REHEARSAL_AGENTS].includes(data.agent)||!["all",...KINDS].includes(data.kind)||!["all","accepted","rejected"].includes(data.decision)||
    typeof data.search!=="string"||data.search.length>80||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(data.search))fail("INVALID_RECORD_QUERY");
  return Object.freeze({agent:data.agent,kind:data.kind,decision:data.decision,search:data.search.trim().toLowerCase()});
}
export function validateRehearsalContextRecordQuery(input){let data;try{data=captureDataRecord(input,["agent","kind","decision","search","searchScope"]);}catch{fail("INVALID_RECORD_QUERY");}
  if(!["recorded","both"].includes(data.searchScope))fail("INVALID_RECORD_QUERY");
  const query=validateRehearsalRecordQuery({agent:data.agent,kind:data.kind,decision:data.decision,search:data.search});
  return Object.freeze({...query,searchScope:data.searchScope});
}
export function indexRehearsalRecords(input){const inputs=validateRehearsalWorkspace(input),rows=[];
  const subjects=REHEARSAL_AGENTS.map(agent=>{const ledger=inputs.ledgers.find(item=>item.agent===agent);return Object.freeze({agent,present:Boolean(ledger),recordCount:ledger?.events.length??null});});
  for(const ledger of inputs.ledgers){const report=evaluateRehearsal(ledger);
    for(let i=0;i<ledger.events.length;i++){const event=ledger.events[i],result=report.rows[i];
      const before=Object.freeze(Object.fromEntries(REHEARSAL_RECORD_BALANCES.map(field=>[field,i?report.rows[i-1][field]:["cash","availableCash"].includes(field)?ledger.openingBalance:"0"])));
      const changes=Object.freeze(REHEARSAL_RECORD_BALANCES.map(field=>Object.freeze({field,before:before[field],after:result[field],delta:(BigInt(result[field])-BigInt(before[field])).toString()})));
      const reference=Object.hasOwn(event,"operationId")?{kind:"operation",id:event.operationId}:Object.hasOwn(event,"reservationId")?{kind:"reservation",id:event.reservationId}:null;
      rows.push(Object.freeze({key:ledger.agent+":"+event.id,agent:ledger.agent,chainId:ledger.chainId,account:ledger.account,asset:ledger.asset,
        recordNumber:i+1,event,reference:reference?Object.freeze(reference):null,result,changes}));
    }
  }
  const index=Object.freeze({inputs,subjects:Object.freeze(subjects),rows:Object.freeze(rows)});indexes.add(index);
  // One validated query per supported report schema, plus one summary, per immutable index.
  recordViews.set(index,{queries:new Map(),summary:null});return index;
}
export function queryRehearsalRecords(index,input=REHEARSAL_RECORD_QUERY){validIndex(index);return queryRecords(index,validateRehearsalRecordQuery(input),REHEARSAL_RECORD_REPORT_SCHEMA);}
export function queryRehearsalContextRecords(index,input){validIndex(index);return queryRecords(index,validateRehearsalContextRecordQuery(input),REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA);}
function queryRecords(index,query,schema){
  const cache=recordViews.get(index),key=JSON.stringify(query),previous=cache.queries.get(schema);
  if(previous?.key===key)return previous.report;
  const terms=query.search.split(/\s+/).filter(Boolean);
  const rows=index.rows.filter(row=>{
    if(query.agent!=="all"&&row.agent!==query.agent||query.kind!=="all"&&row.event.kind!==query.kind||
      query.decision==="accepted"&&!row.result.withinEnteredLimits||query.decision==="rejected"&&row.result.withinEnteredLimits)return false;
    if(query.reason&&query.reason!=="all"&&!row.result.reasons.includes(query.reason))return false;
    // V1 keeps its original stored-context search so historical reports reproduce.
    const stored=[row.key,row.event.id,row.reference?.id??"",row.account,row.asset.address,...row.result.reasons];
    const recorded=[row.event.id,row.reference?.id??"",row.event.agent,String(row.event.chainId),row.event.account,row.event.origin??"",row.event.spender??"",...row.result.reasons];
    const haystack=(query.searchScope==="recorded"?recorded:query.searchScope==="both"?[...stored,...recorded]:stored).join(" ").toLowerCase();
    return terms.every(term=>haystack.includes(term));
  });
  const report=Object.freeze({schema,simulationOnly:true,sourceVerified:false,authorizesExecution:false,
    inputs:index.inputs,query,subjects:index.subjects,totalRecords:index.rows.length,matchedRecords:rows.length,rows:Object.freeze(rows)});
  cache.queries.set(schema,{key,report});return report;
}
export function relatedRehearsalRecords(index,key){validIndex(index);if(typeof key!=="string")fail("INVALID_RECORD_KEY");
  const selected=index.rows.find(row=>row.key===key);if(!selected)fail("RECORD_NOT_FOUND");
  if(!selected.reference)return Object.freeze([]);
  return Object.freeze(index.rows.filter(row=>row.key!==key&&row.agent===selected.agent&&row.reference?.kind===selected.reference.kind&&row.reference.id===selected.reference.id));
}
export function encodeRehearsalRecordReport(input,query=REHEARSAL_RECORD_QUERY){const text=JSON.stringify(queryRehearsalRecords(indexRehearsalRecords(input),query),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}

export function encodeRehearsalContextRecordReport(input,query){const text=JSON.stringify(queryRehearsalContextRecords(indexRehearsalRecords(input),query),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}

/** Viewing-only CSV. Recompute every matched record, regardless of UI paging.
 * Atomic unit values remain decimal text; import columns as text in spreadsheets.
 * The JSON report retains missing-agent scope and remains the reproducible artifact.
 */
export function rehearsalRecordCsv(input,query=REHEARSAL_RECORD_QUERY){
  return recordReportCsv(queryRehearsalRecords(indexRehearsalRecords(input),query));
}
export function rehearsalContextRecordCsv(input,query){return recordReportCsv(queryRehearsalContextRecords(indexRehearsalRecords(input),query));}
function recordReportCsv(report){
  const fields=["simulationOnly","sourceVerified","authorizesExecution","queryAgent","queryKind","queryDecision","querySearch","querySearchScope","totalRecords","matchedRecords",
    "agent","recordNumber","recordId","eventKind","withinEnteredLimits","reasons","chainId","account","assetAddress","assetSymbol","assetDecimals",
    "eventAgent","eventChainId","eventAccount","eventOrigin","eventSpender","referenceKind","referenceId",
    "principalUnits","feeUnits","grossReturnUnits","amountUnits","exitFeeReserveUnits",
    ...REHEARSAL_RECORD_BALANCES.flatMap(field=>[field+"BeforeUnits",field+"AfterUnits",field+"ChangeUnits"]),...(Object.hasOwn(report.query,"reason")?["queryReason"]:[])];
  const cell=value=>{let text=String(value);if(/^\s*[=+@-]/u.test(text)&&!/^-[0-9]+$/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const lines=[fields];
  for(const row of report.rows){const event=row.event;
    lines.push([true,false,false,report.query.agent,report.query.kind,report.query.decision,report.query.search,report.query.searchScope??"stored",report.totalRecords,report.matchedRecords,
      row.agent,row.recordNumber,event.id,event.kind,row.result.withinEnteredLimits,row.result.reasons.join("|"),row.chainId,row.account,row.asset.address,row.asset.symbol,row.asset.decimals,
      event.agent,event.chainId,event.account,event.origin??"",event.spender??"",row.reference?.kind??"",row.reference?.id??"",
      ...["principal","fee","grossReturn","amount","exitFeeReserve"].map(field=>event[field]??""),
      ...row.changes.flatMap(change=>[change.before,change.after,change.delta]),...(Object.hasOwn(report.query,"reason")?[report.query.reason]:[])]);
  }
  const text="\uFEFF"+lines.map(line=>line.map(cell).join(",")).join("\r\n")+"\r\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}

/** Viewing-only lifecycle rows with exact repeated summary values and no implicit import. */
export function rehearsalReferenceCsv(input,key){
  const report=reportRehearsalReference(indexRehearsalRecords(input),key),summary=report.summary;
  const metrics=["principalUnits","pendingPrincipalUnits","grossReturnUnits","entryFeeUnits","exitFeeUnits","totalFeeUnits","realizedPnlUnits","reservedAmountUnits","releasedAmountUnits","pendingReservedAmountUnits"];
  const headers=["simulationOnly","sourceVerified","authorizesExecution","selectedKey","agent","chainId","account","assetAddress","assetSymbol","assetDecimals",
    "referenceKind","referenceId","phase","openingRecordId","closingRecordId","relatedRecords","acceptedRecords","rejectedRecords",...metrics,
    "recordNumber","recordId","eventKind","withinEnteredLimits","reasons","eventAgent","eventChainId","eventAccount","eventOrigin","eventSpender",
    "recordPrincipalUnits","recordFeeUnits","recordGrossReturnUnits","recordAmountUnits","recordExitFeeReserveUnits",
    ...REHEARSAL_RECORD_BALANCES.flatMap(field=>[field+"BeforeUnits",field+"AfterUnits",field+"ChangeUnits"])];
  const lines=[headers];
  for(const row of report.rows)lines.push([true,false,false,report.selectedKey,report.agent,report.context.chainId,report.context.account,
    report.context.asset.address,report.context.asset.symbol,report.context.asset.decimals,report.reference.kind,report.reference.id,summary.phase,
    summary.openingRecordId??"",summary.closingRecordId??"",report.recordCount,summary.acceptedRecords,summary.rejectedRecords,...metrics.map(name=>summary[name]??""),
    row.recordNumber,row.event.id,row.event.kind,row.result.withinEnteredLimits,row.result.reasons.join("|"),row.event.agent,row.event.chainId,row.event.account,row.event.origin??"",row.event.spender??"",
    ...["principal","fee","grossReturn","amount","exitFeeReserve"].map(name=>row.event[name]??""),...row.changes.flatMap(change=>[change.before,change.after,change.delta])]);
  const cell=value=>{let text=String(value);if(/^\s*[=+@-]/u.test(text)&&!/^-[0-9]+$/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const text="\uFEFF"+lines.map(line=>line.map(cell).join(",")).join("\r\n")+"\r\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}

export const REHEARSAL_REFERENCE_REPORT_SCHEMA = "threecore.operation-rehearsal-reference.v1";

/** Recalculate one operation/reservation's accepted lifecycle in its own stored agent. */
export function reportRehearsalReference(index, key) {
  validIndex(index);
  if(typeof key!=="string")fail("INVALID_RECORD_KEY");
  const selected=index.rows.find(row=>row.key===key);
  if(!selected)fail("RECORD_NOT_FOUND");
  if(!selected.reference)fail("RECORD_HAS_NO_REFERENCE");
  const reference=selected.reference,operation=reference.kind==="operation";
  const rows=index.rows.filter(row=>row.agent===selected.agent&&row.reference?.kind===reference.kind&&row.reference.id===reference.id);
  const accepted=rows.filter(row=>row.result.withinEnteredLimits);
  const opening=accepted.find(row=>row.event.kind===(operation?"open":"reserve"));
  const closing=accepted.find(row=>row.event.kind===(operation?"settle":"release"));
  const phase=opening?(closing?"closed":"open"):"not-started";
  const summary=Object.freeze({phase,openingRecordId:opening?.event.id??null,closingRecordId:closing?.event.id??null,
    acceptedRecords:accepted.length,rejectedRecords:rows.length-accepted.length,
    principalUnits:operation?opening?.event.principal??null:null,
    pendingPrincipalUnits:operation?(phase==="open"?opening.event.principal:"0"):null,
    grossReturnUnits:operation?closing?.event.grossReturn??null:null,
    entryFeeUnits:operation?opening?.event.fee??"0":null,
    exitFeeUnits:operation?closing?.event.fee??"0":null,
    totalFeeUnits:operation?accepted.reduce((sum,row)=>sum+BigInt(row.event.fee??"0"),0n).toString():null,
    realizedPnlUnits:operation?accepted.reduce((sum,row)=>sum+BigInt(row.result.pnlChange),0n).toString():null,
    reservedAmountUnits:operation?null:opening?.event.amount??null,
    releasedAmountUnits:operation?null:closing?opening.event.amount:"0",
    pendingReservedAmountUnits:operation?null:phase==="open"?opening.event.amount:"0"});
  return Object.freeze({schema:REHEARSAL_REFERENCE_REPORT_SCHEMA,simulationOnly:true,sourceVerified:false,authorizesExecution:false,
    inputs:index.inputs,subjects:index.subjects,selectedKey:key,agent:selected.agent,context:Object.freeze({chainId:selected.chainId,account:selected.account,asset:selected.asset}),
    reference,summary,recordCount:rows.length,rows:Object.freeze(rows)});
}

export function encodeRehearsalReferenceReport(input,key) {
  const text=JSON.stringify(reportRehearsalReference(indexRehearsalRecords(input),key),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}

export const REHEARSAL_REASON_RECORD_REPORT_SCHEMA = "threecore.operation-rehearsal-record-query.v3";
export const REHEARSAL_RECORD_REASON_LABELS = Object.freeze({
  PAUSED:"新規利用の停止中",REUSED_OPERATION:"同じ操作の再利用",UNLISTED_ORIGIN:"対象外のサイト",UNLISTED_SPENDER:"対象外の契約",
  ZERO_PRINCIPAL:"元本が0",PER_OPERATION_LIMIT:"1回の上限超過",OUTSTANDING_LIMIT:"未決済元本の上限超過",INSUFFICIENT_BALANCE:"資金不足",
  RESERVE_FLOOR:"予備資金を下回る",LOSS_LIMIT:"全額損失時に損失上限を超える",NO_OPEN_POSITION:"対応する未決済記録がない",
  INSUFFICIENT_FEE_BALANCE:"費用の資金不足",BALANCE_OVERFLOW:"金額の上限超過",WRONG_AGENT:"対象トークンが異なる",
  WRONG_CHAINID:"ネットワークが異なる",WRONG_ACCOUNT:"口座が異なる",ENTRY_FEE_LIMIT:"開始費用の上限超過",EXIT_FEE_LIMIT:"決済費用の上限超過",
  EXIT_FEE_RESERVE_EXCEEDED:"確保した決済費用を超える",REUSED_RESERVATION:"予約IDの再利用",ZERO_RESERVATION:"予約額が0",
  ALLOCATION_LIMIT:"予約できる還元額を超える",NO_RESERVATION:"取消対象の予約がない",UNSETTLED_POSITIONS:"未決済の記録あり",REJECTED_RECORDS:"条件に合わない記録あり"
});
export function validateRehearsalReasonRecordQuery(input){
  let data;try{data=captureDataRecord(input,["agent","kind","decision","search","searchScope","reason"]);}catch{fail("INVALID_RECORD_QUERY");}
  if(!["stored","recorded","both"].includes(data.searchScope)||typeof data.reason!=="string"||
     (data.reason!=="all"&&!Object.hasOwn(REHEARSAL_RECORD_REASON_LABELS,data.reason)))fail("INVALID_RECORD_QUERY");
  const query=validateRehearsalRecordQuery({agent:data.agent,kind:data.kind,decision:data.decision,search:data.search});
  return Object.freeze({...query,searchScope:data.searchScope,reason:data.reason});
}
export function queryRehearsalReasonRecords(index,input){
  validIndex(index);return queryRecords(index,validateRehearsalReasonRecordQuery(input),REHEARSAL_REASON_RECORD_REPORT_SCHEMA);
}
export function encodeRehearsalReasonRecordReport(input,query){
  const text=JSON.stringify(queryRehearsalReasonRecords(indexRehearsalRecords(input),query),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}
export function rehearsalReasonRecordCsv(input,query){return recordReportCsv(queryRehearsalReasonRecords(indexRehearsalRecords(input),query));}

export const REHEARSAL_RECORD_SUMMARY_SCHEMA="threecore.operation-rehearsal-record-summary.v1";
export const REHEARSAL_PREFIX_REPORT_SCHEMA="threecore.operation-rehearsal-record-prefix.v1";
export const REHEARSAL_SUMMARY_QUERY=Object.freeze({...REHEARSAL_RECORD_QUERY,searchScope:"stored",reason:"all"});

/** Changes contributed by matched records, grouped by stored agent, never cross-asset totals. */
export function summarizeRehearsalRecords(index,query=REHEARSAL_SUMMARY_QUERY){
  validIndex(index);const selected=queryRehearsalReasonRecords(index,query);
  const cache=recordViews.get(index);if(cache.summary?.selected===selected)return cache.summary.report;
  const rows=index.subjects.map(subject=>{
    const ledger=index.inputs.ledgers.find(item=>item.agent===subject.agent),matches=selected.rows.filter(row=>row.agent===subject.agent);
    const accepted=matches.filter(row=>row.result.withinEnteredLimits),reasons=new Map();
    for(const row of matches)for(const reason of row.result.reasons)reasons.set(reason,(reasons.get(reason)??0)+1);
    return Object.freeze({...subject,context:ledger?Object.freeze({chainId:ledger.chainId,account:ledger.account,asset:ledger.asset}):null,
      matchedRecords:matches.length,acceptedRecords:accepted.length,rejectedRecords:matches.length-accepted.length,
      kindCounts:Object.freeze(Object.fromEntries(KINDS.map(kind=>[kind,matches.filter(row=>row.event.kind===kind).length]))),
      reasonCounts:Object.freeze([...reasons].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([reason,records])=>Object.freeze({reason,records}))),
      balanceChanges:Object.freeze(Object.fromEntries(REHEARSAL_RECORD_BALANCES.map(field=>[field,ledger?matches.reduce((sum,row)=>sum+BigInt(row.changes.find(change=>change.field===field).delta),0n).toString():null]))),
      acceptedFeeUnits:ledger?accepted.reduce((sum,row)=>sum+BigInt(row.event.fee??"0"),0n).toString():null,
      recordKeys:Object.freeze(matches.map(row=>row.key))});
  });
  const report=Object.freeze({schema:REHEARSAL_RECORD_SUMMARY_SCHEMA,simulationOnly:true,sourceVerified:false,authorizesExecution:false,
    inputs:index.inputs,subjects:index.subjects,query:selected.query,scope:"matched-record-contributions",totalRecords:selected.totalRecords,matchedRecords:selected.matchedRecords,rows:Object.freeze(rows)});
  cache.summary={selected,report};return report;
}
export function encodeRehearsalRecordSummary(input,query=REHEARSAL_SUMMARY_QUERY){
  const text=JSON.stringify(summarizeRehearsalRecords(indexRehearsalRecords(input),query),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}
export function rehearsalRecordSummaryCsv(input,query=REHEARSAL_SUMMARY_QUERY){
  const report=summarizeRehearsalRecords(indexRehearsalRecords(input),query),lines=[[
    "simulationOnly","sourceVerified","authorizesExecution","scope","queryAgent","queryKind","queryDecision","querySearch","querySearchScope","queryReason","totalRecords","matchedRecords",
    "agent","present","sourceRecords","agentMatchedRecords","acceptedRecords","rejectedRecords","chainId","account","assetAddress","assetSymbol","assetDecimals",
    ...KINDS.map(kind=>kind+"Records"),"reasonCounts",...REHEARSAL_RECORD_BALANCES.map(field=>field+"ChangeUnits"),"acceptedFeeUnits"]];
  for(const row of report.rows)lines.push([true,false,false,report.scope,report.query.agent,report.query.kind,report.query.decision,report.query.search,report.query.searchScope,report.query.reason,report.totalRecords,report.matchedRecords,
    row.agent,row.present,row.recordCount??"",row.matchedRecords,row.acceptedRecords,row.rejectedRecords,row.context?.chainId??"",row.context?.account??"",row.context?.asset.address??"",row.context?.asset.symbol??"",row.context?.asset.decimals??"",
    ...KINDS.map(kind=>row.kindCounts[kind]),row.reasonCounts.map(item=>item.reason+":"+item.records).join("|"),...REHEARSAL_RECORD_BALANCES.map(field=>row.balanceChanges[field]??""),row.acceptedFeeUnits??""]);
  const cell=value=>{let text=String(value);if(/^\s*[=+@-]/u.test(text)&&!/^-[0-9]+$/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const text="\uFEFF"+lines.map(line=>line.map(cell).join(",")).join("\r\n")+"\r\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}

/** Keep every prior record of this stored agent, including rejected events; stop inclusively. */
export function reportRehearsalRecordPrefix(index,key){
  validIndex(index);if(typeof key!=="string")fail("INVALID_RECORD_KEY");
  const selected=index.rows.find(row=>row.key===key);if(!selected)fail("RECORD_NOT_FOUND");
  const ledger=index.inputs.ledgers.find(item=>item.agent===selected.agent),prefix=validateRehearsal({...ledger,events:ledger.events.slice(0,selected.recordNumber)});
  return Object.freeze({schema:REHEARSAL_PREFIX_REPORT_SCHEMA,simulationOnly:true,sourceVerified:false,authorizesExecution:false,
    inputs:index.inputs,subjects:index.subjects,selectedKey:key,agent:selected.agent,throughRecordId:selected.event.id,
    sourceRecords:ledger.events.length,includedRecords:prefix.events.length,omittedLaterRecords:ledger.events.length-prefix.events.length,
    prefix,result:evaluateRehearsal(prefix)});
}
export function encodeRehearsalRecordPrefix(input,key){
  const text=JSON.stringify(reportRehearsalRecordPrefix(indexRehearsalRecords(input),key),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}
export function extractRehearsalRecordPrefix(input,key){return encodeRehearsal(reportRehearsalRecordPrefix(indexRehearsalRecords(input),key).prefix);}
