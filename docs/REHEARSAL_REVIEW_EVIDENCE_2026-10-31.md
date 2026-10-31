# Portable rehearsal review evidence

Continuation items 402–407. Final source revision `0cd49b6`.

402. A bounded evidence format bundles the exact reviewed source string with its recalculated receipt, original optional expected checksum and explicit simulation-only scope. The encoder accepts only receipts produced by this module and binds them to their original source. Independent verification recomputes the report and compares every recorded receipt field; it does not trust saved success or authority flags. Whitespace, altered results and changed receipt fields remain distinguishable. Original reports retain their 2 MiB limit; evidence packages have a separate 6 MiB limit and recorded receipts a 128 KiB bound.

403. The ordinary report review offers a combined evidence download after verification. It includes discrepancy results as well as successful comparisons. Editing, clearing, replacing or disposing the review retires the download. Download failure permits retry without discarding the reviewed source.

404. An offline evidence verifier independently reproduces the browser result from a bounded UTF-8 file. It returns 0 for faithful receipt/report/checksum agreement, 2 for a valid discrepancy and 1 for invalid input or read failure. A faithfully recorded expectation mismatch is still reported in `reportOutcome`; report fidelity does not assert that the expectation passed. Inputs remain unchanged and no files, network requests or wallet operations are created.

405. A separate browser evidence inspector accepts a saved package or pasted JSON. It displays receipt differences, original-report differences and optional checksum discrepancies distinctly, without restoring anything into the current rehearsal or replacing the ordinary report review. Late file/hash completions, newer input, cancellation, filename capture and disposal cannot revive an obsolete result. Dismissing the picker preserves an active or completed check.

406. The evidence inspector can extract the exact embedded source and save the new verification result, including detected discrepancies. Extracting a source does not present a changed receipt as the original; the new result is saved separately. Failed exports retain the verification for retry.

407. The saved-file guide identifies evidence packages and verification-result receipts. Choosing a known format in the wrong field explains the appropriate destination. Guidance inspects only a bounded format declaration and does not replace validation, restore state or widen ordinary report import limits.

## Independent offline use

From the repository folder:

```sh
node scripts/verify-rehearsal-evidence.js ThreeCore-review-evidence.json
```

Inspect `matchesReceipt`, `reportReview.matchesRecomputation`, `reportReview.checksumMatches` and, when present, `reportReview.reportOutcome`. A consistent file can still describe a failed expectation. Self-consistent source/receipt changes cannot authenticate an author, actual holdings, a real network observation or execution authority.

## Validation

- Initial focused run: **58 passed / 6 failed**. The new offline verifier initially reused a helper capped at 2 MiB, which rejected the evidence format's separate 6 MiB read limit. The verifier now uses the existing bounded local-byte reader directly, retaining strict UTF-8 decoding and the original report limit. The failed log is retained; this correction adds no development item.
- Corrected focused API/export/offline checks: **64 passed**, zero failed/skipped/cancelled; **1,642.7025 ms**.
- Inspector, core format, export and offline integration: **83 passed**, zero failed/skipped/cancelled; **2,160.4055 ms**. Includes a real escaped package above 2 MiB whose embedded source remains within 2 MiB.
- Final related rehearsal/server checks: **1,136 passed**, zero failed/skipped/cancelled; **39,122.8668 ms**.
- Native Chrome at the fixed source: **848 passed**, including native `File`/`DataTransfer` round trips, a modified receipt rendered as text, exact source extraction, wrong-format guidance and unchanged live rehearsal/ordinary-review state.
- Full-wallet suite at the same source: **14,512 passed**, zero failed/skipped/cancelled; **456951.3772 ms**.
- Prior evidence integrity: all **527 files in 96 tracked manifests**, **34,415,163 bytes**, matched their SHA-256 values at the fixed source.
- Existing port 4231 rehearsal HTML and seven served JavaScript modules returned HTTP 200 with correct content types. This is an asset-availability check, not a claim that a user browser control session was reconnected. No existing server was restarted.
- Logs and SHA-256 manifest: `evidence/2026-10-31-rehearsal-review-evidence/`.

The ledger is **407 / 600**. Tests, reruns, integrity checks and regression repairs do not add development items. Local synthetic data only; no real signatures, transfers, approvals, keys, external RPC, publication or deployment. This checkpoint does not establish a mainnet-readiness percentage.
