import { createPortfolioHistory, PortfolioHistoryError, HISTORY_SCHEMA,
  HISTORY_LIMIT, captureHistoryImportOptions } from "./portfolio-history.js";
import { captureDataRecord, captureDataArray } from "./security-data.js";
import { validatePortfolioSnapshot } from "./portfolio-report.js";
import { observeCallbackResult } from "./security-callback.js";

const STATE_FIELDS = ["schema", "capacity", "revision", "size", "snapshots",
  "historicalObservation", "canAuthorizeConnection", "canAuthorizeTransaction", "securityAudit"];
const key = state => JSON.stringify([state.capacity, state.snapshots]);

/**
 * Two-step import workflow. A preview never mutates the destination history.
 * Applying requires the exact text and revision originally reviewed.
 * This controller has no storage or provider access and cannot connect wallets.
 */
export function createHistoryImportController(history) {
  let readState, writeHistory;
  try { readState = history?.state; writeHistory = history?.importText; } catch {}
  if (typeof readState !== "function" || typeof writeHistory !== "function") {
    throw new TypeError("A portfolio history collection is required");
  }
  let pending = null;
  let sequence = 0;
  let active = false;
  let disposed = false;
  let recoveryRequired = false;

  function fail(code, message) {
    throw new PortfolioHistoryError(code, message);
  }

  function available() {
    if (disposed) fail("IMPORT_DISPOSED", "Import controller is closed");
    if (recoveryRequired) fail("IMPORT_RECOVERY_REQUIRED", "Check current history before importing again");
    if (active) { cancel(); fail("IMPORT_BUSY", "Another import operation is active"); }
  }

  function current(id) {
    if (disposed || sequence !== id) fail("MISSING_PREVIEW", "Preview the document again before applying");
  }

  function capture(id) {
    current(id);
    const raw = Reflect.apply(readState, history, []);
    const kind = observeCallbackResult(raw);
    current(id);
    if (kind !== "synchronous") fail("IMPORT_ADAPTER", "History reads must be synchronous");
    let result;
    try {
      const data = captureDataRecord(raw, STATE_FIELDS);
      if (data.schema !== HISTORY_SCHEMA || data.historicalObservation !== true ||
          data.canAuthorizeConnection !== false || data.canAuthorizeTransaction !== false ||
          data.securityAudit !== false || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
          !Number.isInteger(data.capacity) || data.capacity < 1 || data.capacity > HISTORY_LIMIT) throw Error();
      const snapshots = captureDataArray(data.snapshots, data.capacity).map(validatePortfolioSnapshot);
      if (data.size !== snapshots.length) throw Error();
      result = Object.freeze({ ...data, snapshots: Object.freeze(snapshots) });
    } catch { fail("IMPORT_ADAPTER", "Invalid history state"); }
    current(id);
    return result;
  }

  function preview(text, options) {
    available();
    cancel();
    const id = sequence;
    active = true;
    try {
      const { replace } = captureHistoryImportOptions(options);
      current(id);
      const before = capture(id);
      const scratch = createPortfolioHistory({ capacity: before.capacity });
      scratch.merge(before.snapshots);
      const outcome = scratch.importText(text, { replace });
      const after = scratch.state();
      const latest = capture(id);
      if (latest.revision !== before.revision || key(latest) !== key(before)) {
        fail("STALE_HISTORY", "The collection changed during preview");
      }
      const review = Object.freeze({
        previewId: id,
        expectedRevision: before.revision,
        mode: replace ? "replace" : "merge",
        previousSize: before.size,
        resultingSize: after.size,
        added: outcome.added,
        duplicates: outcome.duplicates,
        groups: scratch.groups(),
        historicalObservation: true,
        canAuthorizeConnection: false,
        canAuthorizeTransaction: false,
      });
      current(id);
      pending = { text, replace, review, beforeKey: key(before), afterKey: key(after),
        changed: outcome.changed };
      return review;
    } finally { active = false; }
  }

  function apply(previewId, text, options) {
    available();
    const proposal = pending;
    // An apply attempt is single-use, including rejected or stale attempts.
    cancel();
    const id = sequence;
    if (!proposal || previewId !== proposal.review.previewId) {
      fail("MISSING_PREVIEW", "Preview the document again before applying");
    }
    active = true;
    try {
      if (text !== proposal.text || (options !== undefined &&
          captureHistoryImportOptions(options).replace !== proposal.replace)) {
        fail("CHANGED_IMPORT", "The document or import mode changed after preview");
      }
      current(id);
      const before = capture(id);
      if (before.revision !== proposal.review.expectedRevision || key(before) !== proposal.beforeKey) {
        fail("STALE_HISTORY", "The collection changed after preview");
      }
      current(id);
      let receipt;
      try { receipt = Reflect.apply(writeHistory, history, [proposal.text,
        Object.freeze({ replace: proposal.replace })]); }
      catch {
        recoveryRequired = true;
        fail("IMPORT_RECOVERY_REQUIRED", "The write did not complete reliably; check current history");
      }
      if (observeCallbackResult(receipt) !== "synchronous") {
        recoveryRequired = true;
        fail("IMPORT_RECOVERY_REQUIRED", "An asynchronous write cannot confirm this import");
      }
      // Verify the actual destination. Do not roll back over newer user edits or
      // claim success from an adapter's receipt alone. An uncertain write locks
      // imports until the host independently reconciles the data and remounts.
      let actual;
      try {
        current(id);
        actual = capture(id);
        if (receipt === false || key(actual) !== proposal.afterKey ||
            actual.revision !== before.revision + (proposal.changed ? 1 : 0)) {
          fail("IMPORT_WRITE_MISMATCH", "The imported history did not match the review");
        }
      } catch (error) { recoveryRequired = true; throw error; }
      return Object.freeze({ added: proposal.review.added, duplicates: proposal.review.duplicates,
        changed: proposal.changed, state: actual });
    } finally { active = false; }
  }

  function cancel() {
    const hadPreview = pending !== null;
    pending = null;
    sequence++;
    return hadPreview;
  }

  function state() {
    return Object.freeze({
      pending: pending !== null,
      preview: pending?.review ?? null,
      disposed, active, recoveryRequired,
    });
  }

  function dispose() { disposed = true; cancel(); }
  return Object.freeze({ preview, apply, cancel, state, dispose });
}
