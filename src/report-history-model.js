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
  input = periodShape(input, ["id", "label", "note", "tags", "savedAt", "updatedAt", "archived", "report"]);
  const id = libraryId(input.id), label = libraryLabel(input.label);
  const sourceTags = libraryArray(input.tags);
  const note = historyNote(input.note), tags = historyTags(sourceTags);
  const savedAt = libraryTime(input.savedAt), updatedAt = libraryTime(input.updatedAt);
  if (label !== input.label || note !== input.note || JSON.stringify(tags) !== JSON.stringify(sourceTags) ||
      updatedAt < savedAt || typeof input.archived !== "boolean") periodFail("PERIOD_HISTORY_ENTRY");
  const report = validatePeriodReportInput(input.report);
  // Creation time inside imported evidence is not used as a trusted local clock.
  return Object.freeze({ id, label, note, tags, savedAt, updatedAt, archived: input.archived, report });
}

// Only snapshots produced here can skip repeated validation; frozen caller data still undergoes full capture.
const validatedHistories = new WeakSet();
export function validateReportHistory(input) {
  if (validatedHistories.has(input)) return input;
  input = periodShape(input, ["schema", "revision", "entries"]);
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
  validatedHistories.add(document);
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
  const revisionLimited = additions.length > 0 && current.revision === Number.MAX_SAFE_INTEGER;
  const resultingRevision = revisionLimited ? null : current.revision + Number(additions.length > 0);
  const resultingBytes = revisionLimited ? null : encoder.encode(JSON.stringify({ ...current,
    revision: resultingRevision, entries: [...current.entries, ...additions] })).byteLength;
  const capacityExceeded = resultingCount > REPORT_HISTORY_LIMIT || (resultingBytes !== null && resultingBytes > REPORT_HISTORY_BYTES);
  return Object.freeze({ expectedRevision: current.revision,
    additions: Object.freeze(additions), duplicates: Object.freeze(duplicates),
    conflicts: Object.freeze(conflicts), metadataKept: Object.freeze(metadataKept),
    resultingCount, resultingRevision, resultingBytes, revisionLimited, capacityExceeded, overwritesExisting: false });
}

