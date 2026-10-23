import { shape, transferFail, transferContextKey, validateTransferSnapshot } from "./transfer-codec.js";
import { addTransferArchiveRecord, describeTransferArchive, validateTransferArchive } from "./transfer-archive.js";
import { checkpointId, checkpointLabel, checkpointTime } from "./checkpoint-model.js";

export const VAULT_AGENTS = Object.freeze(["DAT", "EMA", "CAWELON"]);
export const VAULT_BUNDLE_SCHEMA = "threecore.transfer-vault-bundle.v1";
export const VAULT_DOCUMENT_SCHEMA = "threecore.transfer-vault-storage.v1";
export const VAULT_ENTRY_LIMIT = 5;
export const VAULT_BUNDLE_BYTES = 12 * 1024 * 1024;
export const VAULT_STORAGE_BYTES = 24 * 1024 * 1024;
const encoder = new TextEncoder();

export function vaultArray(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) {
    transferFail("TRANSFER_VAULT_ARRAY");
  }
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor)) transferFail("TRANSFER_VAULT_ARRAY");
  }
  return value;
}

export function vaultLabel(value) {
  try { return checkpointLabel(value); }
  catch { transferFail("TRANSFER_VAULT_LABEL"); }
}

export function vaultId(value) {
  try { return checkpointId(value); }
  catch { transferFail("TRANSFER_VAULT_ID"); }
}

export function vaultTime(value) {
  try { return checkpointTime(value); }
  catch { transferFail("TRANSFER_VAULT_TIME"); }
}

function sizeOf(value, maximum) {
  const bytes = encoder.encode(JSON.stringify(value)).byteLength;
  if (bytes > maximum) transferFail("TRANSFER_VAULT_SIZE");
  return bytes;
}

/** The bundle is historical data. It contains no wallet configuration or authority. */
export function validateVaultBundle(input) {
  shape(input, ["schema", "slots", "readOnly", "completeHistory"]);
  if (input.schema !== VAULT_BUNDLE_SCHEMA || input.readOnly !== true || input.completeHistory !== false) {
    transferFail("TRANSFER_VAULT_SCHEMA");
  }
  vaultArray(input.slots, 3);
  if (input.slots.length !== 3) transferFail("TRANSFER_VAULT_SLOTS");
  const slots = VAULT_AGENTS.map((agent, index) => {
    const slot = input.slots[index];
    shape(slot, ["agent", "archive"]);
    if (slot.agent !== agent) transferFail("TRANSFER_VAULT_SLOTS");
    const archive = slot.archive === null ? null : validateTransferArchive(slot.archive);
    if (archive && archive.records[0].context.agent !== agent) transferFail("TRANSFER_VAULT_CONTEXT");
    return Object.freeze({ agent, archive });
  });
  const bundle = Object.freeze({ schema: VAULT_BUNDLE_SCHEMA, slots: Object.freeze(slots), readOnly: true, completeHistory: false });
  sizeOf(bundle, VAULT_BUNDLE_BYTES);
  return bundle;
}

export function vaultBundle(archives = [null, null, null]) {
  vaultArray(archives, 3);
  if (archives.length !== 3) transferFail("TRANSFER_VAULT_SLOTS");
  return validateVaultBundle({ schema: VAULT_BUNDLE_SCHEMA,
    slots: VAULT_AGENTS.map((agent, index) => ({ agent, archive: archives[index] })),
    readOnly: true, completeHistory: false });
}

export function vaultHasRecords(input) {
  return validateVaultBundle(input).slots.some(slot => slot.archive !== null);
}

export function vaultKey(input) {
  return JSON.stringify(validateVaultBundle(input));
}

