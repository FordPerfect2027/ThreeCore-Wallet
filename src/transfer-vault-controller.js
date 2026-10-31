import { createVaultTimeline } from "./transfer-vault-timeline.js";
import { createStateNotifier } from "./state-notifier.js";
import { readOwnErrorCode } from "./provider-error.js";
import { captureOptionalDataFields } from "./security-data.js";
import { prepareVaultCollection, readVaultCollection, reviewVaultCollection } from "./transfer-vault-collection.js";
import { transferFail } from "./transfer-codec.js";
import { VAULT_AGENTS, vaultBundle, validateVaultBundle, vaultKey, vaultHasRecords, reviewVaultReplacement,
  mergeVaultBundles, validateVaultDocument, vaultMetadata, vaultLabel, vaultId, vaultTime } from "./transfer-vault-model.js";
import { prepareVaultFile, readVaultFile, readLegacyVaultInput } from "./transfer-vault-file.js";
import { vaultActivityCsv, vaultActivityText, vaultFilteredActivityCsv, validateActivityQuery } from "./transfer-vault-analytics.js";

/** Offline working copy + opt-in storage. Nothing opens, reads or saves at mount. */
export function createVaultController({ storage, readCards, stageArchive, onChange = () => {},
  now = () => new Date().toISOString(), createId = () => globalThis.crypto.randomUUID(), subtle } = {}) {
  if (!storage || !["read", "change", "close"].every(key => typeof storage[key] === "function") ||
      ![readCards, stageArchive, onChange, now, createId].every(fn => typeof fn === "function")) {
    transferFail("TRANSFER_VAULT_ADAPTER");
  }
  const timeline = createVaultTimeline();
  let disposed = false, sequence = 0, revision = 0, cardsEpoch = 0, notification = 0;
  let working = vaultBundle(), document = null, selectedId = null, review = null;
  let collectionReview = null;
  let active = null, lastAction = null, error = null, savedKey = null, cardsChanged = false;
  const busy = () => active !== null;
  const entry = () => document?.entries.find(row => row.id === selectedId) ?? null;
  function state() {
    return Object.freeze({ working, review, busy: busy(), activeAction: active?.action ?? null, disposed,
      revision, lastAction, error, collectionReview, metadata: document ? vaultMetadata(document) : null,
      selectedId, selectedArchived: entry()?.archived ?? false,
      hasRecords: vaultHasRecords(working), saved: savedKey === vaultKey(working), cardsChanged, timeline: timeline.describe() });
  }
  const observers = new Set([() => onChange(state())]);
  const notifier = createStateNotifier({ observers, read: () => Object.freeze({ notification }) });
  function publish() {
    if (disposed) return;
    notification++;
    notifier.notify();
  }
  function errorCode(value) {
    const code = readOwnErrorCode(value);
    return typeof code === "string" && /^(TRANSFER|CHECKPOINT)_[A-Z_]+$/.test(code) ? code : "TRANSFER_VAULT_ACTION";
  }
  function report(value, current = () => !disposed) {
    const code = errorCode(value);
    if (!current()) return false;
    error = code;
    review = null;
    collectionReview = null;
    if (["TRANSFER_VAULT_STALE", "CHECKPOINT_STALE"].includes(error)) { document = null; selectedId = null; }
    publish();
    return false;
  }
  function alive(token) { return !disposed && active?.token === token; }
  async function operate(action, fn) {
    if (disposed || busy()) return false;
    const token = ++sequence;
    active = { token, action, aborter: new AbortController() };
    lastAction = null;
    if (action !== "collectionApply") collectionReview = null;
    error = null;
    publish();
    let completed = false, completedSequence;
    try {
      if (!alive(token)) return false;
      await fn(token);
      if (!alive(token)) return false;
      lastAction = action;
      completed = true;
      completedSequence = sequence;
    } catch (failure) {
      if (alive(token)) report(failure, () => alive(token));
      return false;
    } finally {
      if (alive(token)) { active = null; publish(); }
    }
    return completed && !disposed && sequence === completedSequence;
  }
  function stage(bundle, source, merge = false, extra = {}, current = () => !disposed) {
    const target = merge ? mergeVaultBundles(working, bundle) : validateVaultBundle(bundle);
    const replacement = reviewVaultReplacement(working, target);
    if (!current()) return false;
    collectionReview = null;
    review = Object.freeze({ id: ++sequence, revision, source, ...replacement, ...extra });
    error = null;
    return review;
  }
  function changeWorking(bundle) {
    working = validateVaultBundle(bundle);
    revision++;
    review = null;
    error = null;
    cardsChanged = false;
  }
  function updateDocument(value, current) {
    const next = validateVaultDocument(value);
    if (!current()) return false;
    document = next;
    if (savedKey && !document.entries.some(row => vaultKey(row.bundle) === savedKey)) savedKey = null;
    if (!entry()) selectedId = null;
    return true;
  }
  function readyDocument() {
    if (!document) transferFail("TRANSFER_VAULT_REFRESH_REQUIRED");
    return document;
  }
  function selection() {
    readyDocument();
    const selected = entry();
    if (!selected) transferFail("TRANSFER_VAULT_SELECTION");
    return selected;
  }
  async function freshSelection(token) {
    const selected = selection(), expected = document.revision;
    const latest = validateVaultDocument(await storage.read({ signal: active?.aborter.signal }));
    if (!alive(token)) transferFail("TRANSFER_VAULT_CANCELLED");
    if (latest.revision !== expected) transferFail("TRANSFER_VAULT_STALE");
    const current = latest.entries.find(row => row.id === selected.id);
    if (!current) transferFail("TRANSFER_VAULT_MISSING");
    return current;
  }
  function capture(merge = false) {
    if (disposed || busy()) return false;
    const token = ++sequence, epoch = cardsEpoch;
    const current = () => !disposed && !busy() && sequence === token && cardsEpoch === epoch;
    try {
      const captured = validateVaultBundle(readCards());
      if (!current()) return false;
      if (!vaultHasRecords(captured)) transferFail("TRANSFER_VAULT_EMPTY");
      const pending = stage(captured, "cards", merge, { cardsKey: vaultKey(captured) }, current);
      if (!pending) return false;
      publish();
      return !disposed && review === pending && cardsEpoch === epoch;
    } catch (failure) { return current() ? report(failure, current) : false; }
  }
  function load(file, merge = false) {
    return operate("fileReview", async token => {
      review = null;
      const result = await readVaultFile(file, { subtle, signal: active.aborter.signal });
      if (alive(token)) stage(result.bundle, "file", merge, { digest: result.digest }, () => alive(token));
    });
  }
  function loadLegacy(file, kind, agent, merge = false) {
    return operate("legacyReview", async token => {
      review = null;
      if (!VAULT_AGENTS.includes(agent)) transferFail("TRANSFER_VAULT_CONTEXT");
      const archive = await readLegacyVaultInput(file, kind, { subtle, signal: active.aborter.signal });
      if (!alive(token)) return;
      if (archive.records[0].context.agent !== agent) transferFail("TRANSFER_VAULT_CONTEXT");
      const archives = working.slots.map(slot => slot.agent === agent ? archive : slot.archive);
      const single = vaultBundle(archives);
      stage(single, "legacy", merge, {}, () => alive(token));
    });
  }
  async function apply(id, options = {}) {
    return operate("apply", async token => {
      let acknowledgeRemoval;
      try { ({ acknowledgeRemoval = false } = captureOptionalDataFields(options, ["acknowledgeRemoval"])); }
      catch { transferFail("TRANSFER_VAULT_CONFIRMATION"); }
      if (!alive(token)) return;
      const pending = review;
      if (!pending || pending.id !== id || pending.revision !== revision || pending.beforeKey !== vaultKey(working)) {
        transferFail("TRANSFER_VAULT_REVIEW_REQUIRED");
      }
      if (pending.removesRecords && acknowledgeRemoval !== true) transferFail("TRANSFER_VAULT_CONFIRMATION");
      if (pending.source === "cards" && pending.cardsKey !== vaultKey(readCards())) transferFail("TRANSFER_VAULT_CARDS_CHANGED");
      if (!alive(token)) return;
      if (pending !== review) transferFail("TRANSFER_VAULT_CARDS_CHANGED");
      if (pending.source === "stored") {
        const current = await freshSelection(token);
        if (!alive(token)) return;
        if (current.archived || current.id !== pending.entryId || vaultKey(current.bundle) !== pending.entryKey) {
          transferFail("TRANSFER_VAULT_STALE");
        }
      }
      if (!alive(token)) return;
      timeline.record(working, pending.after, pending.source);
      changeWorking(pending.after);
    });
  }
  function undo() {
    if (disposed || busy()) return false;
    try {
      const before = timeline.back(working);
      changeWorking(before);
      collectionReview = null;
      lastAction = "undo";
      publish();
      return true;
    } catch (failure) { return report(failure); }
  }
  function redo() {
    if (disposed || busy()) return false;
    try {
      const after = timeline.forward(working);
      changeWorking(after);
      collectionReview = null;
      lastAction = "redo";
      publish();
      return true;
    } catch (failure) { return report(failure); }
  }
  function refresh() {
    return operate("refresh", async token => {
      review = null;
      const result = await storage.read({ signal: active?.aborter.signal });
      if (alive(token)) updateDocument(result, () => alive(token));
    });
  }
  function select(id) {
    if (disposed || busy()) return false;
    try {
      readyDocument();
      vaultId(id);
      if (!document.entries.some(row => row.id === id)) transferFail("TRANSFER_VAULT_MISSING");
      selectedId = id;
      review = null;
      collectionReview = null;
      error = null;
      publish();
      return true;
    } catch (failure) { return report(failure); }
  }
  function save(label) {
    return operate("save", async token => {
      review = null;
      const stored = readyDocument();
      if (!vaultHasRecords(working)) transferFail("TRANSFER_VAULT_EMPTY");
      const bundle = validateVaultBundle(working), key = vaultKey(bundle), workingRevision = revision;
      const entryId = vaultId(createId());
      if (!alive(token)) return;
      const operation = { kind: "save", id: entryId, label: vaultLabel(label), time: vaultTime(now()), bundle };
      if (!alive(token)) return;
      const result = await storage.change(stored.revision, operation, {
        canCommit: () => alive(token) && revision === workingRevision && vaultKey(working) === key,
        signal: active.aborter.signal,
      });
      if (!alive(token)) return;
      if (!updateDocument(result, () => alive(token))) return;
      selectedId = operation.id;
      savedKey = key;
    });
  }
  function inspectSelected(merge = false) {
    return operate("storedReview", async token => {
      review = null;
      const row = await freshSelection(token);
      if (!alive(token)) return;
      if (row.archived) transferFail("TRANSFER_VAULT_ARCHIVED");
      stage(row.bundle, "stored", merge, { entryId: row.id, entryKey: vaultKey(row.bundle) }, () => alive(token));
    });
  }
  function editSelected(kind, value) {
    return operate(kind, async token => {
      review = null;
      const row = selection();
      const operation = kind === "rename" ? { kind, id: row.id, label: vaultLabel(value), time: vaultTime(now()) } :
        kind === "purge" ? { kind, id: row.id, confirmed: value === true } : { kind, id: row.id, time: vaultTime(now()) };
      if (!alive(token)) return;
      const result = await storage.change(document.revision, operation, { canCommit: () => alive(token), signal: active.aborter.signal });
      if (alive(token)) updateDocument(result, () => alive(token));
    });
  }
  async function prepare(kind = "json", stored = false, query) {
    if (disposed || busy()) return null;
    const own = sequence;
    let capturedQuery;
    try {
      capturedQuery = kind === "filtered-csv" ? validateActivityQuery(query) : undefined;
      if (disposed || sequence !== own || busy()) return null;
    } catch (failure) {
      if (!disposed && sequence === own && !busy()) report(failure, () => !disposed && sequence === own);
      return null;
    }
    let result = null;
    const completed = await operate("export", async token => {
      const source = stored ? (await freshSelection(token)).bundle : working;
      if (!alive(token)) return;
      if (!vaultHasRecords(source)) transferFail("TRANSFER_VAULT_EMPTY");
      if (kind === "json") result = await prepareVaultFile(source, { subtle, signal: active.aborter.signal });
      else if (kind === "filtered-csv") {
        if (stored) transferFail("TRANSFER_VAULT_FILE_KIND");
        const report = vaultFilteredActivityCsv(source, capturedQuery);
        if (!report.matched) transferFail("TRANSFER_VAULT_NO_MATCHES");
        result = Object.freeze({ ...report, filename: "ThreeCore-filtered-transfer-activity.csv",
          mimeType: "text/csv;charset=utf-8", byteLength: new TextEncoder().encode(report.text).length });
      }
      else if (["csv", "txt"].includes(kind)) {
        const text = kind === "csv" ? vaultActivityCsv(source) : vaultActivityText(source);
        result = Object.freeze({ text, filename: "ThreeCore-transfer-activity." + kind,
          mimeType: (kind === "csv" ? "text/csv" : "text/plain") + ";charset=utf-8", byteLength: new TextEncoder().encode(text).length });
      } else transferFail("TRANSFER_VAULT_FILE_KIND");
      if (!alive(token)) result = null;
    });
    return completed && !disposed ? result : null;
  }
  function loadCollection(file) {
    return operate("collectionReview", async token => {
      review = null;
      const before = readyDocument();
      const result = await readVaultCollection(file, { subtle, signal: active.aborter.signal });
      if (!alive(token)) return;
      const proposed = reviewVaultCollection(before, result.document);
      if (alive(token)) collectionReview = Object.freeze({ id: ++sequence, ...proposed });
    });
  }
  function applyCollection(id) {
    return operate("collectionApply", async token => {
      const pending = collectionReview;
      if (!pending || pending.id !== id || pending.expectedRevision !== readyDocument().revision) {
        transferFail("TRANSFER_VAULT_REVIEW_REQUIRED");
      }
      const result = await storage.change(pending.expectedRevision, { kind: "import", entries: pending.entries },
        { canCommit: () => alive(token), signal: active.aborter.signal });
      if (!alive(token)) return;
      if (!updateDocument(result, () => alive(token))) return;
      collectionReview = null;
    });
  }
  async function prepareCollection() {
    let result = null;
    const completed = await operate("collectionExport", async token => {
      const expected = readyDocument().revision;
      const current = validateVaultDocument(await storage.read({ signal: active?.aborter.signal }));
      if (!alive(token)) return;
      if (current.revision !== expected) transferFail("TRANSFER_VAULT_STALE");
      result = await prepareVaultCollection(current, { subtle, signal: active.aborter.signal });
      if (!alive(token)) result = null;
    });
    return completed && !disposed ? result : null;
  }
  function stageCard(agent) {
    return operate("stageCard", async token => {
      if (!VAULT_AGENTS.includes(agent)) transferFail("TRANSFER_VAULT_CONTEXT");
      const archive = working.slots.find(slot => slot.agent === agent).archive;
      if (!archive) transferFail("TRANSFER_VAULT_EMPTY");
      const staged = await stageArchive(agent, archive, { current: () => alive(token) });
      if (!alive(token)) return;
      if (staged !== true) transferFail("TRANSFER_VAULT_CARD_REVIEW");
    });
  }
  function cancel() {
    if (disposed) return;
    const token = ++sequence, previous = active;
    active = null;
    previous?.aborter.abort();
    if (disposed || sequence !== token) return;
    review = null;
    collectionReview = null;
    error = null;
    lastAction = "cancel";
    publish();
  }
  function invalidateCards() {
    if (disposed) return;
    cardsEpoch++;
    cardsChanged = true;
    if (review?.source === "cards") review = null;
    if (active?.action === "stageCard") {
      const token = ++sequence, previous = active;
      active = null;
      previous.aborter.abort();
      if (disposed || sequence !== token) return;
    }
    publish();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    sequence++;
    observers.clear();
    const previous = active;
    active = null;
    review = null;
    collectionReview = null;
    previous?.aborter.abort();
    timeline.clear();
    storage.close();
  }
  return Object.freeze({ get state() { return state(); }, undo, redo, capture, load, loadLegacy, apply, refresh, select, save,
    inspectSelected, editSelected, prepare, loadCollection, applyCollection, prepareCollection, stageCard, cancel, invalidateCards, dispose });
}
