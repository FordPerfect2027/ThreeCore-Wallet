# Inspecting saved and recalculated difference values

Continuation items 429–431. Source revision `94d734a`.

429. Each report discrepancy now has a read-only value comparison. It shows the recalculated value beside the parsed saved value, distinguishes absent fields from null, reports array lengths and preserves atomic-unit strings. Each side is limited to a 2,048 UTF-16-unit JSON preview; shortening is explicit and never splits a surrogate pair. Directional controls are escaped. Only a completed review can identify the source; inspection performs no additional hash. Existing receipt and page encoding remains unchanged.

430. Evidence inspection offers the same comparison separately for the saved receipt and its embedded source report. Buttons belong to their exact verification, target and page. Paging, switching target, editing, replacing, clearing or disposing retires the old selection. The selected comparison receives keyboard focus and is rendered as text; markup in saved values is never executed.

431. The offline difference inspector accepts a one-based --difference number and produces the same bounded values, total discrepancy count, source digest and complete report/checksum/receipt outcome. Existing --page behavior is preserved. Invalid selections emit no partial output. Inspection-output formats now explain that the original report or evidence package is required for another verification or restore.

## Offline use

```sh
node scripts/inspect-rehearsal-differences.js saved-report.json --difference 41
node scripts/inspect-rehearsal-differences.js saved-evidence.json --difference 41 --evidence receipt
node scripts/inspect-rehearsal-differences.js saved-evidence.json --difference 103 --evidence source
```

Indices in the API are zero-based; command numbers and displayed numbers start at one. Values are parsed JSON values, not original source-token spelling. A shortened JSON preview may not be a complete JSON value; inspect its truncated flag and retain the original source. Complete verification status is independent of the selected discrepancy. These outputs cannot authenticate an author or authorize transactions.

## Validation

- Initial focused checks: **80 passed**, zero failed/skipped/cancelled; **2,216.302 ms**.
- Final related rehearsal/server checks: **1,281 passed**, zero failed/skipped/cancelled; **39,469.6293 ms**.
- Native Chrome: **862 passed**. New real-DOM checks cover a long markup-shaped value, explicit shortening, keyboard focus, receipt/source target switching, retired buttons and byte-identical rehearsal state before and after inspection.
- Full-wallet validation at 94d734a: **14,726 passed**, zero failed/skipped/cancelled; **573625.2712 ms**.
- Saved independent command captures cover source differences 41 and 103, receipt difference 41 and embedded-source difference 103. Each matches the core result and retains the original input files. The synthetic report has 103 differences and its modified receipt has 87.
- Earlier evidence integrity: **586 files across 105 tracked manifests**, **39,335,064 bytes**, all match their SHA-256 records.
- Existing port 4231 serves the saved rehearsal HTML and three changed modules byte for byte. No server restart was performed. This does not claim reconnection of the user's browser automation session.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-difference-values/`.

The ledger is **431 / 600**. Tests, reruns and integrity checks are not extra development items. All verification uses local fictional data. No real signatures, transfers, approvals, private keys, external RPC, publication or deployment. This count is a completed-work ledger, not a mainnet-readiness percentage.
