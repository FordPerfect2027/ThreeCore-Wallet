# History review source and download lifecycle

Continuation items 323–325. Source revision `9062bce`.

323. Review source callbacks must return synchronously and remain owned by the current action. Disposal or invalidation during any source read prevents stale review controls or messages. Unsupported asynchronous failures are consumed.

324. Completed source capture is checked again against the archive, import inputs and revision; the revision is checked after the last source callback as well. Saved reports use a locally captured proposal only after verifying it is still current.

325. Both JSON and text report downloads require accepted synchronous receipts. False/asynchronous receipts cannot be reported as a started download, and delivery callbacks that dispose or invalidate the panel cannot write a late success or error message.

## Validation

- Before: 24 cases, 23 failing and 1 passing control; unsupported rejected download promises also exposed asynchronous failure behavior.
- Initial focused panel/screen integration: 80 passed.
- Final focused panel/screen integration, including final-callback revision drift and save-time retirement: 83 passed.
- History, portfolio and workspace integration: 2,036 passed, 0 failed/skipped/cancelled; 80,189.152 ms.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-history-review-panel-lifecycle/`.

Only synthetic local data was used. No wallet actions, secrets, publication or server restart. The source revision contract detects reported changes; it cannot establish correctness of an external adapter that deliberately lies about data or revision. Download acceptance does not prove disk persistence. Latest full-suite snapshot remains source `23eb408` through item 300 (13,597 passed).
