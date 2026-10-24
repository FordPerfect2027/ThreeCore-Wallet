import { captureWorkspaceDraft, workspaceDraftKey, workspaceOptions, previewWorkspace,
  workspaceFail, WorkspaceError, freezeWorkspace } from "./workspace-format.js";

/** Synchronous transaction coordinator. The adapter writes local form/history data only. */
export function createWorkspaceController({ readDraft, writeDraft, authorizeWrite = () => true }) {
  if (![readDraft, writeDraft, authorizeWrite].every(fn => typeof fn === "function")) workspaceFail("WORKSPACE_ADAPTER");
  let pending = null;
  let undo = null;
  let emergency = null;
  let sequence = 0;
  let disposed = false;
  let writing = false;
  let checking = false;
  function available() {
    if (disposed) workspaceFail("WORKSPACE_DISPOSED");
    if (writing || checking) workspaceFail("WORKSPACE_BUSY");
    if (emergency) workspaceFail("WORKSPACE_RECOVERY_REQUIRED");
  }
  function cancel() {
    pending = null;
    sequence++;
  }
  function checkRevision(id) {
    if (disposed || (id !== null && id !== sequence)) workspaceFail("WORKSPACE_REVIEW_REQUIRED");
  }
  function capture(id = null) {
    if (checking) workspaceFail("WORKSPACE_BUSY");
    checking = true;
    try {
      const draft = captureWorkspaceDraft(readDraft());
      checkRevision(id);
      return draft;
    } finally { checking = false; }
  }
  function syncResult(result) {
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(() => {});
      workspaceFail("WORKSPACE_ADAPTER");
    }
  }
  function write(after, before, revision) {
    // The UI's decrypted-data lifetime may expire while validation is running.
    // Check just before the first write; rollback must remain possible afterward.
    writing = true;
    let expectedKey, beforeKey, prepared;
    try {
      expectedKey = workspaceDraftKey(after);
      beforeKey = workspaceDraftKey(before);
      prepared = captureWorkspaceDraft(after);
      const authorized = authorizeWrite();
      syncResult(authorized);
      checkRevision(revision);
      if (authorized !== true) workspaceFail("WORKSPACE_REVIEW_REQUIRED");
    } catch {
      writing = false;
      workspaceFail("WORKSPACE_REVIEW_REQUIRED");
    }
    try {
      // Copies isolate the rollback reference and expected target from adapter mutation.
      syncResult(writeDraft(prepared));
      if (workspaceDraftKey(capture()) !== expectedKey) workspaceFail("WORKSPACE_WRITE_MISMATCH");
    } catch (error) {
      emergency = before;
      try {
        syncResult(writeDraft(captureWorkspaceDraft(before)));
        if (workspaceDraftKey(capture()) !== beforeKey) workspaceFail("WORKSPACE_WRITE_MISMATCH");
        emergency = null;
      } catch {
        workspaceFail("WORKSPACE_RECOVERY_REQUIRED");
      }
      throw new WorkspaceError("WORKSPACE_ROLLED_BACK");
    } finally {
      writing = false;
    }
  }
  return Object.freeze({
    preview(text, options) {
      available();
      cancel();
      const id = sequence;
      const result = previewWorkspace(text, capture(id), options);
      checkRevision(id);
      pending = { id, text, optionsKey: JSON.stringify(result.options),
        beforeKey: workspaceDraftKey(result.before), result };
      return freezeWorkspace({ id, ...result });
    },
    apply(id, text, options) {
      available();
      const candidate = pending;
      cancel();
      const revision = sequence;
      if (!candidate || candidate.id !== id || candidate.text !== text ||
          JSON.stringify(workspaceOptions(options)) !== candidate.optionsKey) workspaceFail("WORKSPACE_REVIEW_REQUIRED");
      const before = capture(revision);
      if (workspaceDraftKey(before) !== candidate.beforeKey) workspaceFail("WORKSPACE_STALE");
      const result = previewWorkspace(text, before, options);
      if (!result.changed) return result;
      checkRevision(revision);
      write(result.after, before, revision);
      undo = { before, afterKey: workspaceDraftKey(result.after) };
      return result;
    },
    undoPreview() {
      available();
      cancel();
      if (!undo) workspaceFail("WORKSPACE_NO_UNDO");
      const revision = sequence;
      const before = capture(revision);
      if (workspaceDraftKey(before) !== undo.afterKey) workspaceFail("WORKSPACE_UNDO_STALE");
      const id = sequence;
      pending = { id, type: "undo", beforeKey: undo.afterKey };
      return freezeWorkspace({ id, before, after: undo.before,
        authorizesConnection: false, authorizesTransaction: false });
    },
    undoApply(id) {
      available();
      const candidate = pending;
      cancel();
      const revision = sequence;
      if (!undo || !candidate || candidate.type !== "undo" || candidate.id !== id) workspaceFail("WORKSPACE_REVIEW_REQUIRED");
      const before = capture(revision);
      if (workspaceDraftKey(before) !== candidate.beforeKey) workspaceFail("WORKSPACE_UNDO_STALE");
      write(undo.before, before, revision);
      undo = null;
      return capture();
    },
    state() {
      let undoAvailable = false;
      if (!disposed && !writing && !checking && !emergency && undo) {
        try { undoAvailable = workspaceDraftKey(capture()) === undo.afterKey; } catch { /* Invalid draft cannot authorize undo. */ }
      }
      return Object.freeze({ disposed, writing, hasUndo: !!undo, undoAvailable,
        recoveryRequired: !!emergency, pending: !!pending });
    },
    recoveryText() {
      if (disposed) workspaceFail("WORKSPACE_DISPOSED");
      const draft = emergency || undo?.before;
      if (!draft) workspaceFail("WORKSPACE_NO_UNDO");
      return JSON.stringify({ schema: "threecore-local-recovery-draft-v1", entries: draft }, null, 2);
    },
    cancel,
    dispose() {
      if (writing) workspaceFail("WORKSPACE_BUSY");
      disposed = true;
      pending = undo = emergency = null;
      sequence++;
    },
  });
}
