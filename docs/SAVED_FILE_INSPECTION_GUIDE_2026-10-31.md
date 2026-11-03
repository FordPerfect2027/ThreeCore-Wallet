# Inspect a saved file before choosing an import destination: item 488

Source: `102253e`.

488. A collapsed guide in the file-read protection area lets a user select one explicit ThreeCore JSON and learn its type, scope and correct opening control before importing it. The five supported original formats are period drafts, period libraries, individual reports, report-history backups and report sets. Each uses its existing complete validator and checksum decoder; a schema declaration alone cannot make an original valid. Corrupt checksums or invalid input cannot leave a previous success displayed.

Known auxiliary formats receive declared-format guidance only. Their contents, claimed counts, hashes and conclusions remain unverified and are never copied into the guide. Unknown formats are refused. The screen distinguishes these results and does not hand data to any import, wallet or storage controller.

Validated-original summaries expose bounded counts of reports, archived records, draft references, incomplete/empty drafts and requires-new-plan markers, with static destination instructions. Repeated references across reports are explicitly not independent verification counts. Plain period drafts lack library archive/replan metadata, which is shown as unavailable rather than falsely asserted absent. Addresses, balances, labels and note values are not printed in inspection results.

The user can separately acknowledge saving an inspection receipt. It binds a validated original's canonical payload checksum and exact UTF-8 text checksum, but includes no original evidence and cannot restore history. File reading preserves a BOM for strict rejection rather than silently stripping bytes before a text hash. Cancellation, delayed reads, disposal, unsafe names, malformed UTF-8 and asynchronous delivery refusals are covered. The ordinary file picker can be dismissed without discarding a successful inspection.

## Offline reproduction

`node scripts/inspect-wallet-saved-file.js source.json --json` (or `npm run saved-file:inspect -- ...`) inspects one bounded local file without modifying it. Exit 0 means a validated original, 2 means an auxiliary declaration only, and 1 means invalid or unsupported input. The output contains no original address, balance or note values. This is not chain re-verification, authentication, a security audit or an import.

## Validation

192 focused checks and 3123 related fixed-source checks passed (264669.5563 ms for the related suite), with zero failed/skipped/cancelled. Native Chrome passed 901 UI cases with synthetic providers and no external RPC. The added browser cases cover a verified history backup and saved receipt, subsequent corruption clearing success, an unverified auxiliary claim, and cancellation of a delayed read. Native saves are captured callbacks; they do not establish an OS file-dialog flow or a connection to the user's existing tab.

[Seven reproducible captures](evidence/2026-10-31-saved-file-inspection-guide/) retain each supported original, an auxiliary declaration making false validation/count claims, and a corrupt original. Successful CLI output exactly matches the shared inspection; the auxiliary result remains unverified and the corrupt original emits no partial result. All source files remain byte-identical. Source files, inspection receipts, capture metadata, logs and SHA-256 checksums are retained.

A read-only audit at 102253e verified all 148 preceding evidence manifests and all 1,153 referenced files, with no mismatches or unreadable files. Its raw report is retained. That audit predates creation of this evidence folder and does not claim to include itself or these new captures. Auditing adds no development item.

The first native attempt failed during shutdown because the isolated test browser did not report exit within the cleanup deadline. It was not counted as a passing run. A subsequent process check found no Chrome process using that unique temporary profile; only that verified temporary directory was removed with the existing bounded cleanup helper. The unchanged source was then rerun through the complete native suite. The failed cleanup log is retained; neither timeout checks nor application validation were weakened.

The preceding full-suite checkpoint is c94b3fe at item 487; it predates this guide. The related and native runs above validate this source. Assertions, supported-format variants and repeated runs add no extra development items. No real signatures, transfers, approvals, secrets, publication, deployment or restart of the user's server occurred.
