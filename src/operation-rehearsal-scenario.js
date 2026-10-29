import { captureDataRecord } from "./security-data.js";
import { validateRehearsal, encodeRehearsal, evaluateRehearsal, REHEARSAL_SCHEMA_V2, RehearsalError } from "./operation-rehearsal.js";

export const REHEARSAL_SCENARIO_SCHEMA = "threecore.operation-rehearsal-scenario.v1";
export const REHEARSAL_SCENARIO_LIMIT = 2097152;
export const REHEARSAL_SCENARIO_FIELDS = Object.freeze(["openingBalance", "maxPerOperation", "maxOutstanding",
  "reserveFloor", "lossLimit", "buybackBps", "paused", "maxEntryFee", "maxExitFee"]);
export const REHEARSAL_SCENARIO_METRICS = Object.freeze(["cash", "outstanding", "realizedPnl", "fees",
  "reservedExitFees", "reservedAllocations", "availableCash", "allocationShortfall", "proposedOwnTokenBuybackBudget"]);
const ROW_AMOUNTS = ["cash", "outstanding", "realizedPnl", "pnlChange", "reservedExitFees", "reservedAllocations", "availableCash"];
const fail = code => { throw new RehearsalError(code); };

export function rehearsalScenarioParameters(input) {
  const data = validateRehearsal(input);
  return Object.freeze(Object.fromEntries(REHEARSAL_SCENARIO_FIELDS.map(field => [field,
    field === "openingBalance" ? data.openingBalance : data.policy[field] ?? null])));
}

/** Same events and identity; only explicitly named hypothetical conditions can change. */
export function buildRehearsalScenario(input, parameters) {
  const before = validateRehearsal(input); encodeRehearsal(before);
  let captured;
  try { captured = captureDataRecord(parameters, REHEARSAL_SCENARIO_FIELDS); } catch { fail("INVALID_SCENARIO_PARAMETERS"); }
  const extended = before.schema === REHEARSAL_SCHEMA_V2;
  if (!extended && (captured.maxEntryFee !== null || captured.maxExitFee !== null)) fail("UNSUPPORTED_SCENARIO_FEES");
  const policy = { ...before.policy };
  for (const field of REHEARSAL_SCENARIO_FIELDS) {
    if (field === "openingBalance" || (!extended && ["maxEntryFee", "maxExitFee"].includes(field))) continue;
    policy[field] = captured[field];
  }
  const after = validateRehearsal({ ...before, openingBalance: captured.openingBalance, policy });
  encodeRehearsal(after);
  return after;
}

export function compareRehearsalScenario(beforeInput, afterInput) {
  const before = validateRehearsal(beforeInput), after = validateRehearsal(afterInput);
  const expected = buildRehearsalScenario(before, rehearsalScenarioParameters(after));
  if (encodeRehearsal(expected) !== encodeRehearsal(after)) fail("SCENARIO_CONTEXT_OR_EVENTS_CHANGED");
  const old = evaluateRehearsal(before), next = evaluateRehearsal(after);
  const oldParameters = rehearsalScenarioParameters(before), nextParameters = rehearsalScenarioParameters(after);
  const parameters = REHEARSAL_SCENARIO_FIELDS.map(field => Object.freeze({ field,
    before: oldParameters[field], after: nextParameters[field], changed: oldParameters[field] !== nextParameters[field] }));
  const metrics = REHEARSAL_SCENARIO_METRICS.map(field => Object.freeze({ field, before: old[field], after: next[field],
    delta: (BigInt(next[field]) - BigInt(old[field])).toString() }));
  const rows = old.rows.map((row, index) => {
    const candidate = next.rows[index];
    const decisionChanged = row.withinEnteredLimits !== candidate.withinEnteredLimits ||
      JSON.stringify(row.reasons) !== JSON.stringify(candidate.reasons);
    const accountingChanged = ROW_AMOUNTS.some(key => row[key] !== candidate[key]);
    return Object.freeze({ recordNumber: index + 1, id: row.id, kind: row.kind,
      before: row, after: candidate, decisionChanged, accountingChanged, changed: decisionChanged || accountingChanged });
  });
  return Object.freeze({ schema: REHEARSAL_SCENARIO_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, hypotheticalReplay: true,
    inputs: Object.freeze({ before, after }), parameters: Object.freeze(parameters), metrics: Object.freeze(metrics),
    rows: Object.freeze(rows), summary: Object.freeze({ changedParameters: parameters.filter(row => row.changed).length,
      changedRecords: rows.filter(row => row.changed).length,
      newlyRejected: rows.filter(row => row.before.withinEnteredLimits && !row.after.withinEnteredLimits).length,
      newlyAccepted: rows.filter(row => !row.before.withinEnteredLimits && row.after.withinEnteredLimits).length,
      changedReasons: rows.filter(row => row.decisionChanged).length,
      beforeOpenPositions: old.openPositions, afterOpenPositions: next.openPositions,
      beforeRejected: old.rows.filter(row => !row.withinEnteredLimits).length,
      afterRejected: next.rows.filter(row => !row.withinEnteredLimits).length,
      beforeAllocationBlockers: old.allocationBlockers, afterAllocationBlockers: next.allocationBlockers }) });
}

export function encodeRehearsalScenario(before, after) {
  const text = JSON.stringify(compareRehearsalScenario(before, after), null, 2) + "\n";
  if (new TextEncoder().encode(text).length > REHEARSAL_SCENARIO_LIMIT) fail("FILE_TOO_LARGE");
  return text;
}
