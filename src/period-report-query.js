import { periodFail, periodShape } from "./period-plan.js";
import { reportAgent } from "./period-report-model.js";
import { analyzePeriodReport } from "./period-report-engine.js";

export const REPORT_PAGE_SIZE = 25;
export const REPORT_DIRECTIONS = Object.freeze(["all", "incoming", "outgoing", "self"]);

export function validateReportEventQuery(input) {
  periodShape(input, ["agent", "direction", "search", "page"]);
  const agent = reportAgent(input.agent);
  if (!REPORT_DIRECTIONS.includes(input.direction)) periodFail("PERIOD_REPORT_DIRECTION");
  if (typeof input.search !== "string" || input.search.length > 100 ||
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(input.search)) periodFail("PERIOD_REPORT_SEARCH");
  if (!Number.isSafeInteger(input.page) || input.page < 0) periodFail("PERIOD_REPORT_PAGE");
  return Object.freeze({ agent, direction: input.direction, search: input.search.trim().toLowerCase(), page: input.page });
}

/** Filters are presentation only: totals and conclusions still describe all original evidence. */
export function queryPeriodReportEvents(input, queryInput) {
  const query = validateReportEventQuery(queryInput), report = analyzePeriodReport(input);
  const slot = report.slots.find(row => row.agent === query.agent);
  const all = slot.arithmetic.events;
  const filtered = all.filter(row => (query.direction === "all" || row.direction === query.direction) &&
    (!query.search || [row.transactionHash, row.from, row.to, row.blockNumber]
      .some(value => value.toLowerCase().includes(query.search))));
  const pages = Math.max(1, Math.ceil(filtered.length / REPORT_PAGE_SIZE));
  const page = Math.min(query.page, pages - 1);
  return Object.freeze({ agent: query.agent, status: slot.status, page, pages,
    pageSize: REPORT_PAGE_SIZE, total: all.length, matched: filtered.length,
    rows: Object.freeze(filtered.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE)),
    totalsAreUnfiltered: true });
}
