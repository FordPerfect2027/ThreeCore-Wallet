import { periodShape, periodFail } from "./period-plan.js";
import { libraryMetadata } from "./period-library-model.js";

export function libraryQuery(input = {}) {
  if (!input || typeof input !== "object") periodFail("PERIOD_LIBRARY_QUERY");
  periodShape(input, Object.keys(input));
  const query = { agent: "all", archive: "active", status: "all", search: "", order: "newest", ...input };
  periodShape(query, ["agent", "archive", "status", "search", "order"]);
  if (!["all", "DAT", "EMA", "CAWELON"].includes(query.agent) ||
      !["active", "archived", "all"].includes(query.archive) ||
      !["all", "partial", "complete", "blocked"].includes(query.status) ||
      !["newest", "oldest", "name", "progress"].includes(query.order)) periodFail("PERIOD_LIBRARY_QUERY");
  if (typeof query.search !== "string" || query.search.length > 100 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(query.search)) periodFail("PERIOD_LIBRARY_QUERY");
  return Object.freeze({ ...query, search: query.search.trim() });
}

/** Filters operate on metadata, with amounts deliberately absent. */
export function queryPeriodLibrary(input, options) {
  const metadata = libraryMetadata(input), query = libraryQuery(options);
  const search = query.search.toLowerCase();
  const rows = metadata.entries.filter(entry => {
    if (query.agent !== "all" && entry.context.agent !== query.agent) return false;
    if (query.archive !== "all" && entry.archived !== (query.archive === "archived")) return false;
    if (query.status !== "all" && entry.status !== query.status) return false;
    return !search || [entry.label, entry.id, entry.context.agent, entry.context.account,
      String(entry.context.chainId), entry.earlierBlock, entry.laterBlock].some(value => value.toLowerCase().includes(search));
  });
  rows.sort((left, right) => {
    let difference = 0;
    if (query.order === "newest") difference = right.updatedAt.localeCompare(left.updatedAt);
    if (query.order === "oldest") difference = left.updatedAt.localeCompare(right.updatedAt);
    if (query.order === "name") difference = left.label.localeCompare(right.label);
    if (query.order === "progress") difference = (right.completed / right.total) - (left.completed / left.total);
    return difference || left.id.localeCompare(right.id);
  });
  return Object.freeze({ query, revision: metadata.revision, total: metadata.count,
    matched: rows.length, rows: Object.freeze(rows) });
}

export function summarizePeriodLibrary(input) {
  const metadata = libraryMetadata(input);
  const agents = ["DAT", "EMA", "CAWELON"].map(agent => {
    const rows = metadata.entries.filter(entry => entry.context.agent === agent);
    return Object.freeze({ agent, count: rows.length, active: rows.filter(row => !row.archived).length,
      archived: rows.filter(row => row.archived).length,
      partial: rows.filter(row => row.status === "partial").length,
      complete: rows.filter(row => row.status === "complete").length,
      blocked: rows.filter(row => row.status === "blocked").length,
      contexts: new Set(rows.map(row => row.context.chainId + ":" + row.context.account)).size });
  });
  return Object.freeze({ count: metadata.count, remaining: metadata.remaining, bytes: metadata.bytes,
    agents: Object.freeze(agents), automaticallyMerged: false, eventCountsAreUnique: false });
}

function cell(value) {
  let text = String(value);
  if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function periodLibraryCSV(input, options) {
  const result = queryPeriodLibrary(input, options);
  const header = ["id", "label", "token", "chain", "account", "start_block", "end_block", "status",
    "completed_steps", "total_steps", "events_in_record", "archived", "created_at", "updated_at"];
  const rows = result.rows.map(row => [row.id, row.label, row.context.agent, row.context.chainId,
    row.context.account, row.earlierBlock, row.laterBlock, row.status, row.completed, row.total,
    row.events, row.archived, row.createdAt, row.updatedAt]);
  return Object.freeze({ text: [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n",
    filename: "ThreeCore-period-library-index.csv", mimeType: "text/csv;charset=utf-8",
    rows: rows.length, includesPublicAccounts: true, containsBalances: false });
}
