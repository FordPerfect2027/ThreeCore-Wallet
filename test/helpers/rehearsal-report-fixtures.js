import { rehearsalExampleV2 } from "../../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../../src/operation-rehearsal-workspace.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "../../src/operation-rehearsal-scenario-set.js";
import { captureRehearsalCheckSuite, runRehearsalCheckSuite } from "../../src/operation-rehearsal-check-suite.js";
import { indexRehearsalRecords, queryRehearsalRecords, REHEARSAL_RECORD_QUERY } from "../../src/operation-rehearsal-records.js";
export function newReportFixtures() {
  const source = rehearsalExampleV2();
  const set = { schema: REHEARSAL_SCENARIO_SET_SCHEMA, simulationOnly: true,
    cases: [{ id: "dat-example", label: "DAT sample", before: source, after: source }] };
  const suite = captureRehearsalCheckSuite(set);
  const manual = JSON.parse(JSON.stringify(suite));
  manual.expectationOrigin = "manually-specified";
  manual.expected[0].after.metrics.cash = "999";
  const inputs = { schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent: "DAT",
    ledgers: [source, rehearsalExampleV2("EMA","loss"), rehearsalExampleV2("CAWELON","pending")] };
  const index = indexRehearsalRecords(inputs);
  return {
    suite, matching: runRehearsalCheckSuite(suite), differing: runRehearsalCheckSuite(manual),
    all: queryRehearsalRecords(index),
    filtered: queryRehearsalRecords(index, { ...REHEARSAL_RECORD_QUERY, agent: "EMA", kind: "settle" }),
    empty: queryRehearsalRecords(index, { ...REHEARSAL_RECORD_QUERY, search: "missing" })
  };
}
