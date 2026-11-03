# Report-set selection, import and export lifecycle

Continuation items **229–231**, source `d631183`:

229. Retire set preparation when cancellation, review invalidation or a selection change occurs during the clock callback. A cancelled selection capture cannot overwrite the newer selection.
230. Validate storage/import results into local captured values before publishing. Cancellation during record capture or checksum metadata evaluation cannot adopt a late document or recreate a review.
231. Stop export preparation after cancelled option capture, bound recursive view notifications and consume malformed asynchronous observer failures. Return status follows cancellation during completion notification, while already adopted records remain intact.

All **11 new regressions fail before the fix**. The **55-test** controller/lifecycle run and **194-test** panel/workflow/export-receipt/notifier/callback run pass with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-report-set-lifecycle/before.log), [targets](evidence/2026-10-30-report-set-lifecycle/related.log), [integration](evidence/2026-10-30-report-set-lifecycle/integration.log), [checksums](evidence/2026-10-30-report-set-lifecycle/SHA256SUMS.txt).

The set controller remains a read-only storage consumer. These tests use synthetic evidence and local test files; they do not update the user's browser records or publish anything. No signature, transaction, approval or private-key operation occurred. The previous full-wallet validation at `f239e04` predates this change.
