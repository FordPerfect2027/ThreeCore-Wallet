# Transfer controller cancellation and reviewed file ownership

Continuation items **217–219**, source `45e736e`:

217. Bound transfer view notifications, consume malformed asynchronous callback failures, close observers before disposal and retain the correct read owner through context and abort callbacks. An older cancellation cannot erase a newer read or its abort handle.
218. Stop cancelled file imports and download preparation before file reading or hashing begins. Preserve a newer file review when an older apply returns; only the review captured for that apply may be installed.
219. Capture progress and diagnostic data without accessor execution, and recheck ownership after snapshot or diagnostic reflection before publishing. A cancelled result cannot restore the previous observation or error.

The 16 new regressions exposed 15 failures before the fix. All **45 targeted tests** and the broader **784-test transfer/notifier/callback suite** pass with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-transfer-lifecycle/before.log), [targets](evidence/2026-10-30-transfer-lifecycle/related.log), [integration](evidence/2026-10-30-transfer-lifecycle/integration.log), [checksums](evidence/2026-10-30-transfer-lifecycle/SHA256SUMS.txt).

Tests use synthetic read adapters and local files constructed by the tests. No real-chain history was added and no signature, transaction or private-key operation occurred. The 13,073-test full-wallet result at `f239e04` predates this change; this record claims the listed targeted/integration results for the new source.
