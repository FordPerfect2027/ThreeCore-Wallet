# Reconciliation review and export lifecycle

Continuation items **248–251**, source `a43869a`:

248. Own proposed/captured reconciliation reviews before calling source readers or capturing records. Cancellation, a newer proposal or source invalidation prevents stale review publication.
249. Stop before file reading/preparation when a progress observer cancels, recheck imported records after capture, and reject stale completion acknowledgements. Already delivered files are not described as undone.
250. Bound reconciliation view notifications and contain malformed asynchronous observer failures. Disposal removes observers, and review/export publication rechecks current operation ownership.
251. Capture diagnostic codes without invoking accessors or coercion hooks, return fallback text for inaccessible records and inherited lookup names, and suppress failures revoked during diagnostic reflection.

The new suite reproduces **16 failures out of 17 cases before the fix**. After the fix, **55 targeted** and **865 reconciliation/period-report/export-receipt/observer integration tests** pass with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-reconciliation-lifecycle/before.log), [targets](evidence/2026-10-30-reconciliation-lifecycle/related.log), [integration](evidence/2026-10-30-reconciliation-lifecycle/integration.log), [SHA-256](evidence/2026-10-30-reconciliation-lifecycle/SHA256SUMS.txt).

These are offline synthetic records. Arithmetic agreement is not independent blockchain verification or proof of token safety. No signature, transaction, approval or private-key operation occurred. The full-wallet run at `e50123f` predates this change.
