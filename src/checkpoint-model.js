import { WORKSPACE_FILE_LIMIT } from "./workspace-file.js";

export const CHECKPOINT_SCHEMA = "threecore-local-checkpoints-v1";
export const CHECKPOINT_LIMIT = 5;
export const CHECKPOINT_TOTAL_BYTES = 24 * 1024 * 1024;
const SLOT_KEYS = ["id", "label", "createdAt", "updatedAt", "archived", "fileText"];

export class CheckpointError extends Error {
  constructor(code) {
    super(code);
    this.name = "CheckpointError";
    this.code = code;
  }
}
export function checkpointFail(code) { throw new CheckpointError(code); }

function fields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) checkpointFail("CHECKPOINT_SHAPE");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) checkpointFail("CHECKPOINT_SHAPE");
  for (const key of keys) {
    if (!("value" in Object.getOwnPropertyDescriptor(value, key))) checkpointFail("CHECKPOINT_SHAPE");
  }
}

export function checkpointLabel(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 60 ||
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(value)) {
    checkpointFail("CHECKPOINT_LABEL");
  }
  return value.trim();
}

export function checkpointTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    checkpointFail("CHECKPOINT_TIME");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) checkpointFail("CHECKPOINT_TIME");
  return value;
}

export function checkpointId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    checkpointFail("CHECKPOINT_ID");
  }
  return value;
}

function fileSize(text) {
  if (typeof text !== "string" || !text.length || text.length > WORKSPACE_FILE_LIMIT) checkpointFail("CHECKPOINT_FILE");
  const size = new TextEncoder().encode(text).byteLength;
  if (size > WORKSPACE_FILE_LIMIT) checkpointFail("CHECKPOINT_FILE");
  return size;
}

/** This layer validates storage shape; the controller verifies workspace checksums. */
export function validateCheckpointDocument(input) {
  fields(input, ["schema", "revision", "entries"]);
  if (input.schema !== CHECKPOINT_SCHEMA || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    checkpointFail("CHECKPOINT_SCHEMA");
  }
  const rows = input.entries;
  if (!Array.isArray(rows) || rows.length > CHECKPOINT_LIMIT ||
      Reflect.ownKeys(rows).length !== rows.length + 1) checkpointFail("CHECKPOINT_CAPACITY");
  const entries = [];
  let bytes = 0;
  for (let index = 0; index < rows.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, String(index));
    if (!descriptor || !("value" in descriptor)) checkpointFail("CHECKPOINT_SHAPE");
    const row = descriptor.value;
    fields(row, SLOT_KEYS);
    const id = checkpointId(row.id);
    const label = checkpointLabel(row.label);
    const createdAt = checkpointTime(row.createdAt);
    const updatedAt = checkpointTime(row.updatedAt);
    if (label !== row.label || updatedAt < createdAt || typeof row.archived !== "boolean") checkpointFail("CHECKPOINT_SHAPE");
    if (entries.some(entry => entry.id === id)) checkpointFail("CHECKPOINT_DUPLICATE");
    bytes += fileSize(row.fileText);
    if (bytes > CHECKPOINT_TOTAL_BYTES) checkpointFail("CHECKPOINT_CAPACITY");
    entries.push(Object.freeze({ id, label, createdAt, updatedAt, archived: row.archived, fileText: row.fileText }));
  }
  return Object.freeze({ schema: CHECKPOINT_SCHEMA, revision: input.revision, entries: Object.freeze(entries) });
}

export function emptyCheckpointDocument() {
  return validateCheckpointDocument({ schema: CHECKPOINT_SCHEMA, revision: 0, entries: [] });
}

export function checkpointMetadata(input) {
  const document = validateCheckpointDocument(input);
  return Object.freeze({
    revision: document.revision,
    count: document.entries.length,
    remaining: CHECKPOINT_LIMIT - document.entries.length,
    totalBytes: document.entries.reduce((sum, entry) => sum + fileSize(entry.fileText), 0),
    entries: Object.freeze(document.entries.map(({ fileText, ...entry }) =>
      Object.freeze({ ...entry, bytes: fileSize(fileText) }))),
  });
}

/** Compare-and-swap revision prevents one tab from overwriting another tab's edit. */
export function mutateCheckpoints(input, expectedRevision, operation) {
  const document = validateCheckpointDocument(input);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== document.revision) checkpointFail("CHECKPOINT_STALE");
  if (!operation || typeof operation !== "object") checkpointFail("CHECKPOINT_OPERATION");
  const kind = Object.getOwnPropertyDescriptor(operation, "kind");
  if (!kind || !("value" in kind)) checkpointFail("CHECKPOINT_OPERATION");
  let entries = [...document.entries];
  let changed = true;
  if (kind.value === "import") {
    fields(operation, ["kind", "entries"]);
    const incoming = validateCheckpointDocument({ schema: CHECKPOINT_SCHEMA, revision: 0, entries: operation.entries });
    let added = 0;
    for (const row of incoming.entries) {
      const existing = entries.find(entry => entry.id === row.id);
      if (existing) {
        if (existing.fileText !== row.fileText) checkpointFail("CHECKPOINT_CONFLICT");
      } else { entries.push(row); added++; }
    }
    changed = added > 0;
  } else if (kind.value === "save") {
    fields(operation, ["kind", "id", "label", "time", "fileText"]);
    if (entries.length >= CHECKPOINT_LIMIT) checkpointFail("CHECKPOINT_CAPACITY");
    const id = checkpointId(operation.id);
    if (entries.some(row => row.id === id)) checkpointFail("CHECKPOINT_DUPLICATE");
    entries.push({ id, label: checkpointLabel(operation.label), createdAt: checkpointTime(operation.time),
      updatedAt: operation.time, archived: false, fileText: operation.fileText });
  } else {
    const keys = kind.value === "rename" ? ["kind", "id", "label", "time"] :
      kind.value === "purge" ? ["kind", "id", "confirmed"] : ["kind", "id", "time"];
    fields(operation, keys);
    checkpointId(operation.id);
    const index = entries.findIndex(row => row.id === operation.id);
    if (index < 0) checkpointFail("CHECKPOINT_MISSING");
    const old = entries[index];
    if (kind.value === "purge") {
      if (operation.confirmed !== true || !old.archived) checkpointFail("CHECKPOINT_CONFIRMATION");
      entries.splice(index, 1);
    } else {
      const time = checkpointTime(operation.time);
      const updatedAt = time > old.updatedAt ? time : old.updatedAt;
      if (kind.value === "rename") {
        const label = checkpointLabel(operation.label);
        changed = old.label !== label;
        entries[index] = { ...old, label, updatedAt };
      } else if (kind.value === "archive" || kind.value === "unarchive") {
        const archived = kind.value === "archive";
        changed = old.archived !== archived;
        entries[index] = { ...old, archived, updatedAt };
      } else checkpointFail("CHECKPOINT_OPERATION");
    }
  }
  if (!changed) return document;
  if (document.revision === Number.MAX_SAFE_INTEGER) checkpointFail("CHECKPOINT_REVISION");
  return validateCheckpointDocument({ schema: CHECKPOINT_SCHEMA, revision: document.revision + 1, entries });
}
