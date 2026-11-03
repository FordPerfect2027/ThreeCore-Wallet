# Annotated history subsets and selective import: items 484–487

Source: `c94b3fe`.

484. Export a recoverable backup for the reports matching the current history filters. The original reports and annotations remain intact, including all tokens in each matched report. The screen states the count and whole-report scope, requires its own acknowledgement, resets acknowledgement when filters or source change, refuses zero matches and rejects changed storage before delivery. The selected report outside the filter is not silently added. Filters are captured before notifications and asynchronous reads.

485. Preserve one explicitly selected report together with its history identifier, name, notes, tags, saved/updated times, archive state and nested evidence restrictions. This complements the existing standalone report export, which intentionally omits history annotations. A selected report may be outside the current filter; the scope is named explicitly. No report is opened or imported as a side effect.

486. Inspect report-history imports in detail before saving. The view distinguishes new reports, the same report under a different identifier, retained local metadata and a reused identifier containing different evidence. It names changed fields and token slots without exposing address or annotation values in inspection receipts, warns when an incoming record removes a requires-new-plan marker, and computes actual revision/capacity feasibility. A separately acknowledged JSON receipt binds the two captured portable sources by checksum and preserves the selected review. It contains no original evidence and cannot restore history. Stale storage cancels the receipt review.

487. Choose which original reports in an incoming backup participate in the additive import. Capacity, duplicates, conflicts and the detailed inspection are recomputed for that exact subset. The full imported file stays available in the review, and omitted reports remain in that file. Selecting none cannot silently import everything. Existing evidence and local metadata are retained; conflicts still require explicit exclusion or prevent application. Selecting one new report can bring an otherwise over-capacity import within the limit without deleting any existing records.

## Offline reproduction

`node scripts/export-report-history-subset.js history.json --archive archived` exports complete original reports matching the filters. `--id ID` selects a specific annotated report; repeated IDs select multiple explicit originals. Identifier and filter modes cannot be mixed. Exit 0 means a nonempty subset was exported; invalid or empty selections return 1 without partial output.

`node scripts/inspect-report-history-import.js current.json incoming.json --json [--id ID...]` verifies both original checksums, then emits the same inspection receipt for the selected incoming scope. Exit 0 means compatible snapshots, 2 means a conflict or limit, and 1 means invalid input. Files use portable revision zero; the command does not inspect current browser storage or predict its revision. Neither command imports, changes source files, uses a provider or checks the current chain. Corresponding npm scripts are `report-history:export-subset` and `report-history:inspect-import`.

## Validation

229 focused checks passed. The fixed source passed 15294 full wallet/integration checks in 657227.3335 ms, with zero failed/skipped/cancelled. Native Chrome passed 899 UI cases using synthetic providers and no external RPC. Four added browser scenarios cover filtered original backup, one archived annotated backup outside the filter, a selected import-inspection receipt, and selective restoration of one report while retaining all eleven existing reports. Browser saves are captured callbacks, not proof of OS dialogs or a restored connection to the user's tab.

[Six reproducible captures](evidence/2026-10-31-history-subsets-and-selective-import/) include two original-preserving backup paths, full and selected mixed imports, and full and selected capacity-limited imports. Saved standalone output matches shared exporters exactly. Inspection output also matches the controller receipt. Simulated reviewed imports add only the selected new entries, preserve local metadata and retain every existing report. Restricted/archived originals, source files, receipts, logs and SHA-256 checksums are retained.

These are four completed user workflows; assertions, repeated runs and capture files add no separate items. This checkpoint also covers preceding items 482–483 and their uncounted corrections. No real signatures, transfers, approvals, secrets, publication, deployment or restart of the user's server occurred.
