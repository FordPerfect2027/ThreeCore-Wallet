# Wallet setup panel lifecycle and diagnostics

Continuation items **299–300**, source `23eb408`.

299. Tie refresh, JSON export, preview, application and cancellation to the current panel generation. Check ownership after external field reads and after the post-apply refresh. A failed refresh no longer reports successful confirmation. Reentrant refresh invalidation is bounded rather than recursively reading indefinitely.
300. Read error codes from own data properties and look up only own entries of the message table. Diagnostic reflection cannot overwrite a newer cancellation or a disposed panel; prototype property names produce the normal unknown-error message.

The original 15 cases reproduced **13 failures** and two passing controls. The first focused run passed 59 tests. A further bounded-refresh test was added before integration. **199 setup/configuration/workspace workflow tests passed**, zero failures, cancellations or skips (2904.4569 ms).

Evidence: [before](evidence/2026-10-31-wallet-setup-panel-lifecycle/before.log), [focused](evidence/2026-10-31-wallet-setup-panel-lifecycle/fixed.log), [integration](evidence/2026-10-31-wallet-setup-panel-lifecycle/integration.log), [SHA-256](evidence/2026-10-31-wallet-setup-panel-lifecycle/SHA256SUMS.txt).

All tests use fictional fields and synthetic DOM controls. A verified local write may already have occurred before a later refresh is cancelled; cancellation does not undo it or claim that it was not applied. No real signing, transfers, approvals, private-key retrieval, publication or deployment occurred.
