import { captureDataRecord, captureDataArray } from "./security-data.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { compareRehearsalScenario } from "./operation-rehearsal-scenario.js";
import { RehearsalError } from "./operation-rehearsal.js";

export const REHEARSAL_SCENARIO_SET_SCHEMA = "threecore.operation-rehearsal-scenario-set.v1";
export const REHEARSAL_SCENARIO_SET_REPORT_SCHEMA = "threecore.operation-rehearsal-scenario-set-report.v1";
export const REHEARSAL_SCENARIO_SET_LIMIT = 1048576;
export const REHEARSAL_SCENARIO_SET_CASES = 12;
const fail = code => {throw new RehearsalError(code);};
function record(input, fields) {try{return captureDataRecord(input,fields);}catch{fail("INVALID_SCENARIO_SET");}}
function identifier(value) {
  if(typeof value!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) fail("INVALID_SCENARIO_ID");
  return value;
}
function label(value) {
  if(typeof value!=="string"||value.length>160) fail("INVALID_SCENARIO_LABEL");
  const result=value.normalize("NFC").trim();
  if(!result||result.length>80||!/[\S]/.test(result.replace(/[\u200b-\u200f\u2060\ufeff]/g,""))||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(result)||
    new TextDecoder().decode(new TextEncoder().encode(result))!==result) fail("INVALID_SCENARIO_LABEL");
  return result;
}
export function validateRehearsalScenarioCase(input) {
  const data=record(input,["id","label","before","after"]);
  const id=identifier(data.id), name=label(data.label), comparison=compareRehearsalScenario(data.before,data.after);
  return Object.freeze({id,label:name,before:comparison.inputs.before,after:comparison.inputs.after});
}
export function validateRehearsalScenarioSet(input) {
  const root=record(input,["schema","simulationOnly","cases"]);
  if(root.schema!==REHEARSAL_SCENARIO_SET_SCHEMA||root.simulationOnly!==true) fail("SIMULATION_REQUIRED");
  let entries;try{entries=captureDataArray(root.cases,REHEARSAL_SCENARIO_SET_CASES);}catch{fail("INVALID_SCENARIO_SET");}
  const ids=new Set();
  const cases=entries.map(entry=>{const data=validateRehearsalScenarioCase(entry);if(ids.has(data.id))fail("DUPLICATE_SCENARIO_ID");ids.add(data.id);return data;});
  const result=Object.freeze({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:Object.freeze(cases)});
  try{boundedUtf8Length(JSON.stringify(result,null,2)+"\n",REHEARSAL_SCENARIO_SET_LIMIT);}catch{fail("FILE_TOO_LARGE");}
  return result;
}
export function encodeRehearsalScenarioSet(input) {return JSON.stringify(validateRehearsalScenarioSet(input),null,2)+"\n";}
export function decodeRehearsalScenarioSet(text) {
  let parsed;try{parsed=parseSecurityJson(text,{bytes:REHEARSAL_SCENARIO_SET_LIMIT,depth:24,nodes:100000});}catch{fail("INVALID_SCENARIO_SET_JSON");}
  return validateRehearsalScenarioSet(parsed);
}
export function reportRehearsalScenarioSet(input) {
  const inputs=validateRehearsalScenarioSet(input);
  const rows=inputs.cases.map(item=>{
    const report=compareRehearsalScenario(item.before,item.after);
    return Object.freeze({id:item.id,label:item.label,agent:item.before.agent,chainId:item.before.chainId,
      account:item.before.account,asset:item.before.asset,beforeRecords:item.before.events.length,afterRecords:item.after.events.length,
      summary:report.summary,metrics:report.metrics});
  });
  return Object.freeze({schema:REHEARSAL_SCENARIO_SET_REPORT_SCHEMA,simulationOnly:true,sourceVerified:false,
    authorizesExecution:false,inputs,rows:Object.freeze(rows)});
}
export function encodeRehearsalScenarioSetReport(input) {
  const text=JSON.stringify(reportRehearsalScenarioSet(input),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}

/** Every edit is previewed against the same current immutable set and can be undone. */
export function createRehearsalScenarioSet(initial={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[]}) {
  let current=validateRehearsalScenarioSet(initial);
  let pending=null, revision=0, disposed=false, history=[];
  const active=()=>{if(disposed)fail("SCENARIO_SET_DISPOSED");};
  const cancel=()=>{revision++;pending=null;};
  function preview(input, action) {
    active();cancel();const own=revision,base=current;
    const next=validateRehearsalScenarioSet(input);
    if(disposed||own!==revision||base!==current)fail("STALE_REVIEW");
    pending=Object.freeze({action,before:base,after:next,changed:encodeRehearsalScenarioSet(base)!==encodeRehearsalScenarioSet(next)});
    return pending;
  }
  function existing(id) {identifier(id);const index=current.cases.findIndex(item=>item.id===id);if(index<0)fail("SCENARIO_NOT_FOUND");return index;}
  function previewPut(input, replace=false) {
    active();cancel();const own=revision,base=current;
    if(typeof replace!=="boolean")fail("INVALID_SCENARIO_SET");
    const entry=validateRehearsalScenarioCase(input);
    if(disposed||revision!==own||current!==base)fail("STALE_REVIEW");
    const index=current.cases.findIndex(item=>item.id===entry.id);
    if(index>=0&&!replace)fail("DUPLICATE_SCENARIO_ID");if(index<0&&replace)fail("SCENARIO_NOT_FOUND");
    const cases=[...current.cases];if(index<0)cases.push(entry);else cases[index]=entry;
    return preview({...current,cases},replace?"replace":"add");
  }
  return Object.freeze({previewPut,
    previewRename(id,name){active();cancel();const index=existing(id);const cases=[...current.cases];cases[index]={...cases[index],label:label(name)};return preview({...current,cases},"rename");},
    previewRemove(id){active();cancel();const index=existing(id);return preview({...current,cases:current.cases.filter((_entry,i)=>i!==index)},"remove");},
    previewImport:input=>preview(input,"import"),cancel,
    commit(review){active();if(!pending||review!==pending)fail("STALE_REVIEW");const next=pending.after,changed=pending.changed;cancel();if(changed){history.push(current);if(history.length>10)history.shift();current=next;}return current;},
    undo(){active();cancel();if(!history.length)fail("NO_UNDO");current=history.pop();return current;},
    state(){active();return Object.freeze({current,undoCount:history.length,canUndo:history.length>0,hasReview:pending!==null});},
    dispose(){if(disposed)return;cancel();history=[];current=null;disposed=true;}
  });
}
