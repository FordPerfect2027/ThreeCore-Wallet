import { periodShape, periodFail } from "./period-plan.js";
import { libraryArray, libraryId, libraryLabel, libraryTime } from "./period-library-model.js";
import { validateReportHistory, REPORT_HISTORY_SCHEMA } from "./report-history-model.js";

export const REPORT_SET_SCHEMA = "threecore.report-set.v1";
export const REPORT_SET_LIMIT = 64 * 1024 * 1024;
export const REPORT_SET_AGENTS = Object.freeze(["DAT", "EMA", "CAWELON"]);

export function freezeSet(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSet);
    Object.freeze(value);
  }
  return value;
}

/** IDs are an explicit ordered selection, never inferred from a visible filter. */
export function validateSetSelection(value, { allowEmpty = true } = {}) {
  const ids = libraryArray(value).map(libraryId);
  if (new Set(ids).size !== ids.length) periodFail("PERIOD_SET_DUPLICATE_SELECTION");
  if (!allowEmpty && !ids.length) periodFail("PERIOD_SET_EMPTY");
  return Object.freeze(ids);
}

/** Input stores original evidence only. Imported conclusions are not accepted. */
export function validateReportSet(value) {
  periodShape(value, ["schema", "title", "createdAt", "sourceRevision", "entries", "historicalOnly"]);
  if (value.schema !== REPORT_SET_SCHEMA || value.historicalOnly !== true ||
      !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0) {
    periodFail("PERIOD_SET_SCHEMA");
  }
  const title = libraryLabel(value.title);
  if (title !== value.title) periodFail("PERIOD_SET_TITLE");
  const createdAt = libraryTime(value.createdAt);
  const history = validateReportHistory({ schema: REPORT_HISTORY_SCHEMA, revision: 0, entries: value.entries });
  if (!history.entries.length) periodFail("PERIOD_SET_EMPTY");
  const result = Object.freeze({ schema: REPORT_SET_SCHEMA, title, createdAt,
    sourceRevision: value.sourceRevision, entries: history.entries, historicalOnly: true });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > REPORT_SET_LIMIT) periodFail("PERIOD_SET_SIZE");
  return result;
}

export function createReportSet(historyInput, selectionInput, title, createdAt) {
  const history = validateReportHistory(historyInput);
  const selection = validateSetSelection(selectionInput, { allowEmpty: false });
  const entries = selection.map(id => {
    const entry = history.entries.find(row => row.id === id);
    if (!entry) periodFail("PERIOD_SET_SOURCE_MISSING");
    return entry;
  });
  return validateReportSet({ schema: REPORT_SET_SCHEMA, title: libraryLabel(title), createdAt,
    sourceRevision: history.revision, entries, historicalOnly: true });
}

/** An unrelated record changing does not invalidate the selected evidence. */
export function inspectSetSources(inputValue, historyValue) {
  const input = validateReportSet(inputValue), history = validateReportHistory(historyValue);
  const rows = input.entries.map(saved => {
    const current = history.entries.find(row => row.id === saved.id);
    const status = !current ? "missing" : JSON.stringify(current) === JSON.stringify(saved) ? "exact" :
      JSON.stringify(current.report) === JSON.stringify(saved.report) ? "metadata" : "changed";
    return Object.freeze({ id: saved.id, label: saved.label, status,
      currentLabel: current?.label ?? null, currentArchived: current?.archived ?? null });
  });
  return Object.freeze({ revision: history.revision, rows: Object.freeze(rows),
    unchanged: rows.every(row => row.status === "exact"), changed: rows.filter(row => row.status !== "exact").length,
    originalEvidencePreserved: true, liveChainRechecked: false });
}

export function assertSetSourcesUnchanged(input, history) {
  const inspection = inspectSetSources(input, history);
  if (!inspection.unchanged) periodFail("PERIOD_SET_SOURCE_CHANGED");
  return inspection;
}

export function validateSetExportOptions(value = {}) {
  periodShape(value, Object.keys(value));
  const options = { includeNotes: false, shortAddresses: true, ...value };
  periodShape(options, ["includeNotes", "shortAddresses"]);
  if (typeof options.includeNotes !== "boolean" || typeof options.shortAddresses !== "boolean") {
    periodFail("PERIOD_SET_EXPORT_OPTIONS");
  }
  return Object.freeze(options);
}
