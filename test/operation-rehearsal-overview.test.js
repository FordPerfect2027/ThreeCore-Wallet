import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExample, rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA, decodeRehearsalWorkspace } from "../src/operation-rehearsal-workspace.js";
import { reportRehearsalOverview, filterRehearsalOverview, encodeRehearsalOverview, REHEARSAL_OVERVIEW_LIMIT } from "../src/operation-rehearsal-overview.js";

const workspace = (...ledgers) => ({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent: "DAT", ledgers });
const mutable = (agent = "DAT", scenario = "profit") => JSON.parse(JSON.stringify(rehearsalExampleV2(agent, scenario)));
const event = (data, extra) => ({ agent: data.agent, chainId: data.chainId, account: data.account, ...extra });

test("current positions exclude settled and rejected opens, and point to accepted source records", () => {
  const pending = mutable("CAWELON", "pending");
  pending.events.unshift({ ...pending.events[0], id: "bad-context", account: "0x" + "9".repeat(40) });
  const report = reportRehearsalOverview(workspace(mutable(), pending));
  assert.equal(report.rows[0].openPositions, 0);
  assert.equal(report.rows[2].openPositions, 1);
  const [position, rejected] = report.rows[2].entries;
  assert.equal(position.recordNumber, 2); assert.equal(position.recordId, "open-one");
  assert.equal(position.amount, "100000000"); assert.equal(position.exitFeeReserve, "2000000");
  assert.equal(rejected.recordNumber, 1); assert.deepEqual(rejected.reasons, ["WRONG_ACCOUNT"]);
  assert.equal(rejected.amount, null); assert.equal(rejected.eventContext.account, "0x" + "9".repeat(40));
});
test("missing and present zero-record ledgers remain different", () => {
  const data = mutable(); data.events = [];
  const report = reportRehearsalOverview(workspace(data));
  assert.equal(report.rows[0].recordCount, 0); assert.equal(report.rows[0].openPositions, 0);
  assert.equal(report.rows[1].recordCount, null); assert.equal(report.rows[1].context, null);
  assert.equal(report.rows[1].openPositions, null);
});
test("released reservations disappear, while shortfall after later loss remains explicit", () => {
  const data = mutable();
  data.events.push(event(data,{ id:"reserve-a",kind:"reserve",reservationId:"a",amount:"1000000" }),
    event(data,{ id:"release-a",kind:"release",reservationId:"a" }),
    event(data,{ id:"reserve-b",kind:"reserve",reservationId:"b",amount:"2800000" }),
    { ...data.events[0],id:"open-two",operationId:"two" },
    { ...data.events[1],id:"settle-two",operationId:"two",grossReturn:"60000000" });
  const row = reportRehearsalOverview(workspace(data)).rows[0];
  assert.equal(row.reservations,1); assert.equal(row.allocationShortfall,"2800000");
  assert.equal(row.entries.length,1); assert.equal(row.entries[0].id,"b");
  assert.equal(row.entries[0].recordNumber,5);
});
test("rejected records retain every reason and the correct source operation", () => {
  const data = mutable("EMA","limit");
  const row = reportRehearsalOverview(workspace(data)).rows[1];
  assert.ok(row.rejectedRecords > 0); assert.ok(row.entries[0].reasons.includes("PER_OPERATION_LIMIT"));
  assert.equal(row.entries[0].operationId,data.events[0].operationId);
  assert.equal(row.context.account,data.account); assert.equal(row.context.asset.address,data.asset.address);
});
test("filters preserve agent identity when identical operation IDs exist across ledgers", () => {
  const report = reportRehearsalOverview(workspace(mutable("DAT","pending"),mutable("EMA","pending")));
  const all = filterRehearsalOverview(report); assert.equal(all.length,2);
  assert.notEqual(all[0].context.account,all[1].context.account);
  assert.equal(filterRehearsalOverview(report,"EMA","position").length,1);
  assert.equal(filterRehearsalOverview(report,"all","rejected").length,0);
  assert.equal(filterRehearsalOverview(report,"CAWELON").length,0);
  for(const args of [["invalid","all"],["all","open"],[null,"all"]])
    assert.throws(()=>filterRehearsalOverview(report,...args),/INVALID_OVERVIEW_FILTER/);
});
test("v1 inputs stay v1 and are not silently upgraded", () => {
  const input = rehearsalExample("DAT","pending");
  const report = reportRehearsalOverview(workspace(input));
  assert.equal(report.inputs.ledgers[0].schema,input.schema);
  assert.equal(report.rows[0].context.schema,input.schema);
  assert.equal(report.rows[0].reservations,0);
});
test("reports are immutable and detach from caller mutation, with no authority or cross-asset totals", () => {
  const data = mutable("DAT","pending"); const report = reportRehearsalOverview(workspace(data));
  data.events[0].principal = "1";
  assert.equal(report.rows[0].entries[0].amount,"100000000");
  assert.equal(report.sourceVerified,false); assert.equal(report.authorizesExecution,false);
  assert.equal(report.total,undefined);
  assert.throws(()=>{report.rows[0].entries[0].amount="1";},TypeError);
  assert.throws(()=>{report.rows[0].context.asset.address="changed";},TypeError);
});
test("export includes complete canonical inputs and is deterministic; it is not a restore file", () => {
  const data = workspace(mutable("DAT","pending"),mutable("EMA","loss"));
  const text = encodeRehearsalOverview(data);
  const reversed = Object.fromEntries(Object.entries(data).reverse());
  assert.equal(encodeRehearsalOverview(reversed),text);
  assert.deepEqual(JSON.parse(text).inputs,JSON.parse(JSON.stringify(reportRehearsalOverview(data).inputs)));
  assert.throws(()=>decodeRehearsalWorkspace(text));
});
test("invalid or non-simulation input cannot become a confirmation report", () => {
  assert.throws(()=>reportRehearsalOverview({...workspace(),simulationOnly:false}));
  assert.throws(()=>reportRehearsalOverview(workspace(mutable(),mutable())));
  const data = workspace(mutable()); let invoked=false;
  Object.defineProperty(data,"ledgers",{get(){invoked=true; return [];}});
  assert.throws(()=>reportRehearsalOverview(data)); assert.equal(invoked,false);
});
test("maximum 600 rejected records are retained without truncation or amount coercion", () => {
  const ledgers = ["DAT","EMA","CAWELON"].map(agent=>{
    const data = mutable(agent,"pending");
    data.events = Array.from({length:200},(_,index)=>({...data.events[0],id:"rejected-"+index,
      account:"0x"+"9".repeat(40),principal:"9007199254740993000000"})); return data;
  });
  const text = encodeRehearsalOverview(workspace(...ledgers)), report=JSON.parse(text);
  assert.equal(filterRehearsalOverview(report,"all","rejected").length,600);
  assert.equal(report.inputs.ledgers[0].events[0].principal,"9007199254740993000000");
  assert.ok(Buffer.byteLength(text)<REHEARSAL_OVERVIEW_LIMIT);
});
