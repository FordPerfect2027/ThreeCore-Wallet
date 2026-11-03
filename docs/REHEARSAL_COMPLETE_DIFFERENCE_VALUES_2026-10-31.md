# Complete selected discrepancy values

Continuation item 432. Source revision `2298deb`.

432. A selected discrepancy can be saved with both complete parsed JSON values, including content shortened in the screen preview. The export distinguishes missing values from null, preserves exact atomic-unit strings, identifies the original discrepancy number and target, and retains complete report/receipt/checksum outcomes. It always states simulation-only scope and no execution authority. The source digest identifies the reviewed report text; retain the original report or evidence package as well. The export does not replace that source or authenticate its author.

The encoder accepts only module-issued review identities and rejects invalid targets or indices. It never returns private source object references, performs no extra hash and caps the complete JSON artifact at 6 MiB. Directional controls are escaped without changing the parsed value. `valuesComplete` describes the selected two values, not the completeness of an entire report or all discrepancies.

Browser selection and saving are bound to the current review, target, page and selected discrepancy. Changing them retires the save action. Failed or asynchronous downloads retain the preview for retry, and older delivery callbacks cannot overwrite newer guidance. Ordinary report, evidence receipt and evidence source exports use distinct filenames. The saved-file guide identifies these outputs as inspection material rather than restore inputs.

## Offline use

```sh
node scripts/inspect-rehearsal-differences.js saved-report.json --full-values 103
node scripts/inspect-rehearsal-differences.js saved-evidence.json --full-values 41 --evidence receipt
node scripts/inspect-rehearsal-differences.js saved-evidence.json --full-values 103 --evidence source
```

Numbers start at one. Existing `--page` and bounded `--difference` behavior is unchanged. Invalid selections emit no partial artifact. Exit codes retain complete verification status: 0 for agreement, 2 for a valid discrepancy and 1 for invalid input or read failure. A consistent expectation report may still record a failed expectation; its outcome remains explicit.

## Validation

- Focused value, export, paging and offline checks: **113 passed**, zero failed/skipped/cancelled; **2,283.0696 ms**.
- Final related rehearsal/server checks: **1,313 passed**, zero failed/skipped/cancelled; **40,383.438 ms**.
- Native Chrome: **862 passed** at the same source. The existing discrepancy-inspection case now also verifies complete long-value downloads, separate receipt/source exports and retired save actions while preserving the rehearsal session byte for byte.
- Three saved command outputs are byte-identical to the core encodings. Input files remain unchanged. The recorded large value exceeds the 2,048-unit screen preview, and the full output preserves it without shortening.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-complete-difference-values/`.

The ledger is **432 / 600**. Tests, repeated checks and captures are not extra items. The most recent full-wallet checkpoint remains 14,726 tests at `94d734a`; this change has the scoped and native validation above. Local fictional data only. No real signatures, transfers, approvals, private keys, external RPC, publication, deployment or existing-server restart.
