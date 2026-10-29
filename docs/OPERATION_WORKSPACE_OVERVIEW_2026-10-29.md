# ThreeCore rehearsal confirmation overview — October 29, 2026

The rehearsal page now brings current unsettled positions, outstanding allocation reservations, and rejected records into one filterable view for DAT, EMA and CAWELON. A record's agent, source position and recorded context remain visible. This is a local development update for fictional SIM records.

Source commit: `92c5b2980c14dcae703b733136f712fb844d58a9`. No push, deployment or mainnet-readiness reassessment was performed in this batch.

## Ten completed work items

| Item | Result | Verification |
| --- | --- | --- |
| 1 | Three separate status cards show recorded, unsettled, reserved and rejected counts. Missing ledgers remain explicitly uncreated. | Model/page tests; empty and restored Edge observations. |
| 2 | Current unsettled operations show principal, reserved exit fee, operation ID and original event position. Settled operations disappear. | Accepted-source mapping test and CAWELON browser filter. |
| 3 | Current allocation reservations show reservation ID and amount; released reservations disappear. An excess over the current profit quota remains visible on its agent's card. | Release/shortfall model test and DAT reservation filter. |
| 4 | Rejected records show all rejection reasons, original event ID/position, and an explicit no-accounting-effect label. | Multi-reason rejection in Edge; source-context tests. |
| 5 | Each agent exposes its recorded chain, account, asset address, site and spender; rejected events retain their own identity for comparison. | CAWELON context expansion and mixed-account model test. |
| 6 | Agent and category filters preserve the selected ledger and pending reviews. A known zero-result filter differs from an uncreated ledger. | Page tests and live EMA, position, reservation and rejected filters. |
| 7 | Download a complete overview, including canonical source inputs, independent of the active filter. Pending edits do not enter the report. | Export under a zero-result filter, plus exact download comparison. |
| 8 | Reproduce the same JSON offline from an explicitly supplied bounded workspace file. | Both actual browser downloads match offline output byte for byte. |
| 9 | Verify lifecycle updates, input boundaries, V1 preservation and all 600 possible rejected records without truncation. | 25 added tests; 255 related tests pass, zero failures. |
| 10 | Complete live Edge checks, undo the test-only rejected append, preserve the original six records and save evidence. | 14 observations, two screenshots, final download, hashes and offline file check. |

## Recorded results

The original workspace contains DAT 3 records, EMA 2 and CAWELON 1. The final workspace is byte-identical to the backup taken before this update:

`b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302` (4,771 bytes).

The final overview has DAT reservation `dat-reserve` for 2.8 SIM and CAWELON operation `one` with 100 SIM principal and 2 SIM reserved exit fee. EMA has no current open positions or reservations. These are fictional inputs, not observations of real funds.

A test-only DAT open request for 1,000 SIM was confirmed as a rejected record, with four reasons and no change to cash, P&L or existing reservation. Its workspace/report were saved for reproduction, then the append was undone. It is **not** present in the final workspace.

| Actual browser artifact | Bytes | SHA-256; identical to offline output |
| --- | ---: | --- |
| [Baseline overview](evidence/2026-10-29-workspace-overview/edge-overview.json) | 8,218 | `2b76659f4c40bdd4939cad0beb299d5bfc3bafac2a4ebe3071b73f8b0db754a2` |
| [Rejected-record test overview](evidence/2026-10-29-workspace-overview/edge-rejected-overview.json) | 9,328 | `ea4bf0eb61ef3472647a8870fb3029a90ad2e79d1ce744c70e6a9fe204372128` |

[Final screen](evidence/2026-10-29-workspace-overview/edge-final-overview.png) · [UI observations](evidence/2026-10-29-workspace-overview/edge-ui-observations.json) · [Test log](evidence/2026-10-29-workspace-overview/rehearsal-tests.log) · [Evidence manifest](evidence/2026-10-29-workspace-overview/SHA256SUMS.txt).

## Reproduce offline

Run from this repository; no RPC, wallet provider or network is used:

```sh
node scripts/summarize-rehearsal-workspace.js docs/evidence/2026-10-29-workspace-overview/before-workspace.json
node scripts/summarize-rehearsal-workspace.js docs/evidence/2026-10-29-workspace-overview/rejected-test-workspace.json
node scripts/check-rehearsal.js docs/evidence/2026-10-29-workspace-overview/edge-final-workspace.json --workspace --json --sha256 b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs
```

The overview command writes JSON to standard output. Exit 0 means a report was produced, including any rejected or unsettled entries; it does not mean an operation is authorized. Exit 1 means the input could not be processed. Compare UTF-8 output bytes with the saved overview. No input files are modified.

## Scope and limits

- All amounts retain exact integer units and their original asset context. No agent, chain, account or asset totals are invented.
- Current positions/reservations and historical rejected records have different meanings. The three categories do not constitute a launch checklist or complete risk assessment.
- The JSON report includes the full canonical workspace and is not itself a restorable workspace. Use the separate workspace download for restoration. Filters affect the displayed rows only; cards and downloaded reports always cover all three agents.
- Inputs remain limited to three unique agents, 200 events/128 KiB per ledger and 512 KiB per workspace. Overview export is limited to 2 MiB. Original V1 policy semantics are preserved.
- Page reload/closure discards page-local state; ordinary saved files are not encrypted or authenticated. Report flags remain `simulationOnly: true`, `sourceVerified: false`, `authorizesExecution: false`.
- No signatures, transfers, approvals, private-key retrieval or on-chain execution occurred. The existing local-origin protection and network-disconnected rehearsal policy remain in effect.

The 255-test result is the relevant rehearsal and local-server suite for this source commit. It is not a claim that the full wallet suite or a real-wallet acceptance test was rerun.
