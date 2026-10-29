import { captureDataRecord, captureDataArray } from "./security-data.js";
import { parseSecurityJson } from "./security-json.js";
import { validateRehearsal, encodeRehearsal, evaluateRehearsal, RehearsalError } from "./operation-rehearsal.js";
import { createRehearsalLedger } from "./operation-rehearsal-ledger.js";

export const REHEARSAL_AGENTS = Object.freeze(["DAT", "EMA", "CAWELON"]);
export const REHEARSAL_WORKSPACE_SCHEMA = "threecore.operation-rehearsal-workspace.v1";
export const REHEARSAL_WORKSPACE_LIMIT = 524288;
const fail = code => { throw new RehearsalError(code); };
const agent = value => { if (!REHEARSAL_AGENTS.includes(value)) fail("INVALID_AGENT"); return value; };

export function validateRehearsalWorkspace(input) {
  let root, entries;
  try {
    root = captureDataRecord(input, ["schema", "simulationOnly", "activeAgent", "ledgers"]);
    entries = captureDataArray(root.ledgers, 3);
  } catch { fail("INVALID_WORKSPACE"); }
  if (root.schema !== REHEARSAL_WORKSPACE_SCHEMA || root.simulationOnly !== true) fail("SIMULATION_REQUIRED");
  const activeAgent = agent(root.activeAgent), seen = new Set();
  const ledgers = entries.map(inputLedger => {
    const data = validateRehearsal(inputLedger);
    encodeRehearsal(data); // Each member must remain individually exportable (128 KiB).
    if (seen.has(data.agent)) fail("DUPLICATE_AGENT");
    seen.add(data.agent);
    return data;
  }).sort((a, b) => REHEARSAL_AGENTS.indexOf(a.agent) - REHEARSAL_AGENTS.indexOf(b.agent));
  return Object.freeze({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true,
    activeAgent, ledgers: Object.freeze(ledgers) });
}
export function encodeRehearsalWorkspace(input) {
  const text = JSON.stringify(validateRehearsalWorkspace(input), null, 2) + "\n";
  if (new TextEncoder().encode(text).length > REHEARSAL_WORKSPACE_LIMIT) fail("FILE_TOO_LARGE");
  return text;
}
export function decodeRehearsalWorkspace(text) {
  if (typeof text !== "string" || text.length > REHEARSAL_WORKSPACE_LIMIT ||
      new TextEncoder().encode(text).length > REHEARSAL_WORKSPACE_LIMIT) fail("FILE_TOO_LARGE");
  let input;
  try { input = parseSecurityJson(text); } catch { fail("INVALID_JSON"); }
  return validateRehearsalWorkspace(input);
}
export function reportRehearsalWorkspace(input) {
  const data = validateRehearsalWorkspace(input);
  const rows = REHEARSAL_AGENTS.map(name => {
    const ledger = data.ledgers.find(item => item.agent === name);
    const report = ledger ? evaluateRehearsal(ledger) : null;
    return Object.freeze({ agent: name, present: ledger !== undefined,
      recordCount: ledger ? ledger.events.length : null, report });
  });
  return Object.freeze({ simulationOnly: true, sourceVerified: false, authorizesExecution: false,
    activeAgent: data.activeAgent, presentAgents: data.ledgers.length,
    constraintsSatisfied: data.ledgers.length > 0 && rows.filter(row => row.present).every(row =>
      row.report.rows.every(event => event.withinEnteredLimits) && row.report.allocationShortfall === "0"),
    rows: Object.freeze(rows) }); // No cross-account, cross-chain or cross-asset totals.
}

/** Page-local state only; switching never persists or merges a ledger. */
export function createRehearsalWorkspace(initialAgent = "DAT") {
  let activeAgent = agent(initialAgent), disposed = false, revision = 0, restoreReview = null;
  const fresh = () => new Map(REHEARSAL_AGENTS.map(name => [name, createRehearsalLedger()]));
  let ledgers = fresh();
  const active = () => { if (disposed) fail("WORKSPACE_DISPOSED"); };
  const current = () => ledgers.get(activeAgent);
  function cancel() {
    revision++; restoreReview = null;
    for (const ledger of ledgers.values()) ledger.cancel();
  }
  function snapshot() {
    active();
    return validateRehearsalWorkspace({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true,
      activeAgent, ledgers: [...ledgers.values()].map(ledger => ledger.state().current).filter(Boolean) });
  }
  function select(name) {
    active(); agent(name); cancel(); activeAgent = name;
    return current().state().current;
  }
  function reset(input) {
    active(); cancel(); const own = revision;
    const data = validateRehearsal(input);
    const next = createRehearsalLedger(); next.reset(data);
    if (disposed || revision !== own) { next.dispose(); fail("STALE_REVIEW"); }
    ledgers.get(data.agent).dispose(); ledgers.set(data.agent, next); activeAgent = data.agent;
    return next.state().current;
  }
  function preview(event) {
    active(); cancel(); const own = revision, target = current();
    const review = target.preview(event);
    if (disposed || revision !== own || target !== current()) { target.cancel(); fail("STALE_REVIEW"); }
    return review;
  }
  function previewRestore(input) {
    active(); cancel(); const own = revision;
    const document = validateRehearsalWorkspace(input); encodeRehearsalWorkspace(document);
    if (disposed || revision !== own) fail("STALE_REVIEW");
    restoreReview = Object.freeze({ document, before: reportRehearsalWorkspace(snapshot()),
      after: reportRehearsalWorkspace(document) });
    return restoreReview;
  }
  function restore(review) {
    active();
    if (!restoreReview || review !== restoreReview) fail("STALE_REVIEW");
    const next = fresh();
    for (const data of review.document.ledgers) next.get(data.agent).reset(data);
    const selected = review.document.activeAgent;
    cancel(); for (const ledger of ledgers.values()) ledger.dispose();
    ledgers = next; activeAgent = selected;
    return current().state().current;
  }
  return Object.freeze({ snapshot, select, reset, preview, previewRestore, restore, cancel,
    state: () => Object.freeze({ activeAgent, ...current().state() }),
    commit(review) { active(); revision++; restoreReview = null; return current().commit(review); },
    undo() { active(); cancel(); return current().undo(); },
    clear() { active(); cancel(); current().clear(); },
    dispose() { if (disposed) return; cancel(); for (const ledger of ledgers.values()) ledger.dispose(); disposed = true; } });
}
