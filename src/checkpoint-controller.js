import { checkpointFail, CheckpointError, checkpointLabel, checkpointId, checkpointTime,
  checkpointMetadata, validateCheckpointDocument } from "./checkpoint-model.js";
import { workspaceDraftKey, workspaceFromDraft, workspaceToDraft } from "./workspace-format.js";
import { prepareWorkspaceFile, decodeWorkspaceFile } from "./workspace-file.js";
import { describeWorkspaceOverview } from "./workspace-overview.js";
import { prepareCheckpointCollection, decodeCheckpointCollection,
  reviewCheckpointImport, describeCheckpointImport } from "./checkpoint-transfer.js";
import { consumeCallback, observeCallbackResult } from "./security-callback.js";

/** Explicit actions only; the only restore action stages data for another preview. */
export function createCheckpointController({ storage, readDraft, onStage, download,
  onChange = () => {}, now = () => new Date().toISOString(),
  createId = () => globalThis.crypto.randomUUID(), subtle } = {}) {
  if (!storage || !["read", "change", "close"].every(key => typeof storage[key] === "function") ||
      ![readDraft, onStage, download, onChange, now, createId].every(value => typeof value === "function")) {
    checkpointFail("CHECKPOINT_ADAPTER");
  }
  let document = null;
  let selectedId = null;
  let inspected = null;
  let phase = "idle";
  let errorCode = null;
  let lastAction = null;
  let disposed = false;
  let generation = 0;
  let active = null;
  let changedDuringSave = false;
  let importReview = null;
  let importGeneration = 0;
  const busy = () => active !== null;
  function selected() { return document?.entries.find(row => row.id === selectedId) ?? null; }
  function state() {
    const entry = selected();
    return Object.freeze({
      phase, busy: busy(), activeAction: active?.action ?? null, disposed, errorCode, lastAction,
      metadata: document ? checkpointMetadata(document) : null,
      selectedId: entry?.id ?? null, selectedArchived: entry?.archived ?? false,
      inspection: inspected?.text ?? "", checksumVerified: !!inspected,
      canStage: !!inspected && !entry?.archived && !busy() && !disposed,
      currentDraftChanged: changedDuringSave,
      importDescription: importReview?.description ?? "",
      canImport: !!importReview && !busy() && !disposed,
    });
  }
  function publish() {
    if (!disposed) consumeCallback(() => onChange(state()));
  }
  function handoff(callback, value, code) {
    const receipt = callback(value);
    if (observeCallbackResult(receipt) !== "synchronous" || receipt === false) checkpointFail(code);
  }
  function begin(action) {
    if (disposed) checkpointFail("CHECKPOINT_CLOSED");
    if (busy()) checkpointFail("CHECKPOINT_BUSY");
    const token = ++generation;
    active = { token, action, aborter: new AbortController() };
    if (!["importApply", "importReview"].includes(action)) { importReview = null; importGeneration++; }
    phase = "working";
    errorCode = null;
    lastAction = null;
    publish();
    return token;
  }
  function alive(token) { return !disposed && active?.token === token; }
  function update(value) {
    document = validateCheckpointDocument(value);
    if (!document.entries.some(entry => entry.id === selectedId)) selectedId = null;
    inspected = null;
  }
  function ready() { if (!document) checkpointFail("CHECKPOINT_REFRESH_REQUIRED"); }
  function selection() {
    ready();
    const entry = selected();
    if (!entry) checkpointFail("CHECKPOINT_SELECTION");
    return entry;
  }
  async function operate(action, run) {
    let token;
    try {
      token = begin(action);
      if (!alive(token)) return false;
      await run(token);
      if (!alive(token)) return false;
      phase = "ready";
      lastAction = action;
      return true;
    } catch (error) {
      if (token === undefined || !alive(token)) return false;
      phase = "error";
      errorCode = error instanceof CheckpointError || typeof error?.code === "string"
        ? error.code : "CHECKPOINT_ACTION";
      inspected = null;
      importReview = null;
      // A stale document must be reloaded before any further mutation.
      if (errorCode === "CHECKPOINT_STALE") { document = null; selectedId = null; }
      return false;
    } finally {
      if (token !== undefined && alive(token)) { active = null; publish(); }
    }
  }
  async function verify(entry) {
    return decodeWorkspaceFile(new TextEncoder().encode(entry.fileText), { subtle });
  }
  async function freshSelection(token) {
    const original = selection();
    const revision = document.revision;
    const current = await storage.read({ signal: active?.aborter.signal });
    if (!alive(token)) checkpointFail("CHECKPOINT_CANCELLED");
    if (current.revision !== revision) checkpointFail("CHECKPOINT_STALE");
    const found = validateCheckpointDocument(current).entries.find(row => row.id === original.id);
    if (!found || found.fileText !== original.fileText) checkpointFail("CHECKPOINT_STALE");
    return found;
  }
  async function metadataMutation(kind, label, confirmed) {
    return operate(kind, async token => {
      const entry = selection();
      const operation = kind === "purge" ? { kind, id: entry.id, confirmed } :
        kind === "rename" ? { kind, id: entry.id, label: checkpointLabel(label), time: checkpointTime(now()) } :
          { kind, id: entry.id, time: checkpointTime(now()) };
      const result = await storage.change(document.revision, operation, { canCommit: () => alive(token), signal: active?.aborter.signal });
      if (alive(token)) update(result);
    });
  }
  return Object.freeze({
    state,
    refresh: () => operate("refresh", async token => {
      const current = await storage.read({ signal: active?.aborter.signal });
      if (alive(token)) update(current);
    }),
    exportCollection: () => operate("exportCollection", async token => {
      ready();
      const current = await storage.read({ signal: active?.aborter.signal });
      if (!alive(token)) return;
      if (current.revision !== document.revision) checkpointFail("CHECKPOINT_STALE");
      const prepared = await prepareCheckpointCollection(current, { subtle });
      if (alive(token)) handoff(download, prepared, "CHECKPOINT_EXPORT_REFUSED");
    }),
    reviewImport: text => operate("importReview", async token => {
      const importToken = ++importGeneration;
      importReview = null;
      ready();
      const decoded = await decodeCheckpointCollection(text, { subtle });
      if (!alive(token)) return;
      if (importToken !== importGeneration) checkpointFail("CHECKPOINT_CANCELLED");
      const review = reviewCheckpointImport(document, decoded.entries);
      importReview = { text, entries: decoded.entries, revision: document.revision,
        description: describeCheckpointImport(review) };
    }),
    applyImport: text => operate("importApply", async token => {
      const importToken = importGeneration;
      const proposal = importReview;
      importReview = null;
      ready();
      if (!proposal || proposal.text !== text) checkpointFail("CHECKPOINT_IMPORT_REVIEW");
      const result = await storage.change(proposal.revision, { kind: "import", entries: proposal.entries },
        { canCommit: () => alive(token) && importToken === importGeneration, signal: active?.aborter.signal });
      if (alive(token)) update(result);
    }),
    cancelImport() {
      importGeneration++;
      importReview = null;
      publish();
    },
    save: label => operate("save", async token => {
      ready();
      const normalizedLabel = checkpointLabel(label);
      const draft = readDraft();
      const key = workspaceDraftKey(draft);
      const prepared = await prepareWorkspaceFile(workspaceFromDraft(draft), { subtle });
      if (!alive(token)) return;
      const id = checkpointId(createId());
      const time = checkpointTime(now());
      const canCommit = () => {
        if (!alive(token)) return false;
        if (workspaceDraftKey(readDraft()) !== key) checkpointFail("CHECKPOINT_DRAFT_CHANGED");
        return true;
      };
      canCommit();
      const result = await storage.change(document.revision,
        { kind: "save", id, label: normalizedLabel, time, fileText: prepared.text }, { canCommit, signal: active?.aborter.signal });
      if (alive(token)) {
        update(result);
        selectedId = id;
        changedDuringSave = workspaceDraftKey(readDraft()) !== key;
      }
    }),
    select(id) {
      if (disposed || busy()) return false;
      ready();
      if (id !== null) {
        checkpointId(id);
        if (!document.entries.some(row => row.id === id)) checkpointFail("CHECKPOINT_SELECTION");
      }
      selectedId = id;
      inspected = null;
      errorCode = null;
      lastAction = null;
      phase = "ready";
      publish();
      return true;
    },
    inspect: () => operate("inspect", async token => {
      const entry = await freshSelection(token);
      const file = await verify(entry);
      if (!alive(token)) return;
      inspected = { id: entry.id, digest: file.digest,
        text: "控え: " + entry.label + "\n保存日時（このPCの時刻）: " + entry.createdAt +
          "\nファイル破損確認: 一致\n\n" + describeWorkspaceOverview(workspaceToDraft(file.workspace)) };
    }),
    stage: () => operate("stage", async token => {
      const entry = await freshSelection(token);
      if (!inspected || inspected.id !== entry.id || entry.archived) checkpointFail("CHECKPOINT_INSPECTION_REQUIRED");
      const file = await verify(entry);
      if (!alive(token)) return;
      if (file.digest !== inspected.digest) checkpointFail("CHECKPOINT_STALE");
      // Existing workspace panel still requires preview and confirmation.
      handoff(onStage, file.text, "CHECKPOINT_STAGE_REFUSED");
    }),
    exportFile: () => operate("export", async token => {
      const entry = await freshSelection(token);
      const file = await verify(entry);
      if (!alive(token)) return;
      handoff(download, { text: entry.fileText, filename: "ThreeCore-checkpoint-" + entry.id + ".json",
        mimeType: "application/json;charset=utf-8", digest: file.digest }, "CHECKPOINT_EXPORT_REFUSED");
    }),
    rename: label => metadataMutation("rename", label),
    archive: () => metadataMutation("archive"),
    unarchive: () => metadataMutation("unarchive"),
    purge: confirmed => metadataMutation("purge", undefined, confirmed),
    invalidateDraft() {
      if (disposed) return;
      changedDuringSave = true;
      publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      phase = "disposed";
      const aborter = active?.aborter;
      active = null;
      document = inspected = null;
      importReview = null;
      aborter?.abort();
      consumeCallback(() => storage.close());
    },
  });
}
