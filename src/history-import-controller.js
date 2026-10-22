import { createPortfolioHistory, PortfolioHistoryError } from "./portfolio-history.js";

/**
 * Two-step import workflow. A preview never mutates the destination history.
 * Applying requires the exact text and revision originally reviewed.
 * This controller has no storage or provider access and cannot connect wallets.
 */
export function createHistoryImportController(history) {
  if (!history || typeof history.state !== "function" || typeof history.importText !== "function") {
    throw new TypeError("A portfolio history collection is required");
  }
  let pending = null;
  let sequence = 0;

  function fail(code, message) {
    throw new PortfolioHistoryError(code, message);
  }

  function preview(text, { replace = false } = {}) {
    // Invalidate the previous preview even if the new document is malformed.
    pending = null;
    sequence++;
    const before = history.state();
    const scratch = createPortfolioHistory({ capacity: before.capacity });
    scratch.merge(before.snapshots);
    const outcome = scratch.importText(text, { replace });
    const after = scratch.state();
    const review = Object.freeze({
      previewId: sequence,
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
    pending = { text, replace, review };
    return review;
  }

  function apply(previewId, text) {
    const proposal = pending;
    // An apply attempt is single-use, including rejected or stale attempts.
    pending = null;
    if (!proposal || previewId !== proposal.review.previewId) {
      fail("MISSING_PREVIEW", "Preview the document again before applying");
    }
    if (text !== proposal.text) {
      fail("CHANGED_IMPORT", "The document changed after preview");
    }
    if (history.state().revision !== proposal.review.expectedRevision) {
      fail("STALE_HISTORY", "The collection changed after preview");
    }
    return history.importText(proposal.text, { replace: proposal.replace });
  }

  function cancel() {
    const hadPreview = pending !== null;
    pending = null;
    return hadPreview;
  }

  function state() {
    return Object.freeze({
      pending: pending !== null,
      preview: pending?.review ?? null,
    });
  }

  return Object.freeze({ preview, apply, cancel, state });
}
