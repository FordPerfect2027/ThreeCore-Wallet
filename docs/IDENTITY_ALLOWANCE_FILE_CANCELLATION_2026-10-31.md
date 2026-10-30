# Identity and allowance file cancellation

Continuation items **275–276**, source `47d1248`.

275. Give identity imports and output preparation an owning abort controller. Cancellation, invalidation and disposal now end local byte-read/hash waits. Cleanup clears only the handle belonging to the completed operation.
276. Apply the same ownership to read-only allowance imports and output preparation. A cancelled operation cannot publish a file or replace a newer operation's abort handle.

All **12 regressions failed before the fix**: two controllers, cancel/dispose, and byte import, hash import and hash export. The focused controller/lifecycle run passed **104 tests**. The final identity, allowance and file-reader integration run passed **1,084 tests**, zero failures, cancellations or skips (10251.0738 ms). Tests use synthetic records and adapters, with no actual wallet reads or approval requests. Native hashing and non-cancellable file work may keep draining under the shared reservations after the local wait ends.

Evidence: [before](evidence/2026-10-31-identity-allowance-file-cancellation/before.log), [focused](evidence/2026-10-31-identity-allowance-file-cancellation/fixed.log), [integration](evidence/2026-10-31-identity-allowance-file-cancellation/integration.log), [SHA-256](evidence/2026-10-31-identity-allowance-file-cancellation/SHA256SUMS.txt).

No signatures, transactions, approvals, private-key retrieval, publication or deployment occurred. This is subsequent to the full-wallet checkpoint through item 260, rather than a new mainnet-readiness estimate.
