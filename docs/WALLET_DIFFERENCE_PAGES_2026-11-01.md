# Navigate and filter saved-file difference locations

Items 540–541. Source: 9a89b87.

## 540: Navigate beyond the first 40 locations

The saved-file difference panel can move forward and backward through every differing location in pages of 40. Ordinals keep the original complete difference order. Page exports include both exact source hashes, schema, offset, limit, global count, matched count, shown count and preceding/following-page flags. The original bounded comparison receipt remains byte-identical and is still saved separately for its existing verification workflow. A page export is an auxiliary scoped view, not that original comparison receipt or a restore file.

The owned calculation privately retains its two bounded source strings through a WeakMap; navigation parses those captured strings without new file reads, hashing, RPC or a complete retained list of locations. The existing 2 MiB per-source, depth and node limits remain. Replacing the pair clears navigation/export state and releases the panel's old receipt reference. Imported copies cannot provide source authority. The export controls explicitly distinguish the first-40 comparison JSON from the currently displayed page.

## 541: Filter locations with explicit scope

An explicit case-sensitive substring filter searches field paths, not source values. Applying a new condition resets to the first matching page; clearing it restores the full location list. A pending/invalid condition disables navigation and export until applied or cleared. An empty subset preserves the nonzero global difference count and never claims the originals match. Source values are omitted; paths and user-entered search conditions remain visible. A download callback that changes the page cannot publish stale success feedback.

JSON and CSV retain the exact displayed scope and source hashes. CSV has an explicit scope row even for zero matches and escapes formula-leading cells. Array rows remain positional, with length differences reported at the array path. No event-identity matching or value search is claimed.

Offline examples:

`node scripts/inspect-wallet-saved-differences.js before.json after.json --offset 40 --json`

`node scripts/inspect-wallet-saved-differences.js before.json after.json --path /events --offset 80 --csv`

Existing no-query text/JSON output stays compatible. Page/filter flags select a scoped view. Exit 2 still means differences anywhere in the complete source pair, even when the filter matches none. Invalid/duplicate flags fail before source I/O.

All 32 focused cases passed (5737.4179 ms), followed by 204 related cases (5204.7833 ms). A scoped native Chrome run passed all 108 file-read UI cases, including page navigation, applied/unapplied filters and acknowledged page exports. [Evidence](evidence/2026-11-01-wallet-difference-pages/) uses 86 synthetic differences: three full-view pages cover every ordinal once, event filtering retains 85 matches and an empty filter retains the global count. Actual CLI JSON/CSV exactly match API page exports. Evidence hashes are checked against committed Git blobs.

Last full browser checkpoint remains a2eb7e5 (950 cases); last full-wallet checkpoint remains d253e8d (15,720 tests). Scoped checks do not establish full browser coverage, a user-tab connection or OS file-picker behavior. No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or existing-server restart occurred. Navigation and filtering are two completed product capabilities; tests, export formats and controls are not additional counted items.
