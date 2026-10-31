# Offline verification and retained rehearsal history

Continuation items 397–400. Source revision `6293ade`.

397. The offline expected-outcome checker accepts a case ID and one-based page number to inspect differences after the report's first 40. The paged output includes complete-suite summary and no-write/no-network scope. A matching selected case cannot hide another case's discrepancy in the exit status. Missing cases, invalid arguments and out-of-range pages produce no partial report. The original one-file command remains byte-identical.

398. Offline saved-report verification accepts `--sha256-file` for a checksum-only UTF-8 text file bounded to 1 KiB. The value is normalized for whitespace and case; filenames, interior line breaks and invalid hexadecimal are rejected. Input files remain unchanged. A wrong checksum produces a discrepancy receipt and exit code 2 rather than a read-failure result.

399. The browser can load the saved checksum file into its optional expected-value field. It retains the selected report and requires an explicit recheck. Invalid files leave the previous value and receipt intact. Older completions, source changes, manual edits, filename capture and disposal cannot overwrite newer state; picker dismissal preserves an active read.

400. Numeric condition editing and failed calculation retain the selected agent's committed ledger and undo history. Results and single-ledger export remain unavailable until recalculation or explicit redisplay, so the edited form is not presented as a completed result. A visible note explains that combined saves contain the prior committed history. Successful recalculation replaces that agent's history; returning to the previous history, switching agents or correcting an error no longer erases it prematurely. Old-format input remains old unless explicitly recalculated.

## Independent offline use

From the repository folder, inspect a later page for an actual case ID:

```sh
node scripts/run-rehearsal-check-suite.js ThreeCore-expected-outcomes.json --case dat-limit-50 --page 2
```

Verify the exact source and checksum files offered by the review panel:

```sh
node scripts/verify-rehearsal-report.js ThreeCore-reviewed-report.json --sha256-file ThreeCore-reviewed-report-sha256.txt
```

The first command returns the original complete report when case/page options are omitted. Page output is an inspection result, not a restorable rehearsal file. Exit status remains 0 for complete agreement, 2 for a valid discrepancy, and 1 for invalid arguments/input or read failures.

## Validation

- Initial focused run: **61 passed / 1 failed**. The failing filename-capture fixture spread an accessor into a plain object, invoking it before the intended read. The fixture now preserves the descriptor and tests cancellation at the actual capture point. The failed log is retained; no product assertion was removed.
- Corrected offline/checksum/review integration: **62 passed**, zero failed/skipped/cancelled; **1,759.6116 ms**.
- History retention and existing page/field validation: **119 passed**, zero failed/skipped/cancelled; **4,002.0816 ms**.
- Final related rehearsal and server integration: **1,076 passed**, zero failed/skipped/cancelled; **35,878.6527 ms**.
- Native Chrome real-DOM suite at the same source: **845 passed**, including a real `File`/`DataTransfer` checksum selection and restoration of committed history and undo after an invalid numeric draft.
- Evidence and SHA-256 checksums: `evidence/2026-10-31-rehearsal-offline-guidance/`.

The ledger records **400 / 600** completed development items. Tests and reruns do not add items. The most recent full-wallet checkpoint remains item 396: 14,415 tests and 843 native cases at `4d4329b`. This batch has the focused/integration/native validation stated above. Local synthetic data only; no real signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart.
