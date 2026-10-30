# Vault export and panel lifecycle

Continuation items 319–322. Source revision `fa0a84d`.

319. All six vault export routes (working JSON/CSV/text, filtered CSV, stored entry JSON and collection JSON) require synchronous accepted download receipts. False and asynchronous receipts are refused, including consumption of rejected asynchronous callbacks. A pending receipt cannot hold the click handler open.

320. Export completion and error messages belong to the initiating action. Cancellation, card invalidation, replacement or disposal prevents late messages from overwriting the current state.

321. Filtered CSV handoffs also track the filter revision. Changing agent, direction, ordering or search during preparation cancels delivery and asks the user to save again with the current conditions. Paging alone does not revoke an unfiltered export.

322. Disposed panels guard retained event handlers and rendering, preventing file-source inspection and detached display updates. View-only controls do not retire unrelated exports.

## Validation

- Before: 30 cases, 20 failures and 10 passing controls.
- Initial focused integration: 69 passed.
- Final focused integration with all four filter changes: 72 passed.
- Transfer, workspace and checkpoint integration: 1,632 passed, 0 failed/skipped/cancelled; 50,612.269 ms.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-transfer-vault-panel-lifecycle/`.

Only synthetic local data and memory storage were used; no signatures, transfers, approvals, secrets, publication or server restart. Synchronous delivery acceptance does not establish completed disk persistence. Latest full-suite checkpoint remains source `23eb408` through item 300 (13,597 passed).
