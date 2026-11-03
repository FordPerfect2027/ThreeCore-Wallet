# Rehearsal continuity, record navigation and file guidance

Continuation items 377–382. Source revision `9f3eab3`.

377. Record-browser source capture belongs to the current refresh. Clear, replacement or disposal during capture retires the earlier operation, including a late failure. Disposed views cannot regain rows or export authority. A current invalid replacement still reports its failure and preserves the healthy existing view.

378. Hypothetical-comparison source refresh captures a candidate before committing it and rechecks ownership after validation and owner notification. A source disposed or replaced during capture cannot restore old controls, context or results.

379. Comparison start and completion check the same source/revision after notifications. Owner notifications consume thrown, rejected and malformed async results without discarding valid comparisons. Disposal marks the panel closed before notifying its owner, so a recursive disposal cannot overflow or revive the view.

380. Save-checkpoint recording has a generation. Clearing the checkpoint or starting another record while input is being captured prevents the older record from replacing the newer baseline. Current invalid input still retains the previous valid baseline. This remains a checkpoint of offered downloads or reviewed files, not proof that the browser wrote a file.

381. Related-record buttons open the referenced operation or reservation within the same saved agent, including a target outside the current filter or page. A return button restores the original filter text, page size, offset and selected record. A view revision and detail revision retire old row buttons. Explicit filter edits, source replacement and disposal revoke a saved return view. Keyboard focus follows the selected detail control; source ledgers remain unchanged.

382. A collapsible saved-file guide links the common JSON file types to their corresponding page sections and distinguishes review receipts and CSV documents from restorable input. File names are examples; existing content validation remains authoritative.
## Validation

- View/observer regression baseline: 26 cases, 21 failed and 5 passing controls. After the fix all 26 passed.
- Save-checkpoint baseline: 7 cases, 6 failed and 1 control. Combined source/checkpoint and existing save-checkpoint tests: **47 passed**.
- First full run at `6746492`: 14,318 passed / 3 failed. Two asset-graph expectations omitted the newly imported JSON inspector; one test used a turn-count wait that could finish before asynchronous hashing. The explicit asset list was updated, waits use a bounded real deadline, and a delayed-digest regression was added. No product assertions were removed. Corrected focused set: **187 passed**. The failed full log is retained.
- Related navigation initially exposed normalization of the saved search controls. Return state now retains the original entered values, including case/spacing; the initial failed log is retained.
- Final rehearsal/navigation, JSON, file-boundary and server integration: **1,185 passed**, zero failed/skipped/cancelled; **25,016.3899 ms**.
- Full wallet test command at the fixed source: **14,334 passed**, zero failed/skipped/cancelled; **476,026.1975 ms**.
- Native Chrome real-DOM suite at the same source: **838 passed**.
- Before this record was added, **90 tracked evidence manifests / 493 files / 30,282,942 bytes** matched all recorded SHA-256 checksums. The read-only result is saved separately; it does not claim this newly created manifest was part of that check.
- Evidence and SHA-256 checksums: `evidence/2026-10-31-rehearsal-source-boundaries/`. Source/tests stayed fixed through the native run and subsequent full run.

The continuation ledger now records **382 / 600** completed items. This is a development task count, not a mainnet readiness percentage. All tests used local synthetic data and fresh disposable browser profiles. No real signatures, transfers, approvals, private keys, external RPC, publication, deployment or existing-server restart.
