import { periodShape, periodFail } from "./period-plan.js";
import { libraryId, libraryLabel, libraryTime, libraryArray } from "./period-library-model.js";
import { validatePeriodReportInput, periodReportInputKey } from "./period-report-model.js";

export const REPORT_HISTORY_SCHEMA = "threecore.report-history.v1";
export const REPORT_HISTORY_LIMIT = 12;
export const REPORT_HISTORY_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();

export function historyNote(value) {
  if (typeof value !== "string" || value.length > 500 ||
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)) {
    periodFail("PERIOD_HISTORY_NOTE");
  }
  return value.trim();
}

export function historyTags(value) {
  const tags = libraryArray(value);
  if (tags.length > 6) periodFail("PERIOD_HISTORY_TAGS");
  const result = tags.map(tag => {
    if (typeof tag !== "string" || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(tag)) periodFail("PERIOD_HISTORY_TAGS");
    return tag;
  }).sort();
  if (new Set(result).size !== result.length) periodFail("PERIOD_HISTORY_TAGS");
  return Object.freeze(result);
}

/** Report evidence is immutable; organization fields belong to the local record. */
export function validateHistoryEntry(input) {
  periodShape(input, ["id", "label", "note", "tags", "savedAt", "updatedAt", "archived", "report"]);
  const id = libraryId(input.id), label = libraryLabel(input.label);
  const note = historyNote(input.note), tags = historyTags(input.tags);
  const savedAt = libraryTime(input.savedAt), updatedAt = libraryTime(input.updatedAt);
  if (label !== input.label || note !== input.note || JSON.stringify(tags) !== JSON.stringify(input.tags) ||
      updatedAt < savedAt || typeof input.archived !== "boolean") periodFail("PERIOD_HISTORY_ENTRY");
  const report = validatePeriodReportInput(input.report);
  // Creation time inside imported evidence is not used as a trusted local clock.
  return Object.freeze({ id, label, note, tags, savedAt, updatedAt, archived: input.archived, report });
}

export function validateReportHistory(input) {
  periodShape(input, ["schema", "revision", "entries"]);
  if (input.schema !== REPORT_HISTORY_SCHEMA || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    periodFail("PERIOD_HISTORY_SCHEMA");
  }
  const ids = new Set(), reports = new Set();
  const entries = libraryArray(input.entries).map(value => {
    const entry = validateHistoryEntry(value), key = periodReportInputKey(entry.report);
    if (ids.has(entry.id)) periodFail("PERIOD_HISTORY_DUPLICATE_ID");
    if (reports.has(key)) periodFail("PERIOD_HISTORY_DUPLICATE_REPORT");
    ids.add(entry.id); reports.add(key);
    return entry;
  });
  const document = Object.freeze({ schema: REPORT_HISTORY_SCHEMA, revision: input.revision, entries: Object.freeze(entries) });
  if (encoder.encode(JSON.stringify(document)).byteLength > REPORT_HISTORY_BYTES) periodFail("PERIOD_HISTORY_CAPACITY");
  return document;
}

export function emptyReportHistory() {
  return validateReportHistory({ schema: REPORT_HISTORY_SCHEMA, revision: 0, entries: [] });
}

export function historyEntry(input, id) {
  const document = validateReportHistory(input), key = libraryId(id);
  const entry = document.entries.find(row => row.id === key);
  if (!entry) periodFail("PERIOD_HISTORY_NOT_FOUND");
  return entry;
}

