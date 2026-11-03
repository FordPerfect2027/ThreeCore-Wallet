import { validateRehearsal, evaluateRehearsal, encodeRehearsal, RehearsalError } from "./operation-rehearsal.js";

/** In-memory append/undo only. Reviews are bound to the exact unchanged ledger. */
export function createRehearsalLedger() {
  let current = null, review = null, history = [], disposed = false, revision = 0;
  const fail = code => { throw new RehearsalError(code); };
  function active() { if (disposed) fail("LEDGER_DISPOSED"); }
  function capture(input) {
    const data = validateRehearsal(input);
    encodeRehearsal(data); // Never accept a state that cannot fit its own saved file.
    evaluateRehearsal(data);
    return data;
  }
  function cancel() { revision++; review = null; }
  function reset(input) {
    active(); cancel();
    const own = revision;
    const next = capture(input);
    if (disposed || revision !== own) fail("STALE_REVIEW");
    current = next; history = [];
    return current;
  }
  function clear() { cancel(); current = null; history = []; }
  function preview(event) {
    active(); cancel();
    if (!current) fail("NO_LEDGER");
    const own = revision, base = current;
    const next = capture({ ...base, events: [...base.events, event] });
    if (disposed || revision !== own || current !== base) fail("STALE_REVIEW");
    const result = evaluateRehearsal(next);
    review = Object.freeze({ before: evaluateRehearsal(current), after: result,
      event: next.events.at(-1), accepted: result.rows.at(-1).withinEnteredLimits,
      reasons: result.rows.at(-1).reasons, document: next });
    return review;
  }
  function commit(candidate) {
    active();
    if (!review || candidate !== review) fail("STALE_REVIEW");
    const next = review.document; cancel();
    history.push(current); if (history.length > 10) history.shift();
    current = next;
    return current;
  }
  function undo() {
    active(); cancel();
    if (!history.length) fail("NO_UNDO");
    current = history.pop(); return current;
  }
  return Object.freeze({ reset, clear, preview, commit, undo, cancel,
    state: () => Object.freeze({ current, canUndo: history.length > 0, undoCount: history.length, hasReview: review !== null }),
    dispose() { clear(); disposed = true; } });
}

/** Text-only CSV from validated inputs; never trust imported derived results. */
export function rehearsalCsv(input) {
  const data = validateRehearsal(input), report = evaluateRehearsal(data);
  // Every string is strictly validated or generated; defensive prefix also protects spreadsheet formulas.
  const cell = value => '"' + String(value).replace(/^[=+@\t\r]/, "'$&").replaceAll('"', '""') + '"';
  const fields = ["simulationOnly", "sourceVerified", "authorizesExecution", "agent", "chainId", "account",
    "asset", "decimals", "id", "kind", "accepted", "reasons", "cashUnits", "outstandingUnits",
    "realizedPnlUnits", "reservedExitFeeUnits", "reservedAllocationUnits", "availableCashUnits"];
  const lines = [fields];
  for (const row of report.rows) lines.push([true, false, false, data.agent, data.chainId, data.account,
    data.asset.symbol, data.asset.decimals, row.id, row.kind, row.withinEnteredLimits, row.reasons.join("|"),
    row.cash, row.outstanding, row.realizedPnl, row.reservedExitFees, row.reservedAllocations, row.availableCash]);
  return lines.map(line => line.map(cell).join(",")).join("\r\n") + "\r\n";
}
