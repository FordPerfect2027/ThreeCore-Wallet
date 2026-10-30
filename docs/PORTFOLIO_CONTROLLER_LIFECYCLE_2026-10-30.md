# Portfolio refresh ownership and view lifecycle

Continuation items **255–257**, source `e8a89ae`:

255. Bound portfolio subscriber notifications, contain malformed asynchronous callback failures, and stop delivery to removed or disposed subscribers. The synchronous controller state remains authoritative.
256. Retain each invalidation's own generation before invoking abort callbacks. A newer refresh started inside cancellation keeps its own request and stop handle; older refresh/clear/cancel calls cannot overwrite it.
257. Capture known options and token slots before notifying or reading, validate result flags as own data, and recheck ownership after response/error reflection. Cancelled captures cannot revive ready or error states; diagnostic accessors are not invoked.

The new suite reproduces **13 failures out of 14 cases before the fix**. **171 targeted** and **566 portfolio/observer integration tests** pass after the fix with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-portfolio-controller-lifecycle/before.log), [targets](evidence/2026-10-30-portfolio-controller-lifecycle/related.log), [integration](evidence/2026-10-30-portfolio-controller-lifecycle/integration.log), [SHA-256](evidence/2026-10-30-portfolio-controller-lifecycle/SHA256SUMS.txt).

Reader adapters remain trusted application dependencies, and underlying RPC calls already sent cannot be undone. No real wallet permissions, signatures, transactions, approvals or private-key operations were used. The full-wallet run at `e50123f` predates this change.
