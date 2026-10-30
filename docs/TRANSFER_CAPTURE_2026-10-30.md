# Stable bounded transfer observations

Continuation items **193–194**:

193. Capture transfer requests, contexts, event/log records, topics, snapshot ranges and bounded event arrays from own data. Do not execute an input array's iterator or method. A custom iterator can no longer turn a nonempty event array into accepted empty history, and topic accessors are rejected without execution. The wallet adapter captures the requested range/direction before any RPC and checks the session again after decoding.
194. The collector validates and detaches each returned event before directional filtering and before another asynchronous read. It also retains the already-validated metadata copy. A later reply cannot change a previously accepted event amount or token supply. Cancellation/session checks follow input capture.

All **12 new regressions failed before** the fix. **175 targeted tests** and **2,039 related transfer, period, reconciliation and post-read guard tests** pass after it, with no failures, skips or cancellations. The integration run used fixed source `48b9798`. [Before](evidence/2026-10-30-transfer-capture/before.log), [targeted](evidence/2026-10-30-transfer-capture/related.log), [integration](evidence/2026-10-30-transfer-capture/integration.log), [checksums](evidence/2026-10-30-transfer-capture/SHA256SUMS.txt).

The tests use synthetic adapters and data. They are not a new scan of any real blockchain range, a security audit or evidence that a provider supplied complete history. Public formats and the existing 2,000-block, 500-event and 100-header bounds remain unchanged. No signature, transfer, approval or private-key operation was performed. Legacy archive/vault callers that ignore the capture returned by the shared shape helper are outside this batch.
