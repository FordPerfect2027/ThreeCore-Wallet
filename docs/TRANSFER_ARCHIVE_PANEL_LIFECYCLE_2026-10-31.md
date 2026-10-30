# Transfer archive panel lifecycle

Continuation items 315–316. Source revision `cc8823f`.

315. Own archive UI actions across source callbacks and asynchronous selection notifications. Snapshot callbacks must return synchronously; asynchronous failures are consumed. Source callbacks that invalidate or dispose the panel cannot admit old records or update detached controls. Refresh callbacks cannot recurse without bound; retained handlers are inert after disposal.

316. Own the prepared archive through the download handoff. Cancellation queued after preparation prevents delivery. A download adapter must provide a synchronous accepted receipt (ordinary void remains compatible); false and asynchronous receipts are refused without leaving the handler pending. Late failures cannot overwrite the status of a replacement operation.

## Validation

- Before: 13 focused cases, 9 failures and 4 passing controls.
- After: the original 13 pass; 2 additional refresh/disposal controls also pass.
- Focused panel integration: 54 passed, 0 failed.
- Transfer, archive, vault, reconciliation and related integration: 1,183 passed, 0 failed/skipped/cancelled; 15,815.0361 ms.
- Logs and SHA-256 manifest: `evidence/2026-10-31-transfer-archive-panel-lifecycle/`.

Only synthetic local fixtures were used. No wallet signature, transaction, approval, secrets, publication, or server restart. Browser delivery acceptance is not proof that a file reached disk. This batch suppresses late selection failures; cooperative cancellation of the parent selection encoding is tracked separately. The most recent full-suite checkpoint remains source `23eb408` through item 300 (13,597 passed); this revision has the targeted integration coverage listed above.
