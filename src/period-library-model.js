import { checkpointId, checkpointLabel, checkpointTime } from "./checkpoint-model.js";
import { periodShape, periodFail, periodPlanKey } from "./period-plan.js";
import { validatePeriodDraft, periodDraftKey, periodDraftProgress } from "./period-draft.js";

export const PERIOD_LIBRARY_SCHEMA = "threecore.period-library.v1";
export const PERIOD_LIBRARY_ENTRIES = 12;
export const PERIOD_LIBRARY_BYTES = 48 * 1024 * 1024;
const encoder = new TextEncoder();
const ENTRY_FIELDS = ["id", "label", "createdAt", "updatedAt", "archived", "requiresNewPlan", "draft"];

function checked(check, value, code) {
  try { return check(value); } catch { periodFail(code); }
}
export const libraryId = value => checked(checkpointId, value, "PERIOD_LIBRARY_ID");
export const libraryLabel = value => checked(checkpointLabel, value, "PERIOD_LIBRARY_LABEL");
export const libraryTime = value => checked(checkpointTime, value, "PERIOD_LIBRARY_TIME");

export function libraryArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > PERIOD_LIBRARY_ENTRIES ||
      Reflect.ownKeys(value).length !== value.length + 1) periodFail("PERIOD_LIBRARY_CAPACITY");
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field)) periodFail("PERIOD_SHAPE");
  }
  return value;
}

export function validateLibraryEntry(input) {
  periodShape(input, ENTRY_FIELDS);
  const id = libraryId(input.id);
  const label = libraryLabel(input.label);
  const createdAt = libraryTime(input.createdAt);
  const updatedAt = libraryTime(input.updatedAt);
  if (label !== input.label || updatedAt < createdAt || typeof input.archived !== "boolean" ||
      typeof input.requiresNewPlan !== "boolean") periodFail("PERIOD_LIBRARY_ENTRY");
  const draft = validatePeriodDraft(input.draft);
  if (input.requiresNewPlan && periodDraftProgress(draft).completed === 0) periodFail("PERIOD_LIBRARY_ENTRY");
  return Object.freeze({ id, label, createdAt, updatedAt, archived: input.archived,
    requiresNewPlan: input.requiresNewPlan, draft });
}

export function validatePeriodLibrary(input) {
  periodShape(input, ["schema", "revision", "entries"]);
  if (input.schema !== PERIOD_LIBRARY_SCHEMA || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    periodFail("PERIOD_LIBRARY_SCHEMA");
  }
  const ids = new Set();
  const entries = libraryArray(input.entries).map(row => {
    const entry = validateLibraryEntry(row);
    if (ids.has(entry.id)) periodFail("PERIOD_LIBRARY_DUPLICATE_ID");
    ids.add(entry.id);
    return entry;
  });
  const result = Object.freeze({ schema: PERIOD_LIBRARY_SCHEMA, revision: input.revision, entries: Object.freeze(entries) });
  if (encoder.encode(JSON.stringify(result)).byteLength > PERIOD_LIBRARY_BYTES) periodFail("PERIOD_LIBRARY_CAPACITY");
  return result;
}

export function emptyPeriodLibrary() {
  return validatePeriodLibrary({ schema: PERIOD_LIBRARY_SCHEMA, revision: 0, entries: [] });
}

export function libraryEntryStatus(input) {
  const entry = validateLibraryEntry(input);
  return entry.requiresNewPlan ? "blocked" : periodDraftProgress(entry.draft).complete ? "complete" : "partial";
}

export function libraryMetadata(input) {
  const document = validatePeriodLibrary(input);
  return Object.freeze({ revision: document.revision, count: document.entries.length,
    remaining: PERIOD_LIBRARY_ENTRIES - document.entries.length,
    bytes: encoder.encode(JSON.stringify(document)).byteLength,
    entries: Object.freeze(document.entries.map(entry => {
      const progress = periodDraftProgress(entry.draft);
      return Object.freeze({ id: entry.id, label: entry.label, createdAt: entry.createdAt,
        updatedAt: entry.updatedAt, archived: entry.archived, requiresNewPlan: entry.requiresNewPlan,
        context: entry.draft.plan.context, earlierBlock: entry.draft.plan.earlierBlock,
        laterBlock: entry.draft.plan.laterBlock, windowSize: entry.draft.plan.windowSize,
        status: entry.requiresNewPlan ? "blocked" : progress.complete ? "complete" : "partial",
        ...progress });
    })) });
}

