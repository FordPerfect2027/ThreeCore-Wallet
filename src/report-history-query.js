import { periodShape, periodFail } from "./period-plan.js";
import { validateReportHistory, REPORT_HISTORY_LIMIT } from "./report-history-model.js";
import { analyzePeriodReport } from "./period-report-engine.js";

export function historyQuery(input = {}) {
  if (!input || typeof input !== "object") periodFail("PERIOD_HISTORY_QUERY");
  periodShape(input, Object.keys(input));
  const query = { archive: "active", status: "all", agent: "all", search: "", tag: "", order: "newest", ...input };
  periodShape(query, ["archive", "status", "agent", "search", "tag", "order"]);
  if (!["active", "archived", "all"].includes(query.archive) ||
      !["all", "arithmetic-agreement", "attention", "incomplete"].includes(query.status) ||
      !["all", "DAT", "EMA", "CAWELON"].includes(query.agent) ||
      !["newest", "oldest", "name", "created"].includes(query.order) ||
      typeof query.tag !== "string" || (query.tag && !/^[a-z0-9][a-z0-9-]{0,23}$/.test(query.tag)) ||
      typeof query.search !== "string" || query.search.length > 100 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(query.search)) periodFail("PERIOD_HISTORY_QUERY");
  return Object.freeze({ ...query, search: query.search.trim().toLowerCase() });
}

/** This index contains no balances or event bodies. Conclusions are recomputed. */
export function reportHistoryIndex(input) {
  const document = validateReportHistory(input);
  const rows = document.entries.map(entry => {
    const report = analyzePeriodReport(entry.report);
    return Object.freeze({ id: entry.id, label: entry.label, note: entry.note, tags: entry.tags,
      savedAt: entry.savedAt, updatedAt: entry.updatedAt, archived: entry.archived,
      reportTitle: entry.report.title, reportCreatedAt: entry.report.createdAt,
      status: report.status, selectedCount: report.selectedCount,
      agents: Object.freeze(report.slots.filter(slot => slot.plan).map(slot => slot.agent)),
      contexts: Object.freeze(report.slots.filter(slot => slot.plan).map(slot => Object.freeze({
        agent: slot.agent, account: slot.plan.context.account, chainId: slot.plan.context.chainId,
        earlierBlock: slot.plan.earlierBlock, laterBlock: slot.plan.laterBlock,
      }))),
      issues: report.issues, warnings: report.warnings });
  });
  return Object.freeze({ revision: document.revision, count: rows.length,
    remaining: REPORT_HISTORY_LIMIT - rows.length,
    bytes: new TextEncoder().encode(JSON.stringify(document)).byteLength,
    active: rows.filter(row => !row.archived).length, archived: rows.filter(row => row.archived).length,
    rows: Object.freeze(rows) });
}

export function queryReportHistory(input, options) {
  const index = reportHistoryIndex(input), query = historyQuery(options);
  const rows = index.rows.filter(row => {
    if (query.archive !== "all" && row.archived !== (query.archive === "archived")) return false;
    if (query.status !== "all" && row.status !== query.status) return false;
    if (query.agent !== "all" && !row.agents.includes(query.agent)) return false;
    if (query.tag && !row.tags.includes(query.tag)) return false;
    const words = [row.id, row.label, row.note, row.reportTitle, ...row.tags,
      ...row.contexts.flatMap(context => [context.agent, context.account, String(context.chainId), context.earlierBlock, context.laterBlock])];
    return !query.search || words.some(value => value.toLowerCase().includes(query.search));
  });
  const sorters = {
    newest: (a, b) => b.savedAt.localeCompare(a.savedAt),
    oldest: (a, b) => a.savedAt.localeCompare(b.savedAt),
    name: (a, b) => a.label.localeCompare(b.label),
    created: (a, b) => b.reportCreatedAt.localeCompare(a.reportCreatedAt),
  };
  rows.sort((a, b) => sorters[query.order](a, b) || a.id.localeCompare(b.id));
  return Object.freeze({ ...index, query, matched: rows.length, rows: Object.freeze(rows) });
}

function cell(value) {
  let text = String(value);
  // Leading whitespace must not hide a spreadsheet formula prefix.
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

/** Filtered catalog only: this is not a recoverable evidence backup. */
export function reportHistoryCSV(input, options) {
  const result = queryReportHistory(input, options);
  const header = ["id", "label", "note", "tags", "archived", "saved_at", "updated_at", "report_created_at",
    "status", "selected_tokens", "issues", "warnings"];
  const rows = result.rows.map(row => [row.id, row.label, row.note, row.tags.join(" "), row.archived,
    row.savedAt, row.updatedAt, row.reportCreatedAt, row.status, row.agents.join(" "), row.issues.join(" "), row.warnings.join(" ")]);
  return Object.freeze({ text: [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n",
    filename: "ThreeCore-report-history-index.csv", mimeType: "text/csv;charset=utf-8",
    rows: result.matched, restorable: false, containsEvidence: false });
}
