import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExample, rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { buildRehearsalScenario, compareRehearsalScenario, encodeRehearsalScenario,
  rehearsalScenarioParameters, REHEARSAL_SCENARIO_LIMIT } from "../src/operation-rehearsal-scenario.js";
import { encodeRehearsal, decodeRehearsal } from "../src/operation-rehearsal.js";
const mutable = (agent="DAT", scenario="profit") => JSON.parse(JSON.stringify(rehearsalExampleV2(agent,scenario)));
const build = (source, changes) => buildRehearsalScenario(source,{...rehearsalScenarioParameters(source),...changes});
const compare = (source, changes) => compareRehearsalScenario(source,build(source,changes));

test("unchanged conditions produce exact zero deltas and no changed records",()=>{
  const source=mutable(), report=compare(source,{});
  assert.equal(report.summary.changedParameters,0); assert.equal(report.summary.changedRecords,0);
  assert.ok(report.metrics.every(row=>row.delta==="0"));
  assert.deepEqual(report.inputs.before,report.inputs.after);
});
test("lowering a limit replays dependent settlement and reservation, without changing the source",()=>{
  const source=mutable(); source.events.push({id:"reserve",kind:"reserve",agent:source.agent,chainId:source.chainId,
    account:source.account,reservationId:"reward",amount:"2800000"});
  const saved=JSON.stringify(source), report=compare(source,{maxPerOperation:"50000000"});
  assert.equal(JSON.stringify(source),saved); assert.equal(report.summary.newlyRejected,3);
  assert.ok(report.rows[0].after.reasons.includes("PER_OPERATION_LIMIT"));
  assert.ok(report.rows[1].after.reasons.includes("NO_OPEN_POSITION"));
  assert.ok(report.rows[2].after.reasons.includes("REJECTED_RECORDS"));
  assert.equal(report.metrics.find(row=>row.field==="realizedPnl").delta,"-28000000");
  assert.equal(report.metrics.find(row=>row.field==="reservedAllocations").after,"0");
});
test("changed reasons are retained even when a record remains rejected",()=>{
  const source=mutable("DAT","limit"), report=compare(source,{paused:true});
  assert.equal(report.rows[0].before.withinEnteredLimits,false); assert.equal(report.rows[0].after.withinEnteredLimits,false);
  assert.equal(report.rows[0].decisionChanged,true); assert.ok(report.rows[0].after.reasons.includes("PAUSED"));
});
test("loosening one hypothetical condition can accept a previously rejected open and dependent settlement",()=>{
  const source=mutable(); source.policy.maxPerOperation="50000000";
  const report=compare(source,{maxPerOperation:"100000000"});
  assert.equal(report.summary.newlyAccepted,2); assert.equal(report.summary.afterRejected,0);
  assert.equal(report.authorizesExecution,false);
});
test("opening balance differences remain exact above Number precision and do not invent P&L",()=>{
  const source=mutable(); source.openingBalance="9007199254740993000000";
  const report=compare(source,{openingBalance:"9007199254740993000001"});
  assert.equal(report.metrics.find(row=>row.field==="cash").delta,"1");
  assert.equal(report.metrics.find(row=>row.field==="realizedPnl").delta,"0");
  assert.equal(report.rows[0].accountingChanged,true); assert.equal(report.rows[0].decisionChanged,false);
});
for (const [field,value,reason] of [["maxOutstanding","50000000","OUTSTANDING_LIMIT"],
  ["reserveFloor","950000000","RESERVE_FLOOR"],["lossLimit","50000000","LOSS_LIMIT"],
  ["maxEntryFee","0","ENTRY_FEE_LIMIT"],["maxExitFee","0","EXIT_FEE_LIMIT"],["paused",true,"PAUSED"]])
  test(field+" affects the replayed decision",()=>{
    const report=compare(mutable(),{[field]:value}); assert.ok(report.rows[0].after.reasons.includes(reason));
  });
