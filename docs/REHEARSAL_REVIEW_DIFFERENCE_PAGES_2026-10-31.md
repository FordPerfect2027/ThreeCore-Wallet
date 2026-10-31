# Complete review-difference inspection

Continuation items 408–410. Source revision `9f93f32`.

408. Ordinary report review now exposes all recomputation differences in pages of 40. Paging is bound to the exact source of a completed receipt, without another hash or wallet request. It preserves the original receipt encoding and its bounded first-40 summary. Invalid offsets are rejected; browser offsets normalize to page boundaries and clamp to the last page. Source edits, hash changes, clearing and disposal retire the page controls.

409. Evidence inspection separately pages differences in the recorded receipt and in its embedded source report. The target chooser resets pagination, totals remain independent, and the original recorded receipt is retained privately rather than accepted from an arbitrary caller. Complete verification exports retain their original status regardless of the displayed target or page.

410. An offline difference-inspection command returns any report or evidence page with its complete verification summary. An empty selected page cannot hide a receipt, source or checksum discrepancy elsewhere. Invalid arguments and pages beyond the end produce no partial output; input files remain unchanged.

## Offline inspection

```sh
node scripts/inspect-rehearsal-differences.js ThreeCore-reviewed-report.json --page 2
node scripts/inspect-rehearsal-differences.js ThreeCore-review-evidence.json --page 2 --evidence receipt
node scripts/inspect-rehearsal-differences.js ThreeCore-review-evidence.json --page 2 --evidence source
```

Omitting page options for an ordinary report selects page 1. Exit codes are 0 for complete report/receipt/checksum agreement, 2 for a valid discrepancy and 1 for invalid arguments/input or read failures. A faithfully recorded failed expectation remains visible in `summary.reportOutcome`; fidelity does not assert expectation success. Page output is an inspection result, not a restorable rehearsal file.

## Cancellation correction

An additional observer regression was found in the evidence inspector introduced at item 405. Cancelling a file read could synchronously notify an observer that started a newer review, after which the older clear/paste/file action cancelled or overwrote it. Disposal also marked the panel closed too late. Reset now captures its operation and hash ownership before cancellation, returns only while it still owns the view, and callers stop when superseded. Disposal closes input before notifying cancellation observers. This correction is **not an additional development item**.

## Validation

- Observer reproduction: **15 passed / 4 failed**, **1,043.2059 ms**; the failed log is retained.
- Corrected observer/panel run: **19 passed**, zero failed/skipped/cancelled; **1,064.5977 ms**.
- Focused paging, offline inspection, exports and existing report review: **80 passed**, zero failed/skipped/cancelled; **1,480.7575 ms**.
- Final related rehearsal/server checks: **1,157 passed**, zero failed/skipped/cancelled; **37,438.124 ms**.
- Native Chrome at the same source: **849 passed**. The added real-DOM case traverses 103 source differences and 87 receipt differences through their final pages and confirms that switching targets resets the page while exported totals remain complete.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-rehearsal-review-pages/`.

The ledger is **410 / 600**. Tests and regression repairs do not add items. The most recent full-wallet checkpoint remains item 407 at `0cd49b6`: 14,512 tests and 848 native cases. This later batch has the related and native validation above. Local synthetic data only; no real signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart.
