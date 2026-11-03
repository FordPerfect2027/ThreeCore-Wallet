# Period-read checkpoint and handoff lifecycle

Continuation items **235–238**, source `2fb6b3f`:

235. Retain read ownership before the initial context callback and through final context/result validation. A cancelled start cannot call the reader, and a cancelled final check cannot mark the draft complete or checked in this session.
236. Capture progress fields without executing accessors and recheck ownership after progress/checkpoint reflection. Cancelled callbacks cannot advance the stored working draft or publish stale progress.
237. Retain each interruption's own generation and abort handle, preserving a newer start triggered during an abort callback. Bound view notifications and consume malformed asynchronous observer failures.
238. Observe reconciliation-receiver results safely, reject asynchronous delivery acknowledgements, and suppress success after callback cancellation. A callback already invoked is not described as undone.

All **12 new regressions fail before the fix**. The **94-test** controller/review/progress run and **208-test** lifecycle/panel/invariant/provider/library-workflow/notifier/callback run pass with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-period-read-lifecycle/before.log), [targets](evidence/2026-10-30-period-read-lifecycle/related.log), [integration](evidence/2026-10-30-period-read-lifecycle/integration.log), [checksums](evidence/2026-10-30-period-read-lifecycle/SHA256SUMS.txt).

Tests use synthetic readers/providers and saved drafts. This does not increase actual scanned-block coverage or reverse RPC requests already sent. No real signature, transaction, approval or private-key operation occurred. The previous full-wallet validation at `f239e04` predates this change.
