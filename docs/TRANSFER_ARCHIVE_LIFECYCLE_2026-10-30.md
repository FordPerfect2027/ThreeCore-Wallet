# Transfer archive lifecycle

Continuation items **241–243**, source `afb1d74`:

241. Own each archive addition, selection and review before reading external context. Recheck after record capture; cancellation or a newer review prevents stale results and failure messages from replacing the current state.
242. Recheck operation ownership after loading/preparing notifications, before file reading or checksum work. A cancelled preview notification returns failure. Applying an older review preserves a newer review triggered by a context callback.
243. Bound archive view notifications, contain malformed asynchronous observer failures, and make disposal terminal before clearing records. Diagnostic accessors are not invoked, and cancellation during diagnostic reflection suppresses stale errors.

All **16 new regressions failed** against the prior source. They were prepared outside the checkout while the preceding full test was running, with imports bound to the unchanged repository source. After applying the fix, **120 targeted** and **116 panel/controller integration tests** passed with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-transfer-archive-lifecycle/before.log), [targets](evidence/2026-10-30-transfer-archive-lifecycle/related.log), [integration](evidence/2026-10-30-transfer-archive-lifecycle/integration.log), [SHA-256](evidence/2026-10-30-transfer-archive-lifecycle/SHA256SUMS.txt).

Tests use fictional records and local in-memory archives. Already started file reads are discarded on cancellation; this change does not claim to stop their underlying work. No wallet signatures, transactions, approvals or private-key operations occurred. The full-wallet result at `e50123f` predates this change.
