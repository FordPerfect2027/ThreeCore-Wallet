import { createVaultTimeline } from "./transfer-vault-timeline.js";
import { prepareVaultCollection, readVaultCollection, reviewVaultCollection } from "./transfer-vault-collection.js";
import { transferFail } from "./transfer-codec.js";
import { VAULT_AGENTS, vaultBundle, validateVaultBundle, vaultKey, vaultHasRecords, reviewVaultReplacement,
  mergeVaultBundles, validateVaultDocument, vaultMetadata, vaultLabel, vaultId, vaultTime } from "./transfer-vault-model.js";
import { prepareVaultFile, readVaultFile, readLegacyVaultInput } from "./transfer-vault-file.js";
import { vaultActivityCsv, vaultActivityText, vaultFilteredActivityCsv } from "./transfer-vault-analytics.js";

/** Offline working copy + opt-in storage. Nothing opens, reads or saves at mount. */
export function createVaultController({ storage, readCards, stageArchive, onChange = () => {},
  now = () => new Date().toISOString(), createId = () => globalThis.crypto.randomUUID(), subtle } = {}) {
  if (!storage || !["read", "change", "close"].every(key => typeof storage[key] === "function") ||
      ![readCards, stageArchive, onChange, now, createId].every(fn => typeof fn === "function")) {
    transferFail("TRANSFER_VAULT_ADAPTER");
  }
  const timeline = createVaultTimeline();
  let disposed = false, sequence = 0, revision = 0;
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
  function publish() {
    if (disposed) return;
    try { Promise.resolve(onChange(state())).catch(() => {}); } catch { /* Observers cannot authorize a save. */ }
  }
  function errorCode(value) {
    try { return typeof value?.code === "string" && /^(TRANSFER|CHECKPOINT)_[A-Z_]+$/.test(value.code) ? value.code : "TRANSFER_VAULT_ACTION"; }
    catch { return "TRANSFER_VAULT_ACTION"; }
  }
  function report(value) {
    error = errorCode(value);
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
    try {
      if (!alive(token)) return false;
      await fn(token);
      if (!alive(token)) return false;
      lastAction = action;
      return true;
    } catch (failure) {
      if (alive(token)) report(failure);
      return false;
    } finally {
      if (alive(token)) { active = null; publish(); }
    }
  }
  function stage(bundle, source, merge = false, extra = {}) {
    const target = merge ? mergeVaultBundles(working, bundle) : validateVaultBundle(bundle);
    const replacement = reviewVaultReplacement(working, target);
    collectionReview = null;
    review = Object.freeze({ id: ++sequence, revision, source, ...replacement, ...extra });
    error = null;
  }
  function changeWorking(bundle) {
    working = validateVaultBundle(bundle);
    revision++;
    review = null;
    error = null;
    cardsChanged = false;
  }
  function updateDocument(value) {
    document = validateVaultDocument(value);
    if (savedKey && !document.entries.some(row => vaultKey(row.bundle) === savedKey)) savedKey = null;
    if (!entry()) selectedId = null;
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
    const latest = validateVaultDocument(await storage.read());
    if (!alive(token)) transferFail("TRANSFER_VAULT_CANCELLED");
    if (latest.revision !== expected) transferFail("TRANSFER_VAULT_STALE");
    const current = latest.entries.find(row => row.id === selected.id);
    if (!current) transferFail("TRANSFER_VAULT_MISSING");
    return current;
  }
  function capture(merge = false) {
    if (disposed || busy()) return false;
    try {
      const captured = validateVaultBundle(readCards());
      if (!vaultHasRecords(captured)) transferFail("TRANSFER_VAULT_EMPTY");
      stage(captured, "cards", merge, { cardsKey: vaultKey(captured) });
      publish();
      return true;
    } catch (failure) { return report(failure); }
  }
  function load(file, merge = false) {
    return operate("fileReview", async token => {
      review = null;
      const result = await readVaultFile(file, { subtle });
      if (alive(token)) stage(result.bundle, "file", merge, { digest: result.digest });
    });
  }
  function loadLegacy(file, kind, agent, merge = false) {
    return operate("legacyReview", async token => {
      review = null;
      if (!VAULT_AGENTS.includes(agent)) transferFail("TRANSFER_VAULT_CONTEXT");
      const archive = await readLegacyVaultInput(file, kind, { subtle });
      if (!alive(token)) return;
      if (archive.records[0].context.agent !== agent) transferFail("TRANSFER_VAULT_CONTEXT");
      const archives = working.slots.map(slot => slot.agent === agent ? archive : slot.archive);
      const single = vaultBundle(archives);
      stage(single, "legacy", merge);
    });
  }
  async function apply(id, { acknowledgeRemoval = false } = {}) {
    return operate("apply", async token => {
      const pending = review;
      if (!pending || pending.id !== id || pending.revision !== revision || pending.beforeKey !== vaultKey(working)) {
        transferFail("TRANSFER_VAULT_REVIEW_REQUIRED");
      }
      if (pending.removesRecords && acknowledgeRemoval !== true) transferFail("TRANSFER_VAULT_CONFIRMATION");
      if (pending.source === "cards" && pending.cardsKey !== vaultKey(readCards())) transferFail("TRANSFER_VAULT_CARDS_CHANGED");
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
      const result = await storage.read();
      if (alive(token)) updateDocument(result);
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
      const operation = { kind: "save", id: vaultId(createId()), label: vaultLabel(label), time: vaultTime(now()), bundle };
      const result = await storage.change(stored.revision, operation, {
        canCommit: () => alive(token) && revision === workingRevision && vaultKey(working) === key,
        signal: active.aborter.signal,
      });
      if (!alive(token)) return;
      updateDocument(result);
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
      stage(row.bundle, "stored", merge, { entryId: row.id, entryKey: vaultKey(row.bundle) });
    });
  }
  function editSelected(kind, value) {
    return operate(kind, async token => {
      review = null;
      const row = selection();
      const operation = kind === "rename" ? { kind, id: row.id, label: vaultLabel(value), time: vaultTime(now()) } :
        kind === "purge" ? { kind, id: row.id, confirmed: value === true } : { kind, id: row.id, time: vaultTime(now()) };
      const result = await storage.change(document.revision, operation, { canCommit: () => alive(token), signal: active.aborter.signal });
      if (alive(token)) updateDocument(result);
    });
  }
  async function prepare(kind = "json", stored = false, query) {
    let result = null;
    const completed = await operate("export", async token => {
      const source = stored ? (await freshSelection(token)).bundle : working;
      if (!alive(token)) return;
      if (!vaultHasRecords(source)) transferFail("TRANSFER_VAULT_EMPTY");
      if (kind === "json") result = await prepareVaultFile(source, { subtle });
      else if (kind === "filtered-csv") {
        if (stored) transferFail("TRANSFER_VAULT_FILE_KIND");
        const report = vaultFilteredActivityCsv(source, query);
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
      const result = await readVaultCollection(file, { subtle });
      if (!alive(token)) return;
      collectionReview = Object.freeze({ id: ++sequence, ...reviewVaultCollection(before, result.document) });
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
      updateDocument(result);
      collectionReview = null;
    });
  }
  async function prepareCollection() {
    let result = null;
    const completed = await operate("collectionExport", async token => {
      const expected = readyDocument().revision;
      const current = validateVaultDocument(await storage.read());
      if (!alive(token)) return;
      if (current.revision !== expected) transferFail("TRANSFER_VAULT_STALE");
      result = await prepareVaultCollection(current, { subtle });
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
    sequence++;
    active?.aborter.abort();
    active = null;
    review = null;
    collectionReview = null;
    error = null;
    lastAction = "cancel";
    publish();
  }
  function invalidateCards() {
    if (disposed) return;
    cardsChanged = true;
    if (review?.source === "cards") review = null;
    if (active?.action === "stageCard") { sequence++; active.aborter.abort(); active = null; }
    publish();
  }
  function dispose() {
    if (disposed) return;
    cancel();
    disposed = true;
    timeline.clear();
    storage.close();
  }
  return Object.freeze({ get state() { return state(); }, undo, redo, capture, load, loadLegacy, apply, refresh, select, save,
    inspectSelected, editSelected, prepare, loadCollection, applyCollection, prepareCollection, stageCard, cancel, invalidateCards, dispose });
}
