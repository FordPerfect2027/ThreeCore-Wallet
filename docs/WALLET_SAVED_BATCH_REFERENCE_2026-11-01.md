# Compare saved wallet batches against an earlier checksum list and export a viewing table

Items 518–519. Source: `d294bab`.

## 518: Prior checksum comparison for original wallet files

The browser batch accepts an optional earlier SHA256SUMS list through a bounded file read or pasted text. Every selected basename must match the list exactly, including case; order may differ, but duplicates, missing/extra rows, paths, unsafe names, empty data and lists beyond 16 KiB/20 rows are refused. An invalid or failed uploaded reference does not silently become a reference-free run; the explicit remove action is required. Original files remain selected when the reference changes, and old results and pending work are retired.

V2 receipts retain the exact earlier list, its SHA-256, every expected hash and true/false/unknown comparison result. A mismatch skips original-file validation and remains a mismatch. A matching external hash cannot turn internally corrupt or auxiliary content into a validated original. Cancellation retains expected hashes for pending rows without claiming comparisons. Exports of current-content hashes use a separate filename when a prior reference exists, so the earlier list is not presented as updated evidence. Neither list authenticates its origin. Without a reference, existing V1 receipt bytes remain unchanged.

## 519: Complete CSV viewing export

The browser exports every selected file, including failures and pending rows, as UTF-8 CSV with BOM and CRLF. Each row retains completion scope, read-only/authority limits, expected/actual hashes, original-file classification and bounded reference counts. False and unknown remain distinct; absent values are blank rather than fabricated zeroes. Formula-like filenames are escaped. Only locally produced owned receipts can export; imported JSON claims cannot authorize it. Plaintext saving consumes a separate acknowledgement, and asynchronous/failed saves cannot claim success. CSV contains no original record bodies and cannot restore the wallet.

Guidance for the newly generated batch receipt formats is updated as supporting maintenance, not another counted item.

## Validation

95 focused checks passed (2699.5811 ms). All 1,118 related file-reading, original-format, inspection, manifest and batch checks passed (46941.9735 ms), with no failures, skips or cancellations. Native Chrome passed 936 cases across two reconciled isolated profiles with cleanup. New browser cases use real File/DataTransfer objects to upload a prior list, expose a mismatch, preserve its original text, export a separate current-content list and explicitly remove a reference. A second native case exports a cancelled batch to CSV with both checked and pending rows and formula protection. Captured downloads do not establish operation of the OS picker or the user's existing tab.

[Evidence](evidence/2026-11-01-wallet-saved-batch-reference/) includes seven byte-identical original/control source copies, correct and deliberately mismatching earlier lists, browser-shared API JSON/CSV results and independent CLI captures. Both execution paths agree on each filename, actual/expected hash, status and inspection; browser invalid maps to CLI unreadable. V1 bytes still match the item-517 evidence. A partial result has one mismatch, one checked original and five pending rows, all seven retained in CSV. Original bytes remain unchanged and committed evidence hashes are verified. API-generated files are clearly distinguished from the separate native UI checks.

Last full-wallet checkpoint remains d253e8d (15,720 tests). This source has the scoped/native validation above. No signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart occurred. The two completed capabilities, not their tests, generate two items; item counts are not mainnet-readiness percentages.
