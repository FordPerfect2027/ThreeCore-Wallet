# Checkpoint checksum and import cancellation

Continuation items **281–282**, source `279c8e9`.

281. Forward the current checkpoint operation signal to workspace/collection checksums during save, collection export/import review, inspection, restore staging and individual export. Disposal ends all six local hash waits without later downloads, staging or writes.
282. Cancelling an active import review or apply retires its operation and aborts its signal immediately. A cancelled apply invalidates cached metadata because a storage outcome may need rechecking. A later refresh owns its own handle and cannot be cleared by the cancelled operation's eventual completion. Existing cancellation diagnostics remain available.

All seven original regressions failed before the fix. An additional queued-storage test checks signal abortion, revoked commit permission, invalidated metadata and ownership of the following refresh. The initial checkpoint-focused run passed **334 tests**; the final expanded run passed **335 tests**, with zero failures, cancellations or skips (6758.6377 ms).

Evidence: [before](evidence/2026-10-31-checkpoint-hash-cancellation/before.log), [initial related](evidence/2026-10-31-checkpoint-hash-cancellation/related.log), [expanded integration](evidence/2026-10-31-checkpoint-hash-cancellation/integration.log), [SHA-256](evidence/2026-10-31-checkpoint-hash-cancellation/SHA256SUMS.txt).

Cancellation cannot undo a storage transaction already committed. It revokes future permission and requires a fresh read where needed. Underlying native hashing may continue draining under its shared reservation. All records and storage adapters in these tests are synthetic. No signature, transfer, approval, private-key retrieval, publication or deployment occurred. The latest full-wallet checkpoint is the 13,494-test pass at `4905dda`, through item 280.
