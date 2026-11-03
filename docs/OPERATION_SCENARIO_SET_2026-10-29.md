# Named comparison collections — continuation items 21–40

Source commit: `6d376be4240f58aa2f8cf5ea0efecf7ce598e456` (local only).

The rehearsal can retain separate named hypothetical comparisons, review changes before applying them to the collection, undo collection changes, and save their complete inputs or recomputed summaries. A collection is separate from the three live fictional ledgers. No wallet operation is performed.

## Completed work

21. Define a bounded collection format containing original and hypothetical inputs for each case.
22. Validate unique stable IDs and normalized, bounded human-readable names.
23. Enforce matching identity and events within each comparison.
24. Retain immutable snapshots independently of subsequent displayed-source edits.
25. Preview an addition before it becomes a saved case.
26. Require an explicit replacement action for an existing ID.
27. Review name changes without altering stored scenario inputs.
28. Review removals with the affected ID and identity visible.
29. Retain up to ten reversible collection changes, including imports.
30. Review and cancel whole-collection replacement before applying it.
31. Bound file import and reject malformed UTF-8, duplicate keys and invalid data.
32. Provide a normal paste fallback and revoke stale asynchronous reads.
33. Filter the displayed collection by agent or outcome without narrowing exports.
34. Display the selected case's identity and nine monetary comparisons.
35. Save the complete collection's original and hypothetical inputs.
36. Save the complete collection's recomputed summary report.
37. Save one selected case as the existing full comparison report format.
38. Reproduce the collection summary offline from the saved input file.
39. Recompute and review collection reports, identifying individual cases and altered derived fields.
40. Validate the integrated page, browser downloads, offline equality and unchanged original ledgers; retain evidence.

## Validation and evidence

`node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs`

385 related tests passed, zero failed. The increase of 38 tests covers collection validation/state, panel interactions, parent-ledger preservation, CLI errors and report tampering. This is not a new full-wallet-suite run.

The actual Edge rehearsal page produced three cases:

| Case | Change | Changed records | Newly rejected |
| --- | --- | ---: | ---: |
| dat-limit-50 | DAT maximum principal 100 → 50 SIM | 3 | 3 |
| dat-quota-5 | DAT allocation percentage 10% → 5% | 1 | 1 |
| ema-opening-1001 | EMA opening cash 1000 → 1001 SIM | 2 | 0 |

The visible rejected-only filter showed two cases; the complete input/report downloads still contained all three. Duplicate addition was refused. Rename, deletion, undo, cancelled import, applied import and import undo were exercised. Source changes preserved saved cases. The collection report was also reviewed in the page, with each case ID shown separately.

Evidence: [saved artifacts](evidence/2026-10-29-scenario-set/), [browser observations](evidence/2026-10-29-scenario-set/browser-observations.json), [case screen](evidence/2026-10-29-scenario-set/edge-case-collection.png), [review screen](evidence/2026-10-29-scenario-set/edge-collection-review.png), [checksums](evidence/2026-10-29-scenario-set/SHA256SUMS.txt).

| Exact-byte check | SHA-256 |
| --- | --- |
| Original workspace before/after | `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302` |
| Case inputs before/after undo/import cycle | `0914d537e54362f7882884f904358d36f028d557c5bd385ee01b5c94938445e3` |
| Browser and offline collection report | `631ed3233adda88ca3baeed8383448f2ff6ce19704d72b8d1b169f1173321014` |
| Browser and offline review receipt | `f1ece5efdf5fabf0720b27ca9b88a826e0b47339e0adf07cf6cfdd10967e0e93` |

The preserved workspace has DAT 3 records, EMA 2 and CAWELON 1. Their recorded fictional P&L remains +28, −42 and −1 SIM respectively. The selected DAT quota case matches the previously saved full comparison byte for byte.

## Offline reproduction

From the repository root:

```powershell
node scripts/summarize-rehearsal-scenario-set.js docs/evidence/2026-10-29-scenario-set/edge-case-inputs.json
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-29-scenario-set/edge-case-report.json
```

The summary command exits 0 for a completed report even when some hypothetical records are rejected. The review command exits 0 for matching recomputation, 2 for a valid review that finds differences, and 1 for invalid or unreadable input. Neither command approves execution or modifies input files.

## Limits

The maximum is twelve cases and one MiB of canonical collection input; either limit can be reached first. Collection undo is limited to ten changes and ends when the page closes. Save explicitly before closing. Source and hypothetical records repeat across cases and must not be counted as additional unique historical coverage.

Actual browser imports used the normal paste fallback. File reading, invalid bytes, chooser cancellation and stale completions were tested in the panel tests; native chooser import was not claimed as verified in this session. All records here are fictional simulation inputs. Recomputed agreement is not source authenticity, real balance verification, mainnet readiness or a security certification.
