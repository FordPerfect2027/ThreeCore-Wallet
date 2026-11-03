# Rehearsal condition comparison — October 29, 2026

The new panel compares the same recorded events under different hypothetical conditions while retaining the original workspace and undo history. It replays from the first record; it is not a future prediction or a policy change applied midway through real operations.

Source: `3a0cb9982ee8731513675c80eff6a1afb5fb6e7c`. Local development only; no push, deployment or mainnet percentage update.

## Twenty completed work items

| Item | Delivered work | Evidence |
| --- | --- | --- |
| 1 | Separate comparison panel with no workspace commit action. | UI tests and unchanged final workspace download. |
| 2 | Fixed agent, chain, account, asset, site, spender, event contents and event order across comparison. | Eleven context/event mutation rejection tests. |
| 3 | Copy nine conditions from the currently displayed canonical source. | Restored DAT source observation and page tests. |
| 4 | Exact monetary input with precision and nonnegative bounds. | Invalid input tests and actual negative-input rejection. |
| 5 | Bounded percentage and independent pause hypothesis. | Model/page tests; actual DAT pause comparison. |
| 6 | Preserve V1 semantics and disable unsupported fee-limit inputs. | Model and page export tests. |
| 7 | Replay dependent opens, settlements and reservations in original order. | Three cascading rejections under the lower DAT limit. |
| 8 | Nine before/after metrics with exact signed differences. | Unit precision test and actual EMA cash-only difference. |
| 9 | Explicit list of changed conditions, including no-change state. | Same-condition and changed-condition UI observations. |
| 10 | Per-record condition decisions and all rejection reasons. | Lower-limit, pause and fee-cap UI cases. |
| 11 | Per-record accounting changes, including downstream effects. | Model/page tests and saved detailed UI observations. |
| 12 | Changed-only record filter with visible and total counts. | Actual one-visible/three-exported quota case. |
| 13 | Reset comparison inputs to the source without clearing its history. | Actual reset observation and page tests. |
| 14 | Revoke old results and both exports immediately on input edits. | Actual edit observation and page tests. |
| 15 | Refresh source on agent changes, restore, append, undo, clear and disposal. | Lifecycle tests and DAT/EMA/CAWELON browser transitions. |
| 16 | Download a complete comparison with both canonical inputs. | Actual browser files independently reproduced offline. |
| 17 | Save the hypothetical input as a separate ordinary rehearsal file. | Actual separate input and source downloads; page test. |
| 18 | Offline same-context comparison command with bounded input handling. | Seven CLI tests and two exact file comparisons. |
| 19 | Regression coverage for the new model, page and CLI. | 54 added tests; 309 related tests pass, zero failures. |
| 20 | Live Edge verification, original-record preservation and saved evidence. | 18 observations, screenshots, exact downloads and manifest. |

## Actual results

DAT's hypothetical per-operation limit of 50 SIM instead of 100 replays three original records as rejected. Under that hypothesis cash is 1,000 SIM, realized P&L is 0, and reserved allocation is 0. The actual page-local source remains at 1,028 SIM cash, 28 SIM realized P&L and 2.8 SIM reserved allocation. No source record was replaced.

The quota-only comparison changes the hypothetical percentage from 10% to 5%. Only the reservation row changes, so the changed-only screen displays one of three records. The exported report still contains all three, and matches offline recomputation exactly.

EMA's hypothetical opening cash increase of 1 SIM changes its final cash by 1 SIM while preserving its -42 SIM P&L. CAWELON's zero entry-fee-cap hypothesis rejects its opening event, while its original unsettled position remains in the workspace.

All these examples use fictional SIM data. They are not recommendations for production parameters.

| Artifact | Bytes | SHA-256, identical to offline output |
| --- | ---: | --- |
| [Lower-limit comparison](evidence/2026-10-29-scenario-comparison/edge-scenario-comparison.json) | 9,274 | `e6fda59527db16b19c6d55107b050bf54fff5b43ff81e9e78045d12e4d9d0f22` |
| [Filtered quota comparison](evidence/2026-10-29-scenario-comparison/edge-filtered-comparison.json) | 9,181 | `45e4287b35e48b8ee8e937930f0c39861ef53007d8ed1e2d9ba4867e14ff86f0` |

The original and final workspaces both contain DAT 3 records, EMA 2 and CAWELON 1; both are 4,771 bytes with SHA-256 `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`. Browser-downloaded source input also matches the original workspace's DAT ledger.

[Final comparison screen](evidence/2026-10-29-scenario-comparison/edge-final-scenario.png) · [UI observations](evidence/2026-10-29-scenario-comparison/edge-ui-observations.json) · [Test log](evidence/2026-10-29-scenario-comparison/rehearsal-tests.log) · [Evidence hashes](evidence/2026-10-29-scenario-comparison/SHA256SUMS.txt).

## Reproduce

```sh
node scripts/compare-rehearsal-scenarios.js docs/evidence/2026-10-29-scenario-comparison/edge-source-input.json docs/evidence/2026-10-29-scenario-comparison/edge-hypothetical-input.json
node scripts/compare-rehearsal-scenarios.js docs/evidence/2026-10-29-scenario-comparison/edge-source-input.json docs/evidence/2026-10-29-scenario-comparison/edge-quota-input.json
node scripts/check-rehearsal.js docs/evidence/2026-10-29-scenario-comparison/edge-final-workspace.json --workspace --json --sha256 b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs
```

The comparison CLI writes JSON and returns 0 when a comparison completes, including rejected outcomes. Invalid inputs or altered identity/events produce exit 1 with no partial JSON. It never writes its source files or contacts a provider. Each input is bounded to 128 KiB/200 records; the report is bounded to 2 MiB.

Report flags remain `simulationOnly: true`, `sourceVerified: false`, `authorizesExecution: false`. Comparison reports are not restore files. The separately exported hypothetical input can be explicitly reviewed and imported like other rehearsal inputs; it is not automatically applied. Results disappear on page reload unless exported.

No wallet signature, transfer, approval, private-key retrieval or on-chain action occurred. The 309 tests cover the rehearsal and local-server suite, not the full wallet suite or real-wallet acceptance.
