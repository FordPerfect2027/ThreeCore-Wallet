# Exported report checklists and repeated validation: items 453–454

Fixed source: `db8fb98`. Checklist implementation: `57090d9`; immutable-validation optimization: `db8fb98`.

453. The saved-report-set screen now exports its current token/severity/search selection as a complete checklist CSV. A mandatory summary row retains unfiltered conflict, missing, review and information counts, continuity status and the query even when nothing matches. Each selected check includes its stable ID, reason, action, context, range convention and exact report IDs/labels. Existing acknowledgement, note inclusion, structured-address shortening and cancellation rules apply. Invalid filters disable export. It exports all matches, not a page. The CSV is a viewing artifact; use the original JSON for restoration.

454. Repeated validation of period drafts, reports, report histories and report sets reuses only immutable canonical objects produced by their own validators. Private weak identity sets are marked after validation and size checks. Caller-owned inputs, frozen wrappers and proxies do not inherit this status and are captured and checked again. This avoids re-traversing identical nested data on repeated views while preserving external-input validation, copy semantics for history entries, result bytes and checksum behavior. It caches no network response or current-chain claim.

## Reproduced outputs and limits

The saved synthetic source contains 15 checks: 8 conflicts, 0 missing, 6 review and 1 information. Captured exports select all 15, 8 EMA conflicts, and zero matches. All retain the same source-wide counts and false continuity status; source data is unchanged. Structured addresses can be shortened, but free-form labels/search can contain addresses. Notes are omitted by default. Formula-like cells are neutralized; import numeric CSV values as text for exact digits. Range rows state their single-block or (start,end] convention. No automatic repairs or live chain verification are implied.

The repeated-read benchmark uses seven synthetic reports, three samples per operation, on one local Windows/Node v24.19.0 run. Median filtered diagnostics fell from 1,085.80 ms to 314.38 ms; filtered checklist CSV from 2,225.24 ms to 427.73 ms. All six before/after result SHA-256 values match. This is an observed local workload, not a general speed guarantee. Original benchmark files are preserved: the after file records base HEAD 57090d9 because it was measured before committing; its working-tree implementation was subsequently committed as db8fb98. benchmark-revisions.json explains this explicitly.

## Validation

- Existing checklist/export/controller/panel compatibility: 107 passed, 0 failed/skipped/cancelled (104,685.8922 ms), before optimization.
- Focused checklist and panel checks: 29 passed, 0 failed/skipped/cancelled (69,485.7917 ms), before optimization. These overlap the compatibility run and are not added as independent work items.
- Immutable-validation controls before the change: 8 passed and 8 failed; the expected identity-reuse behavior was absent. After the change, the controls plus existing model/draft checks passed all 226 cases (8,198.5529 ms).
- Full wallet run at db8fb98: 14,921 passed, 0 failed/skipped/cancelled (369,471.9636 ms).
- Native Chrome: 868 UI cases passed using a synthetic provider and no external RPC, including the new checklist download flow. This used an isolated profile and a fresh ephemeral local server, not the user's connected tab.
- Previously tracked evidence: 115 of 115 manifests, 681 files and 43,964,923 bytes matched; zero mismatched/unreadable files. This audit precedes the present evidence folder.

[Evidence](evidence/2026-10-31-report-checklists-and-validation/) contains the synthetic source, three CSVs, capture metadata, original benchmark files and script, revision mapping, checks, logs, audit and SHA-256 manifest. Re-run benchmark.mjs with repository path and a new output JSON path; timings vary by machine and load.

These are two development items. Test cases, benchmark samples and checksum rows do not increase the item count. No real signing, transfer, approval, secret access, restart of the user's existing server, publication or deployment occurred.
