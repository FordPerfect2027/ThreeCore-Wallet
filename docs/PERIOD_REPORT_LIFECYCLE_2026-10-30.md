# Period-report review and history handoff lifecycle

Continuation items **232–234**, source `f5c7ed4`:

232. Retire old reviews when the clock callback cancels, invalidates the review or changes selection. A new invalid history handoff now clears the previous pending candidate, so that older candidate cannot subsequently be applied.
233. Guard history, storage and imported-report capture before publishing. A cancelled history handoff cannot stage evidence; cancellation during document or checksum metadata capture cannot adopt late records or recreate a review.
234. Bound period-report view notifications, consume malformed asynchronous observer failures and return cancellation-aware completion status. Already adopted records are preserved rather than described as rolled back.

All **11 new regressions fail before the fix**. The **51-test** controller/lifecycle run and **122-test** period-report panel/workflow, history handoff and export-receipt run pass with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-period-report-lifecycle/before.log), [targets](evidence/2026-10-30-period-report-lifecycle/related.log), [integration](evidence/2026-10-30-period-report-lifecycle/integration.log), [checksums](evidence/2026-10-30-period-report-lifecycle/SHA256SUMS.txt).

These are synthetic report and storage checks. The period-report controller remains a read-only storage consumer. No real signature, transaction, approval or private-key operation occurred. The previous full-wallet validation at `f239e04` predates this change.
