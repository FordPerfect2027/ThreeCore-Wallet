import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalRecordCsv,REHEARSAL_RECORD_QUERY } from "../src/operation-rehearsal-records.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { capacityWorkspace } from "./helpers/rehearsal-capacity-fixtures.js";
const workspace=(...ledgers)=>({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers});
function table(text){assert.equal(text[0],"\uFEFF");assert.ok(text.endsWith("\r\n"));
  const lines=text.slice(1,-2).split("\r\n").map(line=>line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(cell=>{assert.ok(cell.startsWith('"')&&cell.endsWith('"'));return cell.slice(1,-1).replaceAll('""','"');}));
  const [header,...rows]=lines;assert.equal(new Set(header).size,header.length);return{header,rows:rows.map(row=>{assert.equal(row.length,header.length);return Object.fromEntries(header.map((key,i)=>[key,row[i]]));})};}

test("record CSV contains original row numbers, identity and recomputed before/after deltas",()=>{
  const {rows}=table(rehearsalRecordCsv(workspace(rehearsalExampleV2(),rehearsalExampleV2("EMA")),{...REHEARSAL_RECORD_QUERY,agent:"EMA",kind:"settle"}));
  assert.equal(rows.length,1);const row=rows[0];assert.equal(row.agent,"EMA");assert.equal(row.recordNumber,"2");assert.equal(row.recordId,"settle-one");
  assert.equal(row.totalRecords,"4");assert.equal(row.matchedRecords,"1");assert.equal(row.queryKind,"settle");assert.equal(row.simulationOnly,"true");assert.equal(row.sourceVerified,"false");assert.equal(row.authorizesExecution,"false");
  assert.equal(row.account,"0x"+"2".repeat(40));assert.equal(row.eventAccount,row.account);assert.equal(row.referenceKind,"operation");assert.equal(row.referenceId,"one");
  assert.equal(row.realizedPnlBeforeUnits,"-1000000");assert.equal(row.realizedPnlAfterUnits,"28000000");assert.equal(row.realizedPnlChangeUnits,"29000000");
  assert.equal(row.grossReturnUnits,"130000000");assert.equal(row.feeUnits,"1000000");assert.equal(row.principalUnits,"");
});
test("rejected foreign event context is not misreported as the ledger identity",()=>{
  const source=rehearsalExampleV2(),foreign={...source.events[0],agent:"EMA",account:"0x"+"2".repeat(40)};
  const {rows}=table(rehearsalRecordCsv(workspace({...source,events:[foreign]}),{...REHEARSAL_RECORD_QUERY,decision:"rejected"}));
  assert.equal(rows[0].agent,"DAT");assert.equal(rows[0].eventAgent,"EMA");assert.notEqual(rows[0].account,rows[0].eventAccount);
  assert.equal(rows[0].withinEnteredLimits,"false");assert.match(rows[0].reasons,/WRONG_AGENT/);assert.equal(rows[0].cashChangeUnits,"0");
});
test("exact atomic amounts beyond JavaScript integer precision are not rounded",()=>{
  const source=rehearsalExampleV2("DAT","deposit"),opening="123456789012345678901234567890";
  const {rows}=table(rehearsalRecordCsv(workspace({...source,openingBalance:opening,events:[{...source.events[0],amount:"1"}]})));
  assert.equal(rows[0].cashBeforeUnits,opening);assert.equal(rows[0].cashAfterUnits,"123456789012345678901234567891");assert.equal(rows[0].cashChangeUnits,"1");
});
test("all 600 matching records remain present in canonical agent order",()=>{
  const {rows}=table(rehearsalRecordCsv(capacityWorkspace()));assert.equal(rows.length,600);
  assert.deepEqual([rows[0].agent,rows[200].agent,rows[400].agent],["DAT","EMA","CAWELON"]);
  assert.equal(rows[599].recordId,"deposit-199");assert.ok(rows.every(row=>row.matchedRecords==="600"));
});
test("empty sources and no-match searches produce headings without fictitious record rows",()=>{
  for(const input of [workspace(),workspace({...rehearsalExampleV2(),events:[]}),workspace(rehearsalExampleV2())]){
    const {header,rows}=table(rehearsalRecordCsv(input,{...REHEARSAL_RECORD_QUERY,search:"no-match"}));assert.equal(rows.length,0);assert.ok(header.includes("sourceVerified"));
  }
});
test("a search starting with a formula operator is exported as inert text",()=>{
  const {rows}=table(rehearsalRecordCsv(workspace(rehearsalExampleV2()),{...REHEARSAL_RECORD_QUERY,search:" -ONE "}));
  assert.equal(rows.length,2);assert.equal(rows[0].querySearch,"'-one");assert.equal(rows[0].realizedPnlAfterUnits,"-1000000");
});
test("invalid input or query fails before producing a CSV",()=>{
  assert.throws(()=>rehearsalRecordCsv({}));assert.throws(()=>rehearsalRecordCsv(workspace(),{...REHEARSAL_RECORD_QUERY,kind:"send"}));
  const query={...REHEARSAL_RECORD_QUERY};let read=false;Object.defineProperty(query,"search",{get(){read=true;return"";}});
  assert.throws(()=>rehearsalRecordCsv(workspace(),query));assert.equal(read,false);
});
