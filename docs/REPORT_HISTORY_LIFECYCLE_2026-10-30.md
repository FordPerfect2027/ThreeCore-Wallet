# Report-history review, commit and restore cancellation

Continuation items **226–228**, source `cdd31bd`:

226. Capture save/annotation fields without invoking accessors. Keep save/open review ownership through report, clock and ID callbacks; cancellation or review invalidation cannot recreate a pending review, overwrite a newer review, or start a later annotation/archive write.
227. Recheck cancellation after the final source read inside storage commit authorization, and after the final source check before opening a report. The isolated-storage regression proves that cancellation at the commit callback leaves zero persisted entries. Cancellation before opening leaves zero receiver calls.
228. Prevent late storage response adoption, preserve a newer refresh started during an abort callback, bound view notifications, and consume asynchronous restore-receiver failures without reporting delivery success.

All **17 new regressions fail before the fix**. The **66-test** controller/lifecycle run and broader **411-test** history/workflow/notifier/callback suite pass with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-report-history-lifecycle/before.log), [targets](evidence/2026-10-30-report-history-lifecycle/related.log), [integration](evidence/2026-10-30-report-history-lifecycle/integration.log), [checksums](evidence/2026-10-30-report-history-lifecycle/SHA256SUMS.txt).

These tests use synthetic reports and isolated in-memory storage. They do not claim to undo a write that already committed, and do not access the user's actual IndexedDB records. No signature, transaction, approval or private-key operation occurred. The previous full-wallet validation at `f239e04` predates this change.
