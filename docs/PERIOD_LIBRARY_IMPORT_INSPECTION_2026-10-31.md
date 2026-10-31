# Explain period-library import differences: item 481

Source: `a7e54ea`.

481. Opening a saved period library now explains the relationship between incoming and current entries before any write. A shared immutable inspection classifies incoming identifiers as additions, identical entries or conflicts; entries absent from the incoming file are explicitly retained. For conflicts it names changed fields, distinguishes fewer/more acquisition steps, changed common observations and different plans, and highlights removal of a requires-new-plan marker. Original labels, addresses and event bodies are not copied into the inspection.

The existing add-only rule remains authoritative: the same identifier with different content is refused, with no write review and no force-replace path. A compatible file still needs the existing confirmation. The hypothetical capacity includes only new identifiers while retaining existing entries unchanged and uses portable revision zero, matching the backup representation. Entry-count or byte-size excess blocks import. The inspection is cleared after refreshed/adopted storage, failed subsequent file reads, cancellation, disposal or a stale/failed write. It does not assert that an unmarked original is safe or current on chain.

The command `node scripts/inspect-period-library-import.js current.json incoming.json --json` (also `npm run period-library:inspect-import -- ...`) verifies both source checksums before computing the same inspection. It adds the two validated payload digests and a checksum flag. Exit 0 means compatible snapshots, 2 means conflict or capacity excess and 1 means invalid input. No file or browser storage is changed, and no network is used.

## Validation

127 focused tests passed (4,166.8225 ms). One earlier UI fixture had an incorrect cleanup call after its assertions; the fixture was corrected and its failed log retained. The related fixed-source suite passed 1721 tests (92402.2321 ms), zero failed/skipped/cancelled. Native Chrome passed 891 UI cases with synthetic providers and no external RPC. The new browser case displays a removed restriction, retains an omitted existing entry, refuses apply, preserves source contents and clears inspection on refresh.

[Five reproducible captures](evidence/2026-10-31-period-library-import-inspection/) cover mixed additions/duplicates/metadata changes, removed restriction with a shorter draft, compatible addition, empty incoming collection and 13-entry combined capacity. Standalone CLI outputs and controller inspections exactly match the shared model. Both original files remain byte-identical; imports are only inspected and no synthetic or real storage writes occur in these captures. Existing checks also cover malformed original data, strict argument/UTF-8/checksum failures and late cancellation.

Latest full checkpoint remains 15,227 tests at 5cc20fe (item 479). No real signatures, transfers, approvals, secrets, publication, deployment or restart of the user's server occurred.

## Subsequent uncounted correction

The original portable-revision size estimate and maximum-revision compatibility preview were corrected at `209af71`. The [recovery update](REPORT_SET_TOKEN_LIBRARY_2026-10-31.md) retains before/after reproductions and regression evidence; no additional development item was counted for this correction.
