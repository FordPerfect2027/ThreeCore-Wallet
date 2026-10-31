# Recover original report history from a report set: item 483

Source: `4e884d6`.

483. An accepted report set can now export its unchanged original report-history entries in the existing backup format. The result preserves report identifiers, names, notes, tags, saved/updated times, archive flags and all nested token evidence and restrictions. It includes only reports actually present in the selected set and uses portable revision zero. It cannot reconstruct reports omitted when the set was created.

The wallet explains the total/archived counts and requires a separate acknowledgement for full plaintext evidence and annotations. Display-shortening and note-hiding settings do not affect this original backup. Export retains the accepted set and pending replacement, resets acknowledgement on source change, and never imports, connects or begins a read. Existing report-history import review remains authoritative and retains local metadata for duplicate reports.

The offline command is `node scripts/recover-report-set-history.js source-set.json` (also `npm run report-set:recover-history -- ...`). It verifies the source checksum and emits the recovered history to stdout. Exit 0 means recovery, not chain completeness or current validity; invalid input returns 1 without partial output. Saved-file guidance now directs misplaced history backups to the actual history import control; correct-reader checksum validation remains intact.

## Validation

264 focused checks and 2095 related fixed-source checks passed (91410.4371 ms for the related suite), with zero failed/skipped/cancelled. Native Chrome passed 895 UI cases with synthetic providers and no external RPC. New cases verify the export acknowledgement and retained pending replacement, and refusal of an exhausted history revision. Captured save callbacks do not claim OS file-dialog acceptance or connection to the user's existing browser tab.

[Three reproducible captures](evidence/2026-10-31-report-set-history-recovery/) retain original sets and recovered history files for seven annotated reports including an archived report and nested restriction, a selected one-report subset, and a three-report set. Every CLI output exactly matches the shared exporter and decodes to unchanged original entries. Simulated reviewed imports preserve local annotations and add only new reports. Source files remain unchanged. Logs, before/after repair reproductions and SHA-256 checksums are retained.

The first related run passed 2,094 of 2,095 cases. One earlier test expected a generic schema error for a declared history file; it now expects the specific history destination hint. No file validation was weakened. The failed log and corrected fixed-source rerun are retained, with no additional item count.

## Included correction with zero item increment

At source 209af71 the report-history merge preview estimated candidate bytes using the current revision. Revision 9 showed 27,171 bytes although saving revision 10 required 27,172. At the maximum safe integer the preview also permitted an impossible addition, although the authoritative mutation already rejected it. The fix uses the resulting revision for size calculation, exposes revision exhaustion before any storage change attempt and disables the impossible apply action. Identical no-op imports at the limit remain valid. This preview and early-refusal correction adds no development item; the original write protection was never bypassed.

The preceding full-suite checkpoint is 3069815, which predates this feature and correction; the related and native runs above validate the fixed current source. No real signatures, transfers, approvals, secrets, publication, deployment or restart of the user's server occurred.
