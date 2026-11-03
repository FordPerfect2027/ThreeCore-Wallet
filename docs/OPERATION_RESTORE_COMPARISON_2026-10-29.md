# Rehearsal restore comparison — October 29, 2026

Equal record counts can hide a different recorded account, chain, asset, destination, policy or event value. The restore review now exposes those differences before application. Source commit: `aaa4489a2cf941ee5d6745f735ecc2375d823763`.

## Ten completed work items

| Item | Implemented behavior and verification |
| --- | --- |
| 1. Canonical change classification | Distinguishes absent, added, removed, unchanged and replaced ledgers. Selection-only changes are reported separately; zero records remain distinct from absence. Tested; identical-input classification observed in Edge. |
| 2. Account and chain review | Shows full recorded account and network identifiers before/after and names changed fields. Equal counts no longer hide a change. Tested and observed. |
| 3. Asset identity review | Compares contract address, symbol and precision separately. Different account/chain/asset contexts are flagged without subtracting or aggregating amounts. Tested; changed contract observed. |
| 4. Destination and format review | Displays recorded origin, spender and file version as plain text. It never opens an imported URL or upgrades an old file. Tested; destination changes observed. |
| 5. Policy review | Shows changed opening balance, limits, reserve, allocation percentage, paused state and fee caps using exact units. Missing V1 fee fields remain absent. Tested; four condition changes observed. |
| 6. Event review | Identifies added, removed and modified IDs, plus changes in the relative ordering of shared IDs. The UI bounds ID previews; saved reports include all IDs. Tested; addition, removal and same-ID modification observed. |
| 7. Modeled findings | Shows rejected-record count, unresolved-position count and allocation-overcommit status from recalculation. These are simulation findings, not execution permission. Tested; three rejected DAT records and one unresolved CAWELON position observed. |
| 8. Saved comparison | Exports both canonical input snapshots and the computed comparison while review is pending. Saving does not apply it. Cancellation, edits, switching, failed reads, application and disposal revoke the export. Tested and observed. |
| 9. Offline reproduction | Adds `compare-rehearsal-workspaces.js` and `npm run rehearsal:compare -- BEFORE AFTER --json`. Uses the existing bounded, fatal-UTF-8 file reader. The browser download matched a separate CLI computation exactly. |
| 10. Regression and real-browser evidence | 230 related tests passed. Thirteen Edge observations, screenshots, actual downloads, input fixtures, CLI output and checksums were saved. The original six records were retained and the final workspace export exactly matches the original. |

## Using the comparison

Choose or paste a saved workspace as before. The review still requires **確認した3トークンの履歴を復旧** to apply anything. Expand a token's **照合詳細** to inspect full identifiers, changed policy values, event changes and modeled findings. **復旧前の照合資料を保存** downloads `ThreeCore-workspace-comparison.json` without changing the current histories.

**内容は同じ** means normalized input equality after validation, not byte equality or matching undo checkpoints. An identical confirmed restore still resets undo. Canonicalization ignores JSON formatting, property order and address case, while preserving event order and original V1/V2 semantics. The information is supplied by files; it does not authenticate a wallet, chain, token contract or service. No amounts are summed across agents or subtracted across different accounting contexts.

The comparison report uses `threecore.operation-rehearsal-comparison.v1`, contains immutable `inputs.before`, `inputs.after` and per-agent comparison rows, and retains `simulationOnly: true`, `sourceVerified: false`, `authorizesExecution: false`. It is deliberately not a restorable workspace. Each input keeps the existing 512 KiB workspace limit and 128 KiB/200-event member limits; encoded reports are capped at 1,114,112 bytes. Screen ID lists show at most eight IDs per category; the report carries the complete bounded lists.

## Offline reproduction

```sh
node scripts/compare-rehearsal-workspaces.js before-workspace.json proposed-workspace.json --json
```

JSON output is deterministic and uses the same computation as the page. Text mode also prints the two raw file checksums. Exit 0 means the comparison completed; it does not mean inputs are equal, modeled constraints passed, or execution is authorized. Exit 1 means arguments, files or structures were invalid. No files are written by the command itself. Both inputs are read and validated before any report is emitted. The existing single/workspace checker output and exit-code semantics are retained.

## Validation and evidence

```sh
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs
```

**230 passed, zero failures.** The iteration adds 41 tests: 17 comparison-model, 14 comparison-CLI and 10 page-controller tests. The run includes 61 page tests and both ordinary/test-fixture HTTP modes. Counts overlap. The unrelated full wallet suite was not rerun.

The Edge fixture deliberately proposed a different DAT account, chain, asset contract and destination, four policy changes and a modified settlement value. It also added one EMA event and removed CAWELON. That proposal was reviewed and exported, then cancelled; it was never applied. Its original DAT events intentionally retain their old context, so all three become rejected in the proposed simulation. The downloaded comparison is 20,352 bytes with SHA-256 `245284bcc3672ae90eec54ada6837780775d8bc4670f6a0ee3fe4a612d144193`, byte-identical to the separate CLI result.

Importing the derived comparison as a workspace was rejected without changing current records. Re-reading the original file correctly classified all three ledgers as unchanged and still disclosed CAWELON's unresolved position. Final state is the original DAT 3, EMA 2 and CAWELON 1 records. The final 4,771-byte export has SHA-256 `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`, matching the original; the workspace checker returned exit 0.

[Saved evidence and checksums](evidence/2026-10-29-restore-comparison/README.md). This is local fictional rehearsal development. No signatures, transfers, approvals, private-key retrieval or external publication occurred. These ten items do not establish a mainnet-readiness percentage.
