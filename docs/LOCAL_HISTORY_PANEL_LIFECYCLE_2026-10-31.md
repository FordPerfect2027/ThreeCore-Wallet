# Local history and comparison panel lifecycle

Continuation items **295–298**, source `690b7f8`.

295. A comparison target replacement is adopted only while its generation remains current. Clearing, replacing or disposing during data capture wins over the older target; retained input and clear handlers do nothing after disposal.
296. History admission rechecks panel ownership after source callbacks and observation validation. Invalidating or closing the panel cannot be followed by an old observation or report being added to its archive.
297. History adapters must return synchronous observations or report text. Asynchronous failures are consumed without admitting a record or producing an unhandled rejection.
298. History error codes are captured as own data and ownership is rechecked before clearing review or updating status. Diagnostic getters do not execute and diagnostic reflection cannot revive a disposed panel.

The 16 new cases reproduced **12 failures** and four existing controls. All **57 focused tests** then passed, including full workspace save/select/restore flows through the actual mounted history panels. Related integration passed **1,283 tests**, zero failures, cancellations or skips (14052.3841 ms).

Evidence: [before](evidence/2026-10-31-local-history-panel-lifecycle/before.log), [focused](evidence/2026-10-31-local-history-panel-lifecycle/fixed.log), [integration](evidence/2026-10-31-local-history-panel-lifecycle/integration.log), [SHA-256](evidence/2026-10-31-local-history-panel-lifecycle/SHA256SUMS.txt).

Tests use synthetic DOM elements and fictional public observations. No browser connection, real signing, transfers, approvals, private-key retrieval, publication or deployment is claimed.
