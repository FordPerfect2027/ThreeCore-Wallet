# Saved history coverage, separately from planned intervals: item 462

Source: `000950c`.

462. Each token/account/chain timeline now includes an expandable “保存済み履歴範囲と、記録がない区間を確認” section. It partitions the displayed planned span into ranges with saved Transfer-query records, planned ranges without records, and intervening ranges without plans. Unlike the original balance-period timeline, these query ranges include both endpoints. Selecting an interval shows its source report IDs, saved window indices and source status.

Counts use exact decimal integers and the union of query windows, so overlapping or duplicate saved reports do not increase the number of covered blocks. Different contexts remain separate. A sweep over interval endpoints handles enormous gaps without enumerating individual blocks. The partition invariant is: recorded + pending planned + unplanned = displayed span, and recorded + pending planned = planned union.

Recorded means presence of saved query evidence, not exhaustive logs or current chain verification. Restricted, incomplete, overlapping and conflicting evidence remains visible and contributes to a separate recorded-range review count. Archived source/report indicators are retained. Event counts shown in details belong to the original whole query window; they are not recomputed for split display cells or summed across records. Missing records do not mean no transactions.

## Validation

Focused coverage and existing timeline checks: 27 passed (2,978.9524 ms). Related report-set, check-detail and period-report checks: 695 passed, zero failed/skipped/cancelled (48,090.1949 ms). Cases cover empty/partial/complete sources, inclusive boundaries, adjacent and overlapping windows, duplicate reports, huge gaps, archived/restricted sources, cross-token chain-hash conflicts, separate chains, missing tokens, immutable results, input preservation, plain-text labels and disposed handlers.

Native Chrome passed 873 UI cases with a synthetic provider and no external RPC. The new case opens the coverage disclosure, selects pending and recorded intervals, checks exclusive selection and original-input preservation, and confirms no file is produced. The test uses an isolated profile and a fresh ephemeral server; it does not reconnect the user's existing browser or change the existing server.

Three synthetic captures in [evidence](evidence/2026-10-31-report-history-coverage/) include the checksummed original sets, exact coverage models, counts, logs and SHA-256 manifest. The partial example has DAT 0/12, EMA 5/12 and CAWELON 12/12 saved-range blocks; these are storage-coverage counts, not mainnet-readiness percentages. Latest full-wallet checkpoint remains 14,968 at 40c28e1. No real signing, transfers, approvals, secrets, publication or deployment occurred.
