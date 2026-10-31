# Wallet input cancellation and native file selection

Continuation items 426–428. Final source revision da47108; initial source 660c1ef.

426. Workspace JSON edits and replacement file selections retire the old operation before cancellation. New previews created during cancellation survive, disposed panels stop writing, and superseded file choices cannot admit another read. A selected File and its count are captured before the native picker is cleared.

427. Wallet setup JSON and file handlers similarly establish ownership and retire pending review state before cancellation callbacks. New review guidance is not overwritten by old multi-file errors. Native file selections remain available after the picker resets.

428. Checkpoint import replacement checks its read sequence after cancelling the older file and controller review. A newer cancellation stops the obsolete replacement before file IO. Cancel clears old review state before notifying file observers; newer work and disposal retain ownership.

## Validation

- Initial regression reproduction: **6 passed / 8 failed**, **721.8633 ms**; retained before-fix log.

- Initial related validation: **2,183 passed**, zero failed/skipped/cancelled; **55,952.4661 ms**.

- The first native run exposed a regression in the initial repair: clearing a native file input emptied its live FileList before the file was captured. Its synthetic checkpoint adapter also lacked a required method. The retained native log reports **850 passed / 11 failed**, with zero unexpected browser errors. Both were corrected; these corrections are not extra development items.

- Repair checks: **103 passed**, zero failed/skipped/cancelled; **2,217.1034 ms**.

- Final cancellation and live-file-selection regressions: **16 passed**, zero failed/skipped/cancelled; **678.7063 ms**.

- Final related checks at da47108: **2,185 passed**, zero failed/skipped/cancelled; **66378.4211 ms**.

- Final native Chrome at da47108: **861 passed**, using native File/DataTransfer, real DOM and fictional local data. Existing save/import/restore cases also pass.

- Evidence and SHA-256 manifest: evidence/2026-10-31-wallet-input-cancellation/.

The ledger is **428 / 600**. Tests and regression repairs do not add items. The latest full-wallet checkpoint remains 14,650 tests at 18fa5d5; this batch has the scoped and native validation above. No real signatures, transfers, approvals, private keys, external RPC, publication, deployment or existing-server restart.
