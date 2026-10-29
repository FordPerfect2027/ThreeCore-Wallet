import { validateRehearsalWorkspace, encodeRehearsalWorkspace, REHEARSAL_AGENTS,
  REHEARSAL_WORKSPACE_LIMIT } from "./operation-rehearsal-workspace.js";
import { encodeRehearsal, evaluateRehearsal, RehearsalError } from "./operation-rehearsal.js";

export const REHEARSAL_COMPARISON_SCHEMA = "threecore.operation-rehearsal-comparison.v1";
export const REHEARSAL_COMPARISON_LIMIT = REHEARSAL_WORKSPACE_LIMIT * 2 + 65536;
const CONTEXT = ["chainId", "account", "assetAddress", "symbol", "decimals", "origin", "spender", "schema"];
const POLICY = ["openingBalance", "maxPerOperation", "maxOutstanding", "reserveFloor", "lossLimit",
  "buybackBps", "paused", "maxEntryFee", "maxExitFee"];
const MONEY = ["cash", "outstanding", "realizedPnl", "fees", "reservedExitFees", "reservedAllocations",
  "availableCash", "allocationShortfall"];

function summary(data) {
  if (!data) return null;
  const report = evaluateRehearsal(data);
  return Object.freeze({ recordCount: data.events.length,
    context: Object.freeze({ chainId: data.chainId, account: data.account, assetAddress: data.asset.address,
      symbol: data.asset.symbol, decimals: data.asset.decimals, origin: data.policy.origin,
      spender: data.policy.spender, schema: data.schema }),
    policy: Object.freeze(Object.fromEntries(POLICY.map(key => [key,
      key === "openingBalance" ? data.openingBalance : data.policy[key] ?? null]))),
    amounts: Object.freeze(Object.fromEntries(MONEY.map(key => [key, report[key]]))),
    openPositions: report.openPositions,
    rejectedRecords: report.rows.filter(row => !row.withinEnteredLimits).length,
    allocationOvercommitted: report.allocationShortfall !== "0" });
}
function changes(keys, before, after) {
  return Object.freeze(keys.filter(key => (before?.[key] ?? null) !== (after?.[key] ?? null)).map(key => Object.freeze({
    field: key, before: before?.[key] ?? null, after: after?.[key] ?? null })));
}
function events(before, after) {
  const old = new Map((before?.events ?? []).map(event => [event.id, event]));
  const next = new Map((after?.events ?? []).map(event => [event.id, event]));
  return Object.freeze({
    added: Object.freeze([...next.keys()].filter(id => !old.has(id))),
    removed: Object.freeze([...old.keys()].filter(id => !next.has(id))),
    modified: Object.freeze([...next.keys()].filter(id => old.has(id) && JSON.stringify(old.get(id)) !== JSON.stringify(next.get(id)))),
    orderChanged: JSON.stringify([...old.keys()].filter(id => next.has(id))) !==
      JSON.stringify([...next.keys()].filter(id => old.has(id))),
  });
}

/** Compares canonical fictional inputs. No aggregation, value conversion or network verification. */
export function compareRehearsalWorkspaces(beforeInput, afterInput) {
  const before = validateRehearsalWorkspace(beforeInput), after = validateRehearsalWorkspace(afterInput);
  encodeRehearsalWorkspace(before); encodeRehearsalWorkspace(after);
  const rows = REHEARSAL_AGENTS.map(agent => {
    const old = before.ledgers.find(data => data.agent === agent), next = after.ledgers.find(data => data.agent === agent);
    const left = summary(old), right = summary(next);
    const action = !old && !next ? "absent" : !old ? "added" : !next ? "removed" :
      encodeRehearsal(old) === encodeRehearsal(next) ? "unchanged" : "replaced";
    const contextChanges = changes(CONTEXT, left?.context, right?.context);
    return Object.freeze({ agent, action, before: left, after: right, contextChanges,
      policyChanges: changes(POLICY, left?.policy, right?.policy), eventChanges: events(old, next),
      sameAccountingContext: Boolean(left && right &&
        ["chainId", "account", "assetAddress", "symbol", "decimals"].every(key => left.context[key] === right.context[key])) });
  });
  return Object.freeze({ schema: REHEARSAL_COMPARISON_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, comparesCanonicalInputs: true,
    selectedAgentChanged: before.activeAgent !== after.activeAgent,
    inputs: Object.freeze({ before, after }), rows: Object.freeze(rows) });
}
export function encodeRehearsalComparison(before, after) {
  const text = JSON.stringify(compareRehearsalWorkspaces(before, after), null, 2) + "\n";
  if (new TextEncoder().encode(text).length > REHEARSAL_COMPARISON_LIMIT) throw new RehearsalError("FILE_TOO_LARGE");
  return text;
}
