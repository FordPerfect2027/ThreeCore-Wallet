import test from "node:test";
import assert from "node:assert/strict";
import {rehearsalExampleV2} from "../src/operation-rehearsal-examples.js";
import {REHEARSAL_WORKSPACE_SCHEMA} from "../src/operation-rehearsal-workspace.js";
import {rehearsalReferenceCsv} from "../src/operation-rehearsal-records.js";
const workspace=(...ledgers)=>({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers});
// Fixtures contain only plain IDs and numeric fields, with no embedded quotes.
function records(text){assert.ok(text.startsWith("\uFEFF"));assert.ok(text.endsWith("\r\n"));
  const [head,...rows]=text.slice(1,-2).split("\r\n").map(line=>JSON.parse("["+line+"]"));
  assert.ok(rows.every(row=>row.length===head.length));return rows.map(row=>Object.fromEntries(head.map((key,i)=>[key,row[i]])));
}
test("reference CSV includes every related row, exact repeated summaries and only its selected agent",()=>{
 const input=workspace(rehearsalExampleV2(),rehearsalExampleV2("EMA","loss")),before=JSON.stringify(input),rows=records(rehearsalReferenceCsv(input,"DAT:open-one"));
 assert.deepEqual(rows.map(row=>row.recordId),["open-one","settle-one"]);
 for(const row of rows){assert.equal(row.agent,"DAT");assert.equal(row.relatedRecords,"2");assert.equal(row.totalFeeUnits,"2000000");assert.equal(row.realizedPnlUnits,"28000000");assert.equal(row.phase,"closed");assert.equal(row.authorizesExecution,"false");}
 assert.equal(rows[0].recordExitFeeReserveUnits,"2000000");assert.equal(rows[0].eventOrigin,"https://training.example");
 assert.equal(rows[1].cashChangeUnits,"129000000");assert.equal(JSON.stringify(input),before);
});
test("pending missing return, closed zero return and negative profit remain distinct in CSV",()=>{
 const pending=records(rehearsalReferenceCsv(workspace(rehearsalExampleV2("DAT","pending")),"DAT:open-one"))[0];
 assert.equal(pending.grossReturnUnits,"");assert.equal(pending.exitFeeUnits,"0");assert.equal(pending.realizedPnlUnits,"-1000000");
 const zero=structuredClone(rehearsalExampleV2());zero.events[1].grossReturn="0";
 const row=records(rehearsalReferenceCsv(workspace(zero),"DAT:settle-one"))[0];assert.equal(row.grossReturnUnits,"0");assert.equal(row.realizedPnlUnits,"-102000000");
});
test("reference CSV preserves return and profit values above the safe integer limit",()=>{
 const input=structuredClone(rehearsalExampleV2()),value="900719925474099312345";input.events[1].grossReturn=value;
 const rows=records(rehearsalReferenceCsv(workspace(input),"DAT:settle-one"));
 assert.equal(rows[1].recordGrossReturnUnits,value);assert.equal(rows[0].grossReturnUnits,value);
 assert.equal(rows[0].realizedPnlUnits,(BigInt(value)-102000000n).toString());
});
test("rejected attempts retain their recorded context but do not inflate lifecycle amounts",()=>{
 const input=rehearsalExampleV2(),bad={...input.events[0],id:"wrong-context",account:"0x"+"9".repeat(40)};
 const rows=records(rehearsalReferenceCsv(workspace({...input,events:[bad,...input.events]}),"DAT:wrong-context"));
 assert.equal(rows.length,3);assert.equal(rows[0].withinEnteredLimits,"false");assert.equal(rows[0].reasons,"WRONG_ACCOUNT");
 assert.equal(rows[0].eventAccount,bad.account);assert.equal(rows[0].account,input.account);assert.equal(rows[0].acceptedRecords,"2");
 assert.equal(rows[0].rejectedRecords,"1");assert.equal(rows[0].totalFeeUnits,"2000000");
 assert.throws(()=>rehearsalReferenceCsv(workspace(input),"DAT:missing"));
});