/** Plan an additive restore. Existing evidence and local annotations always win. */
export function planHistoryMerge(currentInput, incomingInput) {
  const current = validateReportHistory(currentInput), incoming = validateReportHistory(incomingInput);
  const additions = [], duplicates = [], conflicts = [], metadataKept = [];
  const byReport = new Map(current.entries.map(entry => [periodReportInputKey(entry.report), entry]));
  for (const entry of incoming.entries) {
    const sameId = current.entries.find(row => row.id === entry.id);
    const sameReport = byReport.get(periodReportInputKey(entry.report));
    if (sameId && periodReportInputKey(sameId.report) !== periodReportInputKey(entry.report)) {
      conflicts.push(Object.freeze({ id: entry.id, localLabel: sameId.label, incomingLabel: entry.label }));
    } else if (sameReport) {
      duplicates.push(Object.freeze({ incomingId: entry.id, retainedId: sameReport.id }));
      if (JSON.stringify(sameReport) !== JSON.stringify(entry)) metadataKept.push(sameReport.id);
    } else additions.push(entry);
  }
  const resultingCount = current.entries.length + additions.length;
  let capacityExceeded = resultingCount > REPORT_HISTORY_LIMIT;
  if (!capacityExceeded) {
    capacityExceeded = encoder.encode(JSON.stringify({ ...current, entries: [...current.entries, ...additions] })).byteLength > REPORT_HISTORY_BYTES;
  }
  return Object.freeze({ expectedRevision: current.revision,
    additions: Object.freeze(additions), duplicates: Object.freeze(duplicates),
    conflicts: Object.freeze(conflicts), metadataKept: Object.freeze(metadataKept),
    resultingCount, capacityExceeded, overwritesExisting: false });
}

/** CAS operations are synchronous so native IndexedDB commits remain atomic. */
export function mutateReportHistory(input, expectedRevision, operation) {
  const document = validateReportHistory(input);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== document.revision) periodFail("PERIOD_HISTORY_STALE");
  const kind = operation && Object.getOwnPropertyDescriptor(operation, "kind");
  if (!kind || !("value" in kind)) periodFail("PERIOD_HISTORY_OPERATION");
  let entries = [...document.entries];
  if (kind.value === "save") {
    periodShape(operation, ["kind", "entry"]);
    const entry = validateHistoryEntry(operation.entry);
    if (entries.some(row => row.id === entry.id)) periodFail("PERIOD_HISTORY_DUPLICATE_ID");
    if (entries.some(row => periodReportInputKey(row.report) === periodReportInputKey(entry.report))) {
      periodFail("PERIOD_HISTORY_DUPLICATE_REPORT");
    }
    entries.push(entry);
  } else if (kind.value === "merge") {
    periodShape(operation, ["kind", "document", "skipConflicts"]);
    if (typeof operation.skipConflicts !== "boolean") periodFail("PERIOD_HISTORY_OPERATION");
    const plan = planHistoryMerge(document, operation.document);
    if (plan.conflicts.length && !operation.skipConflicts) periodFail("PERIOD_HISTORY_CONFLICT");
    if (plan.capacityExceeded) periodFail("PERIOD_HISTORY_CAPACITY");
    entries.push(...plan.additions);
  } else if (["annotate", "archive"].includes(kind.value)) {
    periodShape(operation, kind.value === "annotate" ? ["kind", "id", "label", "note", "tags", "time"] :
      ["kind", "id", "archived", "time"]);
    const entry = historyEntry(document, operation.id), time = libraryTime(operation.time);
    if (time < entry.updatedAt) periodFail("PERIOD_HISTORY_TIME_ORDER");
    const fields = kind.value === "annotate" ? { label: libraryLabel(operation.label),
      note: historyNote(operation.note), tags: historyTags(operation.tags) } : { archived: operation.archived };
    if (kind.value === "archive" && typeof fields.archived !== "boolean") periodFail("PERIOD_HISTORY_ENTRY");
    if (Object.entries(fields).some(([key, value]) => JSON.stringify(entry[key]) !== JSON.stringify(value))) {
      entries[entries.findIndex(row => row.id === entry.id)] = validateHistoryEntry({ ...entry, ...fields, updatedAt: time });
    }
  } else periodFail("PERIOD_HISTORY_OPERATION");
  if (JSON.stringify(entries) === JSON.stringify(document.entries)) return document;
  if (document.revision === Number.MAX_SAFE_INTEGER) periodFail("PERIOD_HISTORY_REVISION_LIMIT");
  return validateReportHistory({ schema: REPORT_HISTORY_SCHEMA, revision: document.revision + 1, entries });
}