test("allocation percentages change the available budget without affecting identity, events or profit",()=>{
  const report=compare(mutable(),{buybackBps:500});
  assert.equal(report.metrics.find(row=>row.field==="proposedOwnTokenBuybackBudget").after,"1400000");
  assert.deepEqual(report.inputs.before.events,report.inputs.after.events);
  assert.equal(report.metrics.find(row=>row.field==="realizedPnl").delta,"0");
});
test("a lower allocation quota can reject a historical reservation in a whole-history replay",()=>{
  const source=mutable(); source.events.push({id:"reserve",kind:"reserve",agent:source.agent,chainId:source.chainId,
    account:source.account,reservationId:"reward",amount:"2800000"});
  const report=compare(source,{buybackBps:500});
  assert.ok(report.rows[2].after.reasons.includes("ALLOCATION_LIMIT"));
  assert.equal(report.metrics.find(row=>row.field==="reservedAllocations").after,"0");
  // A replay starts at record one; it does not retroactively relabel a live reservation.
});
test("v1 remains v1 and unsupported fee limits are null, never invented",()=>{
  const source=rehearsalExample(); const values=rehearsalScenarioParameters(source);
  assert.equal(values.maxEntryFee,null); assert.equal(values.maxExitFee,null);
  const report=compare(source,{reserveFloor:"100000000"}); assert.equal(report.inputs.after.schema,source.schema);
  assert.equal(Object.hasOwn(report.inputs.after.policy,"maxEntryFee"),false);
  assert.throws(()=>build(source,{maxEntryFee:"1"}),{code:"UNSUPPORTED_SCENARIO_FEES"});
});
for (const mutation of [d=>{d.account="0x"+"9".repeat(40);},d=>{d.chainId=8453;},d=>{d.agent="EMA";},
  d=>{d.asset.address="0x"+"8".repeat(40);},d=>{d.asset.decimals=5;},d=>{d.asset.symbol="OTHER";},
  d=>{d.policy.origin="https://other.example";},d=>{d.policy.spender="0x"+"7".repeat(40);},
  d=>{d.events[0].fee="0";},d=>{d.events.reverse();},d=>{d.events.pop();}])
  test("comparison refuses a changed context or event: "+mutation.toString(),()=>{
    const source=mutable(), after=mutable(); mutation(after);
    assert.throws(()=>compareRehearsalScenario(source,after),{code:"SCENARIO_CONTEXT_OR_EVENTS_CHANGED"});
  });
test("parameters reject unknown fields, getters, invalid amounts and out-of-range percentages",()=>{
  const source=mutable(), values={...rehearsalScenarioParameters(source)}; let invoked=false;
  Object.defineProperty(values,"openingBalance",{get(){invoked=true;return "0";}});
  assert.throws(()=>buildRehearsalScenario(source,values)); assert.equal(invoked,false);
  assert.throws(()=>build(source,{account:"0x"+"9".repeat(40)}));
  for(const changes of [{buybackBps:10001},{buybackBps:-1},{openingBalance:"-1"},{maxPerOperation:"1.2"},{paused:"true"}])
    assert.throws(()=>build(source,changes));
});
test("source and result are immutable detached snapshots",()=>{
  const source=mutable(), report=compare(source,{buybackBps:0}); source.events[0].fee="999";
  assert.equal(report.inputs.before.events[0].fee,"1000000");
  assert.throws(()=>{report.rows[0].after.reasons.push("FAKE");},TypeError);
  assert.equal(report.sourceVerified,false); assert.equal(report.hypotheticalReplay,true);
});
test("empty ledgers compare without asserting that an event was checked",()=>{
  const source=mutable(); source.events=[]; const report=compare(source,{openingBalance:"1"});
  assert.equal(report.rows.length,0); assert.equal(report.summary.changedRecords,0);
  assert.equal(report.metrics.find(row=>row.field==="cash").after,"1");
});
test("reports are deterministic and cannot be imported as rehearsal input",()=>{
  const source=mutable(), after=build(source,{buybackBps:500});
  const text=encodeRehearsalScenario(source,after);
  assert.equal(text,encodeRehearsalScenario(JSON.parse(encodeRehearsal(source)),after));
  assert.throws(()=>decodeRehearsal(text));
});
test("all 200 records survive report export within the size bound",()=>{
  const source=mutable(); source.events=Array.from({length:200},(_,i)=>({id:"deposit-"+i,kind:"deposit",
    agent:source.agent,chainId:source.chainId,account:source.account,amount:"1"}));
  const text=encodeRehearsalScenario(source,build(source,{openingBalance:"1"}));
  assert.equal(JSON.parse(text).rows.length,200); assert.ok(Buffer.byteLength(text)<REHEARSAL_SCENARIO_LIMIT);
});
