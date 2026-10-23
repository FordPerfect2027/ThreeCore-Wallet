import { reconciliationFail, reconciliationShape, reconciliationAgent } from "./reconciliation-model.js";
import { reconcileWorkspace } from "./reconciliation-engine.js";

export const RECONCILIATION_PAGE_SIZE = 25;
export const RECONCILIATION_DIRECTIONS = Object.freeze(["all", "incoming", "outgoing", "self", "mint", "burn"]);

export function validateReconciliationQuery(input) {
  reconciliationShape(input, ["agent", "direction", "search", "page"]);
  if (input.agent !== "all") reconciliationAgent(input.agent);
  if (!RECONCILIATION_DIRECTIONS.includes(input.direction)) reconciliationFail("RECONCILIATION_QUERY");
  if (typeof input.search !== "string" || input.search.length > 160 || /[\u0000-\u001f\u007f]/.test(input.search) ||
      !Number.isSafeInteger(input.page) || input.page < 0 || input.page > 720) reconciliationFail("RECONCILIATION_QUERY");
  return Object.freeze({ ...input, search: input.search.trim().toLowerCase() });
}

export function queryReconciliationEvents(input, queryInput) {
  const report = reconcileWorkspace(input);
  const query = validateReconciliationQuery(queryInput);
  const matching = report.slots.filter(row => query.agent === "all" || row.agent === query.agent)
    .flatMap(row => row.events.map(event => ({ ...event, agent: row.agent, account: row.account, chainId: row.chainId,
      decimals: row.totals.decimals, symbol: row.totals.symbol, status: row.status })))
    .filter(event => query.direction === "all" || event.direction === query.direction)
    .filter(event => !query.search || [event.transactionHash, event.blockHash, event.from, event.to, event.blockNumber]
      .some(value => value.toLowerCase().includes(query.search)));
  // Token order remains DAT/EMA/CAWELON, then chronological chain order within each.
  const pages = Math.max(1, Math.ceil(matching.length / RECONCILIATION_PAGE_SIZE));
  const page = Math.min(query.page, pages - 1);
  return Object.freeze({
    query,
    page,
    pages,
    total: matching.length,
    rows: Object.freeze(matching.slice(page * RECONCILIATION_PAGE_SIZE, (page + 1) * RECONCILIATION_PAGE_SIZE).map(Object.freeze)),
    includesUnverifiedHistory: true,
  });
}

/** Suggest bounded reads for gaps without requesting a wallet or performing RPC. */
export function suggestReconciliationWindows(input, agent, maximum = 12) {
  reconciliationAgent(agent);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 12) reconciliationFail("RECONCILIATION_WINDOW_LIMIT");
  const row = reconcileWorkspace(input).slots.find(slot => slot.agent === agent);
  const gaps = row.coverage?.gaps ?? [];
  const windows = [];
  let total = 0n;
  let planned = 0n;
  for (const gap of gaps) {
    let cursor = BigInt(gap.fromBlock);
    const end = BigInt(gap.toBlock);
    total += end - cursor + 1n;
    while (cursor <= end && windows.length < maximum) {
      const to = cursor + 1999n < end ? cursor + 1999n : end;
      windows.push(Object.freeze({ fromBlock: cursor.toString(), toBlock: to.toString() }));
      planned += to - cursor + 1n;
      cursor = to + 1n;
    }
  }
  return Object.freeze({
    agent,
    available: row.coverage !== null,
    windows: Object.freeze(windows),
    plannedBlocks: planned.toString(),
    remainingBlocks: (total - planned).toString(),
    requiresManualRead: true,
  });
}
