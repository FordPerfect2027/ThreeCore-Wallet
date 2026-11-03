# Complete filtered event exports: items 450–451

Source: `56fb266`.

450. The reconciliation screen can save every event matching the current token, direction and literal search as CSV, independently of the displayed page. The previous all-events export remains available and unchanged. The filtered artifact includes per-row source status, context, exact atomic-unit values, cumulative values and query provenance. Saving this viewing-only CSV does not mark the workspace as backed up.
451. The saved period-report screen can save all matching events for the selected token as CSV under its existing export acknowledgement. Source identity, source/report restrictions, exact unit values and historical/unverified flags accompany every row. The summary CSV and full report JSON retain their previous behavior.

Both flows capture filters before observers run, respect operation cancellation and disposal, report delivery refusal, allow retry, disable the new button for invalid searches, and leave source data and full-source arithmetic unchanged. An empty result produces a header-only CSV, not a fabricated zero event. Header-only CSV has no row-level query metadata; preserve the source JSON and conditions for reproduction. CSVs are unencrypted, include public account/history data, and are not restorable backups. Import numeric columns as text in spreadsheet software to preserve exact digits.

## Validation

- Existing query, export, controller and panel compatibility: 213 passed, 8,713.7888 ms.
- Initial new unit run: 13 passed/1 failed because a test passed the file object rather than its text to its CSV parser. The test was repaired.
- Initial panel run: 42 passed/1 failed, exposing a new button name that collided with an existing details element. The button received a distinct name; final focused run: 43 passed, zero failures/skips/cancellations, 4,349.2401 ms. These draft repairs are not additional development items.
- Final related reconciliation/period-report suite: 706 passed, zero failed/skipped/cancelled, 26,193.7379 ms. This includes additional observer-mutation/cancellation cases after the focused run.
- Fixed-source native Chrome run: 867 UI cases passed with a synthetic provider and no external RPC. Native cases exercise both new buttons, all-page output, empty results, invalid-query disabling and preserved original sources. Browser tests capture the download handoff; they do not claim a user file-picker interaction.
- Captured synthetic CSVs: reconciliation 61 total / 31 incoming / 0 unmatched; period report 57 total / 57 incoming / 0 unmatched. Each CSV matches a first-page export byte for byte, and source values remain unchanged.

[Evidence](evidence/2026-10-31-filtered-event-exports/) contains the two synthetic source JSONs, six actual CSVs, capture results, draft/final logs and checksums. No wallet, signature, transfer, approval, secret access, external RPC, existing-server restart, publication or deployment occurred. The last full-wallet checkpoint remains item 444 (14,836 cases at b69f5e5); this batch has scoped related tests and a new complete native UI run.
