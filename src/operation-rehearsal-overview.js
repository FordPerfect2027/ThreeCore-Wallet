import { validateRehearsalWorkspace, encodeRehearsalWorkspace, REHEARSAL_AGENTS } from "./operation-rehearsal-workspace.js";
import { evaluateRehearsal, RehearsalError } from "./operation-rehearsal.js";

export const REHEARSAL_OVERVIEW_SCHEMA = "threecore.operation-rehearsal-overview.v1";
export const REHEARSAL_OVERVIEW_LIMIT = 2097152;
export const REHEARSAL_OVERVIEW_KINDS = Object.freeze(["position", "reservation", "rejected"]);

/** Derive current open items from canonical inputs, never from saved computed results. */
export function reportRehearsalOverview(input) {
  const inputs = validateRehearsalWorkspace(input);
  encodeRehearsalWorkspace(inputs);
  const rows = REHEARSAL_AGENTS.map(agent => {
    const data = inputs.ledgers.find(item => item.agent === agent);
    if (!data) return Object.freeze({ agent, present: false, recordCount: null, context: null,
      openPositions: null, reservations: null, rejectedRecords: null, allocationShortfall: null,
      entries: Object.freeze([]) });
    const report = evaluateRehearsal(data);
    const context = Object.freeze({ chainId: data.chainId, account: data.account, asset: data.asset,
      origin: data.policy.origin, spender: data.policy.spender, schema: data.schema });
    const entry = (kind, index, id, amount = null, exitFeeReserve = null) => {
      const event = data.events[index];
      return Object.freeze({ kind, id, recordId: event.id, recordNumber: index + 1,
        eventKind: event.kind, operationId: event.operationId ?? null, reservationId: event.reservationId ?? null,
        eventContext: Object.freeze({ agent: event.agent, chainId: event.chainId, account: event.account }),
        amount, exitFeeReserve, reasons: report.rows[index].reasons });
    };
    const entries = [
      ...report.positions.map(position => entry("position", data.events.findIndex((event, index) =>
        event.kind === "open" && event.operationId === position.operationId && report.rows[index].withinEnteredLimits),
      position.operationId, position.principal, position.exitFeeReserve)),
      ...report.reservations.map(reservation => entry("reservation", data.events.findIndex((event, index) =>
        event.kind === "reserve" && event.reservationId === reservation.reservationId && report.rows[index].withinEnteredLimits),
      reservation.reservationId, reservation.amount)),
      ...report.rows.flatMap((row, index) => row.withinEnteredLimits ? [] : [entry("rejected", index, row.id)]),
    ];
    return Object.freeze({ agent, present: true, recordCount: data.events.length, context,
      openPositions: report.openPositions, reservations: report.reservations.length,
      rejectedRecords: report.rows.filter(row => !row.withinEnteredLimits).length,
      allocationShortfall: report.allocationShortfall, entries: Object.freeze(entries) });
  });
  return Object.freeze({ schema: REHEARSAL_OVERVIEW_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, inputs, rows: Object.freeze(rows) });
}

/** Filters only presentation; exports always contain all three agents and the full inputs. */
export function filterRehearsalOverview(report, agent = "all", kind = "all") {
  if (!["all", ...REHEARSAL_AGENTS].includes(agent) || !["all", ...REHEARSAL_OVERVIEW_KINDS].includes(kind))
    throw new RehearsalError("INVALID_OVERVIEW_FILTER");
  return Object.freeze(report.rows.filter(row => agent === "all" || row.agent === agent).flatMap(row =>
    row.entries.filter(item => kind === "all" || item.kind === kind).map(item => Object.freeze({ agent: row.agent,
      context: row.context, ...item }))));
}

export function encodeRehearsalOverview(input) {
  const text = JSON.stringify(reportRehearsalOverview(input), null, 2) + "\n";
  if (new TextEncoder().encode(text).length > REHEARSAL_OVERVIEW_LIMIT) throw new RehearsalError("FILE_TOO_LARGE");
  return text;
}
