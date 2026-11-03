# Period-library review and local-storage lifecycle

Continuation items **220–222**, source `7f078de`:

220. Capture the checkpoint and requires-new-plan flag from own data. Retire cancelled save preparations after checkpoint, clock or ID callbacks; do not invoke later callbacks or recreate a review.
221. Preserve review ownership through the source recheck immediately before saving. An older apply cannot start a write after cancellation or replace a newer review. Extend the same cancellation checks to rename and comparison preparation.
222. Reject late storage adoption and import review publication after cancellation during validation. Retain a newer refresh's abort handle. Bound view callbacks and consume malformed asynchronous restore-receiver results without reporting delivery success.

All 13 initial regressions fail before the fix; **65 controller/lifecycle tests pass** afterward. Three additional cases cover rename, comparison and import analysis cancellation. The broader **479-test period-library/controller/notifier/callback suite passes** with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-period-library-lifecycle/before.log), [initial targets](evidence/2026-10-30-period-library-lifecycle/related.log), [integration](evidence/2026-10-30-period-library-lifecycle/integration.log), [checksums](evidence/2026-10-30-period-library-lifecycle/SHA256SUMS.txt).

Tests use isolated in-memory storage and synthetic checkpoint data. They do not modify the user's browser storage or real-chain holdings. No signature, transaction, approval or private-key operation occurred. The last full-wallet validation at `f239e04` predates these changes.
