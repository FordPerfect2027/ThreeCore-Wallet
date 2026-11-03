import { rehearsalExampleV2 } from "../../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../../src/operation-rehearsal-workspace.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "../../src/operation-rehearsal-scenario-set.js";
export function capacityLedger(agent, count=200) {
  const source=rehearsalExampleV2(agent,"deposit");
  return {...source,events:Array.from({length:count},(_,i)=>({...source.events[0],id:"deposit-"+i,amount:"1"}))};
}
export function capacityWorkspace(count=200) {
  return {schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",
    ledgers:["DAT","EMA","CAWELON"].map(agent=>capacityLedger(agent,count))};
}
export function capacityCases(count=100) {
  const ledgers=["DAT","EMA","CAWELON"].map(agent=>capacityLedger(agent,count));
  return {schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,
    cases:Array.from({length:12},(_,i)=>({id:"capacity-"+i,label:"容量確認 "+i,
      before:ledgers[i%3],after:{...ledgers[i%3],openingBalance:"1000000001"}}))};
}
