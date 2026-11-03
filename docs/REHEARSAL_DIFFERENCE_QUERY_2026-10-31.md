# Discrepancy filtering: items 433–434

Source: `565c379`. Local, synthetic verification only.

## Completed work

- **433 — Review filtering.** Report and evidence review accept a case-sensitive literal path fragment and a difference kind. The bounded view retains the original difference indices, offers 40 matching rows per page, and keeps total differences and the global verification result visible even when no rows match. Changing source or evidence target retires the old view and resets the filter. Selecting or exporting a value continues to use its original index.
- **434 — Offline query and saved result.** `node scripts/query-rehearsal-differences.js FILE --path TEXT --kind unexpected --page 1` saves a bounded query result to standard output. `--evidence receipt` and `--evidence source` select independent comparisons. Exit 2 continues to indicate an overall discrepancy even when the query matches nothing; invalid requests exit 1 without partial output. Inspection artifacts are recognized as such when selected in the restore interface.

## Verification

All checks below passed at the source revision above, with source and tests frozen during each run:

- Focused API, UI and CLI: 82 passed, 0 failed, 0 skipped, 2,719.9451 ms.
- Related rehearsal and file-read server checks: 1,331 passed, 0 failed, 0 skipped, 43,106.3505 ms.
- Chrome native browser suite: 863 passed with a synthetic provider and no external RPC.

The saved captures use fictional fixtures. The report has 103 total differences. A filtered third page retains original indices; a zero-match query still records 103 total differences and exits 2. The evidence receipt has 87 differences, separately from the embedded report's 103. Captures match the core API and leave input files unchanged.

## Evidence and limits

[Evidence directory](evidence/2026-10-31-difference-query/) includes exact inputs, four query outputs, capture metadata, test logs and SHA-256 checksums. Checksums establish file consistency, not source authenticity. Filtering narrows presentation; it does not repair a discrepancy, authorize execution, or establish token safety. The latest full-wallet checkpoint remains item 431 (14,726 passing tests). These scoped runs do not constitute another full-wallet run. No connection recovery is claimed for the user's existing browser session. Existing servers were not restarted; no signing, transfer, key access, publication or deployment occurred.
