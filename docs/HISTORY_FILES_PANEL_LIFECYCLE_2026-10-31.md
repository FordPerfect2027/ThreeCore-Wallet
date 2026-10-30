# History file handoffs and backup state

Continuation items 330–334. Source revision `6c4530d`.

330. Whole-history and filtered downloads require synchronous accepted receipts. Refused/asynchronous receipts cannot claim a download or mark the whole-history backup tracker as offered.

331. Whole and filtered exports capture source text and revision coherently. Subset export rechecks both text and visible criteria, even if an adapter did not advance its revision. Partial export remains distinct from a whole-history backup.

332. Read-start notifications consume observer failures and recheck reader state/ownership before writing status. A callback that cancels or invalidates the read cannot leave the old reading message behind.

333. Import-to-input callbacks require synchronous acceptance. Refusal, asynchronous results and late completion after retirement cannot report successful population of the input. Import still requires separate preview/apply and never directly changes history.

334. Backup status refresh is bounded under reentrant source callbacks. Source retirement, retained handlers and disposal cannot update removed controls. An unavailable backup status is shown as unconfirmed, not as a completed save.

## Validation

- Before: 25 cases, 24 failures and 1 passing control; rejected unobserved callbacks were also reproduced.
- Initial focused panel/workflow/screen suite: 95 passed.
- Final focused suite: 100 passed, including asynchronous sources, revision drift, visible criteria and retained filter handlers.
- History, portfolio and workspace integration: 2,095 passed, 0 failed/skipped/cancelled; 80,273.407 ms.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-history-files-panel-lifecycle/`.

Only synthetic local histories were used. No wallet signatures, transfers, approvals, secrets, publication or server restart. Download acceptance is not disk-save verification; status continues to say to check the browser. Latest full-suite checkpoint before this batch remains source `23eb408` through item 300 (13,597 passed).

## Full-suite finding and correction

The full wallet run at fixed source `6c4530d` completed 13,913 cases: **13,912 passed and 1 failed**, with no skips or cancellations (602,772.7056 ms). The failing export HTTP test had not added the existing, already-served `provider-error.js` module to its expected dependency inventory after export diagnostic capture began importing it. This is not recorded as a successful full-suite checkpoint.

Commit `1da360b` updates that inventory and reports an unexpected dependency by its path. All 30 export HTTP tests then passed, including dependency traversal, protected headers and foreign-request rejection. No server protection was relaxed. This is a correction to prior validation, not an additional development item. Evidence: `full-wallet.log` and `http-dependency-fixed.log` in the batch evidence directory. A later full run must independently establish success for its own fixed revision.
