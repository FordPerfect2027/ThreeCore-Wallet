# Three-token transfer vault lifecycle

Continuation items **244–247**, source `b40a107`:

244. Retain ownership and source-card version during capture and application. Cancellation, disposal or card invalidation cannot produce a stale review or apply a revoked one; acknowledgement options are captured without invoking accessors.
245. Validate returned storage documents before adoption, then recheck ownership. Stop after cancelled ID/time callbacks before issuing writes, so an old save cannot borrow a newer operation's cancellation signal.
246. Detach cancellation handles before abort callbacks and retain a newer operation started inside a callback. Final view delivery can revoke success; cancelled diagnostic reflection cannot overwrite the stopped state.
247. Bound vault notifications, contain malformed asynchronous observer failures and close observers before disposal clears reviews and storage.

All **15 new regressions failed** against the prior source. The fixture was prepared outside the checkout during the preceding fixed-source full test. After applying the fix, **107 targeted** and **501 archive/vault/storage/observer integration tests** passed with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-transfer-vault-lifecycle/before.log), [targets](evidence/2026-10-30-transfer-vault-lifecycle/related.log), [integration](evidence/2026-10-30-transfer-vault-lifecycle/integration.log), [SHA-256](evidence/2026-10-30-transfer-vault-lifecycle/SHA256SUMS.txt).

The checks use synthetic card data and test storage. They do not modify the user's saved browser collection or establish real-wallet acceptance. No signature, transaction, approval or private-key operation occurred. The full-wallet validation at `e50123f` predates this change.