/** No draft update operation exists: acquired evidence is saved as a new entry. */
export function mutatePeriodLibrary(input, expectedRevision, operation) {
  const document = validatePeriodLibrary(input);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== document.revision) periodFail("PERIOD_LIBRARY_STALE");
  const kind = operation && Object.getOwnPropertyDescriptor(operation, "kind");
  if (!kind || !("value" in kind)) periodFail("PERIOD_LIBRARY_OPERATION");
  let entries = [...document.entries];
  if (kind.value === "save") {
    periodShape(operation, ["kind", "id", "label", "time", "draft", "requiresNewPlan"]);
    const entry = validateLibraryEntry({ id: operation.id, label: libraryLabel(operation.label),
      createdAt: operation.time, updatedAt: operation.time, archived: false,
      requiresNewPlan: operation.requiresNewPlan, draft: operation.draft });
    if (entries.some(row => row.id === entry.id)) periodFail("PERIOD_LIBRARY_DUPLICATE_ID");
    if (entries.some(row => row.requiresNewPlan === entry.requiresNewPlan &&
        periodDraftKey(row.draft) === periodDraftKey(entry.draft))) periodFail("PERIOD_LIBRARY_DUPLICATE_DRAFT");
    entries.push(entry);
  } else if (kind.value === "import") {
    periodShape(operation, ["kind", "entries"]);
    const incoming = validatePeriodLibrary({ schema: PERIOD_LIBRARY_SCHEMA, revision: 0, entries: operation.entries });
    for (const entry of incoming.entries) {
      const sameId = entries.find(row => row.id === entry.id);
      if (sameId && JSON.stringify(sameId) !== JSON.stringify(entry)) periodFail("PERIOD_LIBRARY_IMPORT_CONFLICT");
      if (!sameId) entries.push(entry);
    }
  } else {
    if (!["rename", "archive", "purge"].includes(kind.value)) periodFail("PERIOD_LIBRARY_OPERATION");
    const fields = { rename: ["label", "time"], archive: ["archived", "time"], purge: ["acknowledged"] }[kind.value];
    if (!fields) periodFail("PERIOD_LIBRARY_OPERATION");
    periodShape(operation, ["kind", "id", ...fields]);
    const id = libraryId(operation.id);
    const index = entries.findIndex(row => row.id === id);
    if (index < 0) periodFail("PERIOD_LIBRARY_NOT_FOUND");
    const entry = entries[index];
    if (kind.value === "purge") {
      if (!entry.archived || operation.acknowledged !== true) periodFail("PERIOD_LIBRARY_PURGE_ACK");
      entries.splice(index, 1);
    } else {
      const time = libraryTime(operation.time);
      if (time < entry.updatedAt) periodFail("PERIOD_LIBRARY_TIME_ORDER");
      if (kind.value === "rename") {
        const label = libraryLabel(operation.label);
        if (label !== entry.label) entries[index] = Object.freeze({ ...entry, label, updatedAt: time });
      } else {
        if (typeof operation.archived !== "boolean") periodFail("PERIOD_LIBRARY_ENTRY");
        if (operation.archived !== entry.archived) entries[index] = Object.freeze({ ...entry, archived: operation.archived, updatedAt: time });
      }
    }
  }
  if (JSON.stringify(entries) === JSON.stringify(document.entries)) return document;
  if (document.revision === Number.MAX_SAFE_INTEGER) periodFail("PERIOD_LIBRARY_REVISION_LIMIT");
  return validatePeriodLibrary({ schema: PERIOD_LIBRARY_SCHEMA, revision: document.revision + 1, entries });
}

/** A comparison describes evidence changes; it never merges or chooses a trustworthy side. */
export function compareLibraryDrafts(leftInput, rightInput) {
  const left = validatePeriodDraft(leftInput), right = validatePeriodDraft(rightInput);
  const before = periodDraftProgress(left), after = periodDraftProgress(right);
  const base = { before, after, automaticallyMerged: false, independentlyVerified: false };
  if (periodPlanKey(left.plan) !== periodPlanKey(right.plan)) return Object.freeze({ ...base, kind: "different-plan", changedParts: [] });
  if (periodDraftKey(left) === periodDraftKey(right)) return Object.freeze({ ...base, kind: "identical", changedParts: [] });
  const changedParts = [];
  for (const name of ["earlier", "later"]) {
    if (left[name] && right[name] && JSON.stringify(left[name]) !== JSON.stringify(right[name])) changedParts.push(name);
  }
  for (let index = 0; index < Math.min(left.records.length, right.records.length); index++) {
    if (JSON.stringify(left.records[index]) !== JSON.stringify(right.records[index])) changedParts.push("window-" + (index + 1));
  }
  return Object.freeze({ ...base, kind: changedParts.length ? "changed-evidence" :
    after.completed > before.completed ? "extension" : "shorter", changedParts: Object.freeze(changedParts) });
}
