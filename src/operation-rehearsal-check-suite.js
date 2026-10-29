import { captureDataRecord, captureDataArray } from "./security-data.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { evaluateRehearsal, RehearsalError } from "./operation-rehearsal.js";
import { validateRehearsalScenarioSet } from "./operation-rehearsal-scenario-set.js";
import { REHEARSAL_SCENARIO_METRICS } from "./operation-rehearsal-scenario.js";

export const REHEARSAL_CHECK_SUITE_SCHEMA="threecore.operation-rehearsal-check-suite.v1";
export const REHEARSAL_CHECK_REPORT_SCHEMA="threecore.operation-rehearsal-check-report.v1";
export const REHEARSAL_CHECK_SUITE_LIMIT=1048576;
export const REHEARSAL_CHECK_DIFFERENCES=40;
const fail=code=>{throw new RehearsalError(code);};
const record=(input,keys)=>{try{return captureDataRecord(input,keys);}catch{fail("INVALID_CHECK_SUITE");}};
const array=(input,max,min=0)=>{try{return captureDataArray(input,max,min);}catch{fail("INVALID_CHECK_SUITE");}};
const amount=(value,field)=>{
  if(typeof value!=="string"||!/^(-?[1-9][0-9]{0,80}|0)$/.test(value)||
    (field!=="realizedPnl"&&value.startsWith("-")))fail("INVALID_EXPECTED_AMOUNT");
  return value;
};
function reasons(input){const list=array(input,32);const seen=new Set();
  for(const value of list){if(typeof value!=="string"||!/^[A-Z][A-Z0-9_]{0,63}$/.test(value)||seen.has(value))fail("INVALID_EXPECTED_REASON");seen.add(value);}
  return Object.freeze([...list]);
}
function checkpoint(input){const result=evaluateRehearsal(input);return Object.freeze({
  metrics:Object.freeze(Object.fromEntries(REHEARSAL_SCENARIO_METRICS.map(field=>[field,result[field]]))),
  openPositions:result.openPositions,allocationBlockers:result.allocationBlockers,
  records:Object.freeze(result.rows.map(row=>Object.freeze({id:row.id,withinEnteredLimits:row.withinEnteredLimits,reasons:row.reasons})))
});}
function expectedCheckpoint(input,events){const data=record(input,["metrics","openPositions","allocationBlockers","records"]);
  const values=record(data.metrics,REHEARSAL_SCENARIO_METRICS);
  const metrics=Object.freeze(Object.fromEntries(REHEARSAL_SCENARIO_METRICS.map(field=>[field,amount(values[field],field)])));
  if(!Number.isSafeInteger(data.openPositions)||data.openPositions<0||data.openPositions>200)fail("INVALID_EXPECTED_COUNT");
  const entries=array(data.records,200);
  if(entries.length!==events.length)fail("EXPECTED_RECORD_SCOPE_MISMATCH");
  const records=entries.map((entry,index)=>{const row=record(entry,["id","withinEnteredLimits","reasons"]);
    if(row.id!==events[index].id||typeof row.withinEnteredLimits!=="boolean")fail("EXPECTED_RECORD_SCOPE_MISMATCH");
    const why=reasons(row.reasons);
    if(row.withinEnteredLimits!==(why.length===0))fail("INCONSISTENT_EXPECTED_DECISION");
    return Object.freeze({id:row.id,withinEnteredLimits:row.withinEnteredLimits,reasons:why});
  });
  return Object.freeze({metrics,openPositions:data.openPositions,allocationBlockers:reasons(data.allocationBlockers),records:Object.freeze(records)});
}
export function validateRehearsalCheckSuite(input){const root=record(input,["schema","simulationOnly","expectationOrigin","inputs","expected"]);
  if(root.schema!==REHEARSAL_CHECK_SUITE_SCHEMA||root.simulationOnly!==true||!["recorded-calculation","manually-specified"].includes(root.expectationOrigin))fail("INVALID_CHECK_SUITE");
  const inputs=validateRehearsalScenarioSet(root.inputs),raw=array(root.expected,12,1);
  if(raw.length!==inputs.cases.length)fail("EXPECTED_CASE_SCOPE_MISMATCH");
  const expected=raw.map((item,index)=>{const row=record(item,["id","before","after"]),entry=inputs.cases[index];
    if(row.id!==entry.id)fail("EXPECTED_CASE_SCOPE_MISMATCH");
    return Object.freeze({id:row.id,before:expectedCheckpoint(row.before,entry.before.events),after:expectedCheckpoint(row.after,entry.after.events)});
  });
  const suite=Object.freeze({schema:REHEARSAL_CHECK_SUITE_SCHEMA,simulationOnly:true,expectationOrigin:root.expectationOrigin,inputs,expected:Object.freeze(expected)});
  try{boundedUtf8Length(JSON.stringify(suite,null,2)+"\n",REHEARSAL_CHECK_SUITE_LIMIT);}catch{fail("FILE_TOO_LARGE");}
  return suite;
}
/** A recorded baseline detects future changes; it is not independent proof of correctness. */
export function captureRehearsalCheckSuite(input){const inputs=validateRehearsalScenarioSet(input);
  return validateRehearsalCheckSuite({schema:REHEARSAL_CHECK_SUITE_SCHEMA,simulationOnly:true,expectationOrigin:"recorded-calculation",inputs,
    expected:inputs.cases.map(item=>({id:item.id,before:checkpoint(item.before),after:checkpoint(item.after)}))});
}
export function encodeRehearsalCheckSuite(input){return JSON.stringify(validateRehearsalCheckSuite(input),null,2)+"\n";}
export function decodeRehearsalCheckSuite(text){let input;try{input=parseSecurityJson(text,{bytes:REHEARSAL_CHECK_SUITE_LIMIT,depth:24,nodes:100000});}catch{fail("INVALID_CHECK_SUITE_JSON");}return validateRehearsalCheckSuite(input);}
export function runRehearsalCheckSuite(input){const inputs=validateRehearsalCheckSuite(input);
  const rows=inputs.inputs.cases.map((item,index)=>{
    let differenceCount=0;const differences=[];
    const compare=(side,field,expected,actual,recordId=null)=>{if(JSON.stringify(expected)===JSON.stringify(actual))return;
      differenceCount++;if(differences.length<REHEARSAL_CHECK_DIFFERENCES)differences.push(Object.freeze({side,field,recordId,expected,actual}));};
    for(const side of ["before","after"]){const actual=checkpoint(item[side]),expected=inputs.expected[index][side];
      for(const field of REHEARSAL_SCENARIO_METRICS)compare(side,field,expected.metrics[field],actual.metrics[field]);
      compare(side,"openPositions",expected.openPositions,actual.openPositions);
      compare(side,"allocationBlockers",expected.allocationBlockers,actual.allocationBlockers);
      for(let i=0;i<actual.records.length;i++){
        compare(side,"withinEnteredLimits",expected.records[i].withinEnteredLimits,actual.records[i].withinEnteredLimits,actual.records[i].id);
        compare(side,"reasons",expected.records[i].reasons,actual.records[i].reasons,actual.records[i].id);
      }
    }
    return Object.freeze({id:item.id,label:item.label,agent:item.before.agent,chainId:item.before.chainId,account:item.before.account,asset:item.before.asset,
      beforeRecords:item.before.events.length,afterRecords:item.after.events.length,matchesExpected:differenceCount===0,
      differenceCount,differences:Object.freeze(differences),differencesTruncated:differenceCount>differences.length});
  });
  const matched=rows.filter(row=>row.matchesExpected).length;
  return Object.freeze({schema:REHEARSAL_CHECK_REPORT_SCHEMA,simulationOnly:true,sourceVerified:false,authorizesExecution:false,
    inputs,summary:Object.freeze({cases:rows.length,matched,differing:rows.length-matched,allMatched:matched===rows.length}),rows:Object.freeze(rows)});
}
export function encodeRehearsalCheckReport(input){const text=JSON.stringify(runRehearsalCheckSuite(input),null,2)+"\n";
  try{boundedUtf8Length(text,2097152);}catch{fail("FILE_TOO_LARGE");}return text;
}
