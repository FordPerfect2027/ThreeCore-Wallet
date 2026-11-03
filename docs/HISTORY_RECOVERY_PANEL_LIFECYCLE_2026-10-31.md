# History recovery panel lifecycle

Continuation items 326–329. Source revision `8da2428`.

326. Recovery actions track ownership through model reads and callbacks. Disposal or invalidation during preview, report, backup extraction, copy, restoration notification or download cannot reactivate an old preview or overwrite the newer display.

327. Copy-to-input and backup downloads require synchronous accepted receipts, with unsupported asynchronous failures consumed. Refused handoffs do not produce successful copy/download messages.

328. Restoration notifications are best-effort observers. Their failure cannot turn a completed local restoration into a claim that history was unchanged. A failed follow-up display refresh after successful restoration or backup discard reports the completed mutation and asks for display review.

329. Refresh and preview cleanup have bounded reentrancy. Failed state refresh disables backup actions; disposal survives throwing or asynchronous cleanup callbacks and detaches the panel.

## Validation

- Before: 25 cases, 24 failing and 1 passing control; rejected unobserved callbacks were also reproduced.
- Initial focused panel/screen tests: 62 passed.
- Final focused tests: 66 passed, including post-mutation display failure and cleanup behavior.
- History, portfolio and workspace integration: 2,065 passed, 0 failed/skipped/cancelled; 80,335.5795 ms.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-history-recovery-panel-lifecycle/`.

All mutations were to fictional in-memory test histories. No real wallet actions, secrets, publication or server restart. Cancellation/retirement prevents late UI effects; it does not undo a local mutation already performed. Download acceptance does not prove disk persistence. Latest full-suite checkpoint remains source `23eb408` through item 300 (13,597 passed).
