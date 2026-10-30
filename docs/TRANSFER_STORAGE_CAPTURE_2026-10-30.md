# Preserve validated history in storage and queries

Continuation items **196–198**:

196. Capture history archive envelopes and bounded record arrays before normalization. Input-provided map methods cannot replace observed rows, and indexed accessors cannot run while importing an archive.
197. Capture three-agent vault slots, stored entry arrays, revisions, flags and mutation operands. Save/rename/import/archive operations use the data actually validated. A changing operation kind or revoked operation is rejected with a public error. Existing atomic storage, capacity and confirmation rules remain in place.
198. Capture history and vault activity queries before validating and returning them. A page size cannot pass the 100-row bound and then become unbounded through a later spread/property read.

All **14 new regressions failed before** these changes. **206 targeted tests** and the **694-test transfer suite** pass afterward, with no failures, skips or cancellations. The broader run used fixed source `3047dbf`. [Before](evidence/2026-10-30-transfer-storage-capture/before.log), [targeted](evidence/2026-10-30-transfer-storage-capture/related.log), [integration](evidence/2026-10-30-transfer-storage-capture/integration.log), [checksums](evidence/2026-10-30-transfer-storage-capture/SHA256SUMS.txt).

This batch tests local model, storage, workflow, file, view and panel behavior with fixtures. It does not claim a new native-browser vault save or real-chain scan. No user records were deleted and no signature, transaction, approval or private-key operation was performed.