/** CAS operations are synchronous so native IndexedDB commits remain atomic. */
export function mutateReportHistory(input, expectedRevision, operation) {
  const document = validateReportHistory(input);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== document.revision) periodFail("PERIOD_HISTORY_STALE");
  let kind;
  try { kind = operation && Object.getOwnPropertyDescriptor(operation, "kind"); }
  catch { periodFail("PERIOD_HISTORY_OPERATION"); }
  if (!kind || !("value" in kind)) periodFail("PERIOD_HISTORY_OPERATION");
  let entries = [...document.entries];
  if (kind.value === "save") {
    operation = periodShape(operation, ["kind", "entry"]);
    if (operation.kind !== kind.value) periodFail("PERIOD_HISTORY_OPERATION");
    const entry = validateHistoryEntry(operation.entry);
    if (entries.some(row => row.id === entry.id)) periodFail("PERIOD_HISTORY_DUPLICATE_ID");
    if (entries.some(row => periodReportInputKey(row.report) === periodReportInputKey(entry.report))) {
      periodFail("PERIOD_HISTORY_DUPLICATE_REPORT");
    }
    entries.push(entry);
  } else if (kind.value === "merge") {
    operation = periodShape(operation, ["kind", "document", "skipConflicts"]);
    if (operation.kind !== kind.value) periodFail("PERIOD_HISTORY_OPERATION");
    if (typeof operation.skipConflicts !== "boolean") periodFail("PERIOD_HISTORY_OPERATION");
    const plan = planHistoryMerge(document, operation.document);
    if (plan.conflicts.length && !operation.skipConflicts) periodFail("PERIOD_HISTORY_CONFLICT");
    if (plan.revisionLimited) periodFail("PERIOD_HISTORY_REVISION_LIMIT");
    if (plan.capacityExceeded) periodFail("PERIOD_HISTORY_CAPACITY");
    entries.push(...plan.additions);
  } else if (["annotate", "archive"].includes(kind.value)) {
    operation = periodShape(operation, kind.value === "annotate" ? ["kind", "id", "label", "note", "tags", "time"] :
      ["kind", "id", "archived", "time"]);
    if (operation.kind !== kind.value) periodFail("PERIOD_HISTORY_OPERATION");
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

/** Select explicit original records without merging evidence or changing local metadata. */
export function selectHistoryEntries(value, selectedIds) {
  const document = validateReportHistory(value), ids = libraryArray(selectedIds).map(libraryId);
  if (new Set(ids).size !== ids.length || ids.some(id => !document.entries.some(row => row.id === id))) periodFail("PERIOD_HISTORY_SELECTION");
  return validateReportHistory({ schema: REPORT_HISTORY_SCHEMA, revision: 0,
    entries: ids.map(id => document.entries.find(row => row.id === id)) });
}

/** Explain exact add-only import behavior without exposing annotation values or addresses. */
export function inspectReportHistoryImport(beforeValue, incomingValue) {
  const before = validateReportHistory(beforeValue), incoming = validateReportHistory(incomingValue);
  const plan = planHistoryMerge(before, incoming);
  const metadata = ["id", "label", "note", "tags", "savedAt", "updatedAt", "archived"];
  const rows = incoming.entries.map(entry => {
    const conflict = plan.conflicts.some(row => row.id === entry.id), duplicate = plan.duplicates.find(row => row.incomingId === entry.id);
    const previous = conflict ? before.entries.find(row => row.id === entry.id) : duplicate ? before.entries.find(row => row.id === duplicate.retainedId) : null;
    const changedMetadata = previous ? metadata.filter(field => JSON.stringify(previous[field]) !== JSON.stringify(entry[field])) : [];
    const reportFields = previous ? ["title", "createdAt", "slots"].filter(field => JSON.stringify(previous.report[field]) !== JSON.stringify(entry.report[field])) : [];
    const changedAgents = previous ? entry.report.slots.filter(slot => JSON.stringify(slot.entry) !== JSON.stringify(previous.report.slots.find(row => row.agent === slot.agent).entry)).map(slot => slot.agent) : [];
    const removedRestrictions = previous ? entry.report.slots.filter(slot => previous.report.slots.find(row => row.agent === slot.agent).entry?.requiresNewPlan && slot.entry && !slot.entry.requiresNewPlan).map(slot => slot.agent) : [];
    return Object.freeze({ incomingId: entry.id, retainedId: previous?.id ?? null,
      kind: conflict ? "conflict" : duplicate ? "duplicate" : "addition",
      changedMetadata: Object.freeze(changedMetadata), changedReportFields: Object.freeze(reportFields),
      changedAgents: Object.freeze(changedAgents), removedRestrictions: Object.freeze(removedRestrictions),
      incomingArchived: entry.archived, retainedArchived: previous?.archived ?? null,
      localMetadataKept: Boolean(duplicate && changedMetadata.length) });
  });
  return Object.freeze({ schema: "threecore.report-history-import-inspection.v1",
    beforeCount: before.entries.length, incomingCount: incoming.entries.length,
    additions: plan.additions.length, duplicates: plan.duplicates.length, conflicts: plan.conflicts.length,
    metadataKept: plan.metadataKept.length,
    retainedIds: Object.freeze(before.entries.filter(entry => !rows.some(row => row.retainedId === entry.id)).map(entry => entry.id)),
    rows: Object.freeze(rows), revisionLimited: plan.revisionLimited, resultingRevision: plan.resultingRevision,
    capacity: Object.freeze({ entriesAfter: plan.resultingCount, maxEntries: REPORT_HISTORY_LIMIT,
      bytesAfter: plan.resultingBytes, maxBytes: REPORT_HISTORY_BYTES, fits: !plan.capacityExceeded && !plan.revisionLimited }),
    compatible: !plan.conflicts.length && !plan.capacityExceeded && !plan.revisionLimited,
    compatibleSkippingConflicts: !plan.capacityExceeded && !plan.revisionLimited,
    addOnly: true, localEvidenceKept: true, historicalOnly: true, containsOriginalEvidence: false,
    restorable: false, automaticallyApplied: false, liveChainRechecked: false, authorizesExecution: false });
}
