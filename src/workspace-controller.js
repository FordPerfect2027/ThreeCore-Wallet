import { captureWorkspaceDraft, workspaceDraftKey, workspaceOptions, previewWorkspace,
  workspaceFail, WorkspaceError, freezeWorkspace } from "./workspace-format.js";

/** Synchronous transaction coordinator. The adapter writes local form/history data only. */
export function createWorkspaceController({ readDraft, writeDraft }) {
  if (typeof readDraft !== "function" || typeof writeDraft !== "function") workspaceFail("WORKSPACE_ADAPTER");
  let pending = null;
  let undo = null;
  let emergency = null;
  let sequence = 0;
  let disposed = false;
  let writing = false;
  function available() {
    if (disposed) workspaceFail("WORKSPACE_DISPOSED");
    if (writing) workspaceFail("WORKSPACE_BUSY");
    if (emergency) workspaceFail("WORKSPACE_RECOVERY_REQUIRED");
  }
  function cancel() {
    pending = null;
    sequence++;
  }
  function capture() { return captureWorkspaceDraft(readDraft()); }
  function write(after, before) {
    writing = true;
    try {
      const result = writeDraft(after);
      if (result && typeof result.then === "function") workspaceFail("WORKSPACE_ADAPTER");
      if (workspaceDraftKey(capture()) !== workspaceDraftKey(after)) workspaceFail("WORKSPACE_WRITE_MISMATCH");
    } catch (error) {
      emergency = before;
      try {
        writeDraft(before);
        if (workspaceDraftKey(capture()) !== workspaceDraftKey(before)) workspaceFail("WORKSPACE_WRITE_MISMATCH");
        emergency = null;
      } catch {
        workspaceFail("WORKSPACE_RECOVERY_REQUIRED");
      }
      throw new WorkspaceError("WORKSPACE_ROLLED_BACK", error?.code || "Local write failed");
    } finally {
      writing = false;
    }
  }
  return Object.freeze({
    preview(text, options) {
      available();
      cancel();
      const result = previewWorkspace(text, capture(), options);
      pending = { id: sequence, text, optionsKey: JSON.stringify(result.options),
        beforeKey: workspaceDraftKey(result.before), result };
      return freezeWorkspace({ id: sequence, ...result });
    },
    apply(id, text, options) {
      available();
      const candidate = pending;
      cancel();
      if (!candidate || candidate.id !== id || candidate.text !== text ||
          JSON.stringify(workspaceOptions(options)) !== candidate.optionsKey) workspaceFail("WORKSPACE_REVIEW_REQUIRED");
      const before = capture();
      if (workspaceDraftKey(before) !== candidate.beforeKey) workspaceFail("WORKSPACE_STALE");
      const result = previewWorkspace(text, before, options);
      if (!result.changed) return result;
      write(result.after, before);
      undo = { before, afterKey: workspaceDraftKey(capture()) };
      return result;
    },
    undoPreview() {
      available();
      cancel();
      if (!undo) workspaceFail("WORKSPACE_NO_UNDO");
      const before = capture();
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
      if (!undo || !candidate || candidate.type !== "undo" || candidate.id !== id) workspaceFail("WORKSPACE_REVIEW_REQUIRED");
      const before = capture();
      if (workspaceDraftKey(before) !== candidate.beforeKey) workspaceFail("WORKSPACE_UNDO_STALE");
      write(undo.before, before);
      undo = null;
      return capture();
    },
    state() {
      let undoAvailable = false;
      if (!disposed && !writing && !emergency && undo) {
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
