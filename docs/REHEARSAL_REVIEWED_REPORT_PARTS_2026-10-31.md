# Recover explicit comparison sides, case collections and original expectations

Items 501–503. Source: `e6ef7a1`.

501. Recover the complete before or after workspace from a verified workspace-comparison report. The screen requires an explicit selection and names the side in both its label and filename. An absent or forged selection cannot trigger saving, and the earlier unambiguous whole-workspace recovery still refuses comparisons. The output is canonical workspace JSON; normal restoration still has its separate preview. No current history is changed.

502. Recover the before or after single-agent input of a verified hypothetical-condition comparison. The input retains its original account/network/asset, events and side-specific conditions. The UI explains that the changed side is hypothetical, gives the ordinary single-record reading destination, and never describes it as executed history.

503. Recover a complete named case collection from its verified aggregate report, or the complete original expectation suite from its verified check report. Names, IDs, order and both input sides are retained. Manual expectations and failing values are preserved exactly; recovery never recaptures them from current calculations to manufacture a passing result. A faithful report can correctly describe failed expectations, and the UI retains that distinction. Empty case collections remain empty.

All actions require an owned fresh recomputation receipt and a matching expected checksum when one was supplied. Copied receipts, altered results and checksum mismatches expose no recovery choice. Source/checksum changes, clearing, disposal or a new choice during download revoke stale status updates. Failed, false and asynchronous download results retain the verified input for retry. Each output names its normal reading destination and is never imported automatically.

The offline command is `node scripts/recover-rehearsal-report-inputs.js report.json --part workspace-before|workspace-after|scenario-before|scenario-after|scenario-set|check-suite [--sha256 HEX]`. One exact part is required; flag order is flexible, duplicate/unknown flags are refused. Exit 0 emits the complete canonical input; exit 2 refuses a verification mismatch or an unavailable part; exit 1 reports invalid input. Refusals emit no partial output. The files reconstruct canonical source values, not original pre-report whitespace.

## Validation

82 focused checks passed (3199.523 ms). Related rehearsal, saved-file boundary and HTTP checks: 1,593 passed, zero failed/skipped/cancelled (62627.9962 ms). Native Chrome at the committed source: all 917 cases passed, with two reconciled isolated profiles and cleanup. Four new browser workflows cover both comparison kinds, the case collection and the failing expectation suite, checking explicit choice, exact output, clearing and byte-identical current-session preservation. Download callbacks are captured; this does not establish user-browser control or OS file-dialog operation.

[Evidence](evidence/2026-10-31-reviewed-report-parts/) contains four synthetic reports, independent reviews, six exact offline recovered inputs, unchanged-source/no-output-refusal captures, preserved failed expectations, logs and SHA-256 hashes. Committed Git bytes are checked after recording. These are three completed user workflows; tests, assertions and retries add no items. Previous full-run limitations remain documented; the last clean full-wallet checkpoint remains c94b3fe (15,294 tests). No real signatures, transfers, approvals, keys, RPC, publication, deployment or restart of the existing server occurred. The count is not a mainnet-readiness percentage.
