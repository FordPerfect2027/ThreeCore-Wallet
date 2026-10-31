# Compare saved events within common query coverage: item 473

Source: `6c76e88`.

473. Two explicitly selected reports in an accepted set can now be compared for one token. The comparison requires the same account, chain and token, and computes the inclusive intersection of actually saved query windows. Planned but unread suffixes and non-overlapping ranges are excluded rather than reported as missing events. Adjacent intersections merge without enumerating blocks. Changing query window partitions does not change the compared scope. An empty intersection is a distinct no-comparison result, not a clean zero result.

Within that scope, transaction hash plus log index identifies each saved event. Equal events are counted once as a matched pair; differences distinguish A-only, B-only and changed values. Changed block number/hash, transaction position, sender, receiver and raw integer quantity are listed, with each side's exact record/event indexes. There is no combined event ledger or quantity total. Blocks observed by both originals are also compared, so two empty event lists with different saved block hashes are not reported as a match. Internal hash contradictions and archived/reacquisition flags remain visible. A/B denotes selection order, not time order or source reliability.

The screen shows 50 event differences per page. JSON export includes all differences and common-range/source metadata, bound to the original set's canonical payload checksum. A separate acknowledgement covers full addresses, event values and hashes; generic export acknowledgement and address-shortening controls do not apply. Original note bodies are omitted, although source labels are included. Changing either source or token clears the comparison and acknowledgement. Applying a new set clears the old choices. Saving neither replaces the accepted source nor discards a pending candidate. Cancel/dispose during export prevents late download delivery.

## Independent reproduction

`node scripts/compare-saved-events.js set.json --before REPORT_ID_A --after REPORT_ID_B --agent DAT`

The command validates the original set checksum and emits exactly the same full comparison JSON as the shared screen exporter. Exit 0 means saved observations match within the common scope; exit 2 means differences or no common coverage (distinguished in the result); exit 1 rejects invalid inputs without partial comparison output. The output is full plaintext evidence; no network requests, source-file writes or imports occur. A match does not establish exhaustive logs, current chain state, authenticity or token safety. The derived comparison file cannot replace the original set for restoration.

## Validation

An initial draft exposed an incorrect catalog argument shape; it was corrected before the source checkpoint, without weakening catalog validation. The focused model, CLI and panel run then passed 48 checks (10,299.4074 ms). Final option-capture and cancellation coverage was added before the full-wallet run. That full run passed 15154 checks (356461.452 ms), zero failed/skipped/cancelled. Native Chrome passed 883 UI cases with synthetic data and no external RPC. Its new case pages 57 differences, saves all 57 rather than just the displayed page, verifies separate acknowledgement, preserves the source, and clears stale selections after applying a new set.

Seven [capture cases](evidence/2026-10-31-saved-event-comparison/) cover matching events, a changed amount, an absent event, a partial saved prefix, disjoint scopes, empty event lists with forked hashes, and all 57 paginated differences. Shared and standalone exports match exactly; source files remain unchanged. Source files, comparison JSON, logs and SHA-256 manifest are retained. Shared-helper captures run under Node; native display and captured download delivery are separate checks and do not claim a restored connection to the user's current browser or OS dialog.

This model, screen, export and independent command form one completed workflow item. No real signatures, transfers, approvals, secret retrieval, publication or deployment occurred. The user's existing server was not restarted.
