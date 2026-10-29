import { captureDataRecord } from "./security-data.js";
import { boundedUtf8Length } from "./security-json.js";
import { evaluateRehearsal, RehearsalError } from "./operation-rehearsal.js";
import { validateRehearsalWorkspace, REHEARSAL_AGENTS } from "./operation-rehearsal-workspace.js";
export const REHEARSAL_RECORD_REPORT_SCHEMA="threecore.operation-rehearsal-record-query.v1";
export const REHEARSAL_RECORD_BALANCES=Object.freeze(["cash","outstanding","realizedPnl","reservedExitFees","reservedAllocations","availableCash"]);
export const REHEARSAL_RECORD_QUERY=Object.freeze({agent:"all",kind:"all",decision:"all",search:""});
const KINDS=["open","settle","deposit","withdraw","reserve","release"],indexes=new WeakSet();
const fail=code=>{throw new RehearsalError(code);};
const validIndex=index=>{if(!indexes.has(index))fail("INVALID_RECORD_INDEX");};
export function validateRehearsalRecordQuery(input){let data;try{data=captureDataRecord(input,["agent","kind","decision","search"]);}catch{fail("INVALID_RECORD_QUERY");}
  if(!["all",...REHEARSAL_AGENTS].includes(data.agent)||!["all",...KINDS].includes(data.kind)||!["all","accepted","rejected"].includes(data.decision)||
    typeof data.search!=="string"||data.search.length>80||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(data.search))fail("INVALID_RECORD_QUERY");
  return Object.freeze({agent:data.agent,kind:data.kind,decision:data.decision,search:data.search.trim().toLowerCase()});
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
  const index=Object.freeze({inputs,subjects:Object.freeze(subjects),rows:Object.freeze(rows)});indexes.add(index);return index;
}
export function queryRehearsalRecords(index,input=REHEARSAL_RECORD_QUERY){validIndex(index);const query=validateRehearsalRecordQuery(input);
  const terms=query.search.split(/\s+/).filter(Boolean);
  const rows=index.rows.filter(row=>{
    if(query.agent!=="all"&&row.agent!==query.agent||query.kind!=="all"&&row.event.kind!==query.kind||
      query.decision==="accepted"&&!row.result.withinEnteredLimits||query.decision==="rejected"&&row.result.withinEnteredLimits)return false;
    const haystack=[row.key,row.event.id,row.reference?.id??"",row.account,row.asset.address,...row.result.reasons].join(" ").toLowerCase();
    return terms.every(term=>haystack.includes(term));
  });
  return Object.freeze({schema:REHEARSAL_RECORD_REPORT_SCHEMA,simulationOnly:true,sourceVerified:false,authorizesExecution:false,
    inputs:index.inputs,query,subjects:index.subjects,totalRecords:index.rows.length,matchedRecords:rows.length,rows:Object.freeze(rows)});
}
export function relatedRehearsalRecords(index,key){validIndex(index);if(typeof key!=="string")fail("INVALID_RECORD_KEY");
  const selected=index.rows.find(row=>row.key===key);if(!selected)fail("RECORD_NOT_FOUND");
  if(!selected.reference)return Object.freeze([]);
  return Object.freeze(index.rows.filter(row=>row.key!==key&&row.agent===selected.agent&&row.reference?.kind===selected.reference.kind&&row.reference.id===selected.reference.id));
}
export function encodeRehearsalRecordReport(input,query=REHEARSAL_RECORD_QUERY){const text=JSON.stringify(queryRehearsalRecords(indexRehearsalRecords(input),query),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}