/** Include a current observation without silently replacing a conflicting period. */
export function captureTransferArchive(archive, snapshot) {
  const previous = archive === null ? null : validateTransferArchive(archive);
  if (snapshot === null) return previous;
  const current = validateTransferSnapshot(snapshot);
  if (!previous) return addTransferArchiveRecord(null, current);
  if (transferContextKey(previous.records[0].context) !== transferContextKey(current.context)) {
    transferFail("TRANSFER_VAULT_CONTEXT");
  }
  const sameRange = previous.records.find(record => record.range.fromBlock === current.range.fromBlock && record.range.toBlock === current.range.toBlock);
  if (sameRange) {
    if (JSON.stringify(sameRange) !== JSON.stringify(current)) transferFail("TRANSFER_VAULT_RANGE_CONFLICT");
    return previous;
  }
  return addTransferArchiveRecord(previous, current);
}

export function describeVaultBundle(input) {
  const bundle = validateVaultBundle(input);
  return Object.freeze(bundle.slots.map(slot => {
    if (!slot.archive) return Object.freeze({ agent: slot.agent, present: false });
    return Object.freeze({ agent: slot.agent, present: true, ...describeTransferArchive(slot.archive) });
  }));
}

/** Plan replaces the offline working copy only; card addresses are never modified. */
export function reviewVaultReplacement(before, after) {
  const left = validateVaultBundle(before), right = validateVaultBundle(after);
  let removesRecords = false;
  const changes = VAULT_AGENTS.map((agent, index) => {
    const oldArchive = left.slots[index].archive, newArchive = right.slots[index].archive;
    const oldRecords = oldArchive?.records ?? [], newRecords = newArchive?.records ?? [];
    const oldKeys = new Set(oldRecords.map(record => JSON.stringify(record)));
    const newKeys = new Set(newRecords.map(record => JSON.stringify(record)));
    const removed = [...oldKeys].filter(key => !newKeys.has(key)).length;
    const added = [...newKeys].filter(key => !oldKeys.has(key)).length;
    removesRecords ||= removed > 0;
    const contextChanged = !!oldArchive && !!newArchive &&
      transferContextKey(oldRecords[0].context) !== transferContextKey(newRecords[0].context);
    return Object.freeze({ agent, added, removed, contextChanged, unchanged: added === 0 && removed === 0 });
  });
  return Object.freeze({ changes: Object.freeze(changes), removesRecords,
    unchanged: changes.every(row => row.unchanged), beforeKey: vaultKey(left), after: right });
}

/** Merge is additive and rejects a conflicting context, period or overlapping log. */
export function mergeVaultBundles(before, incoming) {
  const left = validateVaultBundle(before), right = validateVaultBundle(incoming);
  return vaultBundle(left.slots.map((slot, index) => {
    let archive = slot.archive;
    for (const snapshot of right.slots[index].archive?.records ?? []) {
      archive = captureTransferArchive(archive, snapshot);
    }
    return archive;
  }));
}

export function validateVaultDocument(input) {
  shape(input, ["schema", "revision", "entries"]);
  if (input.schema !== VAULT_DOCUMENT_SCHEMA || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    transferFail("TRANSFER_VAULT_DOCUMENT");
  }
  vaultArray(input.entries, VAULT_ENTRY_LIMIT);
  const ids = new Set();
  const entries = input.entries.map(row => {
    shape(row, ["id", "label", "createdAt", "updatedAt", "archived", "bundle"]);
    const id = vaultId(row.id), label = vaultLabel(row.label);
    const createdAt = vaultTime(row.createdAt), updatedAt = vaultTime(row.updatedAt);
    if (ids.has(id)) transferFail("TRANSFER_VAULT_DUPLICATE");
    ids.add(id);
    if (label !== row.label || updatedAt < createdAt || typeof row.archived !== "boolean") transferFail("TRANSFER_VAULT_DOCUMENT");
    const bundle = validateVaultBundle(row.bundle);
    if (!vaultHasRecords(bundle)) transferFail("TRANSFER_VAULT_EMPTY");
    return Object.freeze({ id, label, createdAt, updatedAt, archived: row.archived, bundle });
  });
  const document = Object.freeze({ schema: VAULT_DOCUMENT_SCHEMA, revision: input.revision, entries: Object.freeze(entries) });
  sizeOf(document, VAULT_STORAGE_BYTES);
  return document;
}

