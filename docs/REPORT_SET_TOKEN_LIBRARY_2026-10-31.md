# Recover a token's original library from a report set: item 482

Source: `209af71`.

482. A fixed report set can now export all original entries for one explicitly selected token in the existing period-library format. The output preserves original identifiers, labels, times, archive flags, requires-new-plan flags and drafts. Identical content under the same identifier is collapsed to one entry; identical evidence under different original identifiers remains separate. Reuse of an identifier with different content blocks the whole output instead of choosing an original or silently omitting a conflict. Missing token slots are counted; no originals or excess library capacity also refuse export.

The collapsed wallet section explains the source-report count, missing slots and repeated references before its own acknowledgement. It covers all accounts and periods for that token in the displayed set. Changing the token or accepted set resets acknowledgement. Accepted source and pending replacement stay intact. Report-level names, notes, archive flags and combined comparisons are not converted into entry metadata; users are directed to retain the original report set too. Original-entry restrictions are preserved and the recovered library still uses its existing import review. Export does not import, connect or resume reading.

The offline command is `node scripts/recover-report-set-token-library.js source-set.json --agent DAT` (also `npm run report-set:recover-token-library -- ...`). It verifies the original set checksum before writing the library JSON to stdout and explains counts on stderr. Exit 0 means successful recovery, not history completeness or current-chain validity. Conflicting, invalid, absent or over-capacity sources return 1 with no partial original output. No network or source writes occur.

## Validation

61 focused checks and 1737 related fixed-source checks passed (91769.563 ms for the related suite), with zero failed/skipped/cancelled. Native Chrome passed 893 UI cases with synthetic providers and no external RPC. The new browser case verifies a separate acknowledgement, original restrictions, retained pending replacement, acknowledgement reset and refusal of conflicting identifiers. Browser saves use captured callbacks, not OS dialogs or a connection to the user's existing tab.

[Seven reproducible captures](evidence/2026-10-31-report-set-token-library/) include distinct DAT/EMA originals, exact duplicate references, restricted originals, one missing token slot, an entirely absent token and conflicting identifiers. Successful standalone outputs exactly match the shared exporter and decode to the original collection field for field; blocked cases emit no partial JSON. Every source file remains byte-identical. Source/inspection/library files, logs and checksums are retained.

The preceding full checkpoint is the zero-increment library-guidance repair at 3069815. No real signatures, transfers, approvals, secrets, publication, deployment or restart of the user's server occurred.

## Included correction with zero item increment

The item-481 import inspection originally estimated portable revision zero rather than the actual resulting local revision. At revision 9 it reported 5,559 bytes while the authoritative import review required 5,560 bytes; at the maximum safe integer it also showed an addition as compatible although the existing write path correctly rejected it. The correction computes bytes using the resulting local revision, reports revision exhaustion as incompatible, and still accepts an identical no-op at the limit. Three regression cases cover revision-width changes, maximum revision, and the controller's refused import. Before/after captures are retained. The original write protection was never bypassed; this corrects the preview and adds no development item. The preceding 3069815 full run does not cover this subsequent correction; the fixed-source related and native runs above do.