export function emptyVaultDocument() {
  return validateVaultDocument({ schema: VAULT_DOCUMENT_SCHEMA, revision: 0, entries: [] });
}

export function vaultMetadata(input) {
  const document = validateVaultDocument(input);
  return Object.freeze({ revision: document.revision, count: document.entries.length,
    remaining: VAULT_ENTRY_LIMIT - document.entries.length, bytes: sizeOf(document, VAULT_STORAGE_BYTES),
    entries: Object.freeze(document.entries.map(({ bundle, ...row }) => Object.freeze({ ...row,
      agents: Object.freeze(bundle.slots.filter(slot => slot.archive).map(slot => slot.agent)),
      records: bundle.slots.reduce((sum, slot) => sum + (slot.archive?.records.length ?? 0), 0) }))) });
}

/** Atomic compare-and-swap. No entry eviction, overwrite or silent merge. */
export function mutateVaultDocument(input, expectedRevision, operation) {
  const document = validateVaultDocument(input);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== document.revision) transferFail("TRANSFER_VAULT_STALE");
  const descriptor = operation && Object.getOwnPropertyDescriptor(operation, "kind");
  if (!descriptor || !("value" in descriptor)) transferFail("TRANSFER_VAULT_OPERATION");
  let entries = [...document.entries], changed = true;
  if (descriptor.value === "import") {
    shape(operation, ["kind", "entries"]);
    const imported = validateVaultDocument({ schema: VAULT_DOCUMENT_SCHEMA, revision: 0, entries: operation.entries });
    let additions = 0;
    for (const row of imported.entries) {
      const existing = entries.find(entry => entry.id === row.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(row)) transferFail("TRANSFER_VAULT_IMPORT_CONFLICT");
      } else {
        entries.push(row);
        additions++;
      }
    }
    changed = additions > 0;
  } else if (descriptor.value === "save") {
    shape(operation, ["kind", "id", "label", "time", "bundle"]);
    if (entries.length >= VAULT_ENTRY_LIMIT) transferFail("TRANSFER_VAULT_CAPACITY");
    const id = vaultId(operation.id), label = vaultLabel(operation.label), time = vaultTime(operation.time);
    if (entries.some(row => row.id === id)) transferFail("TRANSFER_VAULT_DUPLICATE");
    entries.push({ id, label, createdAt: time, updatedAt: time, archived: false, bundle: operation.bundle });
  } else {
    const kind = descriptor.value;
    if (!["rename", "archive", "unarchive", "purge"].includes(kind)) transferFail("TRANSFER_VAULT_OPERATION");
    shape(operation, kind === "rename" ? ["kind", "id", "label", "time"] :
      kind === "purge" ? ["kind", "id", "confirmed"] : ["kind", "id", "time"]);
    const id = vaultId(operation.id);
    const index = entries.findIndex(row => row.id === id);
    if (index < 0) transferFail("TRANSFER_VAULT_MISSING");
    const old = entries[index];
    if (kind === "purge") {
      if (!old.archived || operation.confirmed !== true) transferFail("TRANSFER_VAULT_CONFIRMATION");
      entries.splice(index, 1);
    } else {
      const time = vaultTime(operation.time), updatedAt = time > old.updatedAt ? time : old.updatedAt;
      if (kind === "rename") {
        const label = vaultLabel(operation.label);
        changed = label !== old.label;
        entries[index] = { ...old, label, updatedAt };
      } else {
        const archived = kind === "archive";
        changed = archived !== old.archived;
        entries[index] = { ...old, archived, updatedAt };
      }
    }
  }
  if (!changed) return document;
  if (entries.length > VAULT_ENTRY_LIMIT) transferFail("TRANSFER_VAULT_CAPACITY");
  if (document.revision === Number.MAX_SAFE_INTEGER) transferFail("TRANSFER_VAULT_REVISION");
  return validateVaultDocument({ schema: VAULT_DOCUMENT_SCHEMA, revision: document.revision + 1, entries });
}
