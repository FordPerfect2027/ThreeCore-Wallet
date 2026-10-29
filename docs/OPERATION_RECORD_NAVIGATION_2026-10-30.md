# Record navigation and provenance — continuation items 61–80

Source commit: `5174cb4941e138d49716b8bc7f2cb7b507679d67` (local only).

The rehearsal now provides a read-only explorer for every committed fictional event, including accepted records. It exposes the stored ledger context, the event's own context, its position in that ledger, its immediate before/after balances, and related operation or reservation IDs. A filtered report retains complete source input for offline reproduction.

## Completed work

61. Index all committed records across the three ledgers in deterministic per-agent order.
62. Give identical event IDs distinct agent-qualified keys.
63. Preserve missing versus present-empty ledger scope.
64. Retain storage identity separately from event-declared identity.
65. Calculate six immediate before/after balances and exact deltas.
66. Preserve rejected records and their explanations without moving simulated funds.
67. Relate events by operation ID within one stored ledger.
68. Keep reservation references separate from operation references and other agents.
69. Combine agent, event-kind and decision filters.
70. Search bounded literal terms with case-insensitive AND matching.
71. Paginate matching records while preserving full match counts.
72. Reset page position when filters change and clear stale detail when no record matches.
73. Display original event fields and monetary units in a selected-record inspector.
74. Refresh the explorer after committed changes without including pending edits.
75. Preserve ledger undo, pending append and pending restore while exploring.
76. Add page navigation links to reach the growing rehearsal tools.
77. Export query, all matches and complete original input independently of the visible page.
78. Add an offline query command with validated options and bounded file input.
79. Test identity isolation, rejected effects, pagination, state lifecycle and offline output.
80. Exercise browser queries, saved downloads and exact offline reproduction; preserve evidence and original inputs.

## Verification

445 related tests passed, zero failed (27 added):

```powershell
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs
```

This is not a new full-wallet-suite run. Pagination was tested using 27 fictional deposits, with ten rows per page and all 27 retained in exports. Other tests cover agent-mismatched events, same-ID operation/reservation separation, incomplete CLI flags and source changes.

The actual Edge page showed all six preserved events. Filtering DAT/settlement showed one event and only its DAT opening record as related. The immediate settlement changed cash 899 → 1028 SIM and P&L −1 → 28 SIM. Searching `EMA settle` selected EMA's loss settlement, with P&L −1 → −42 SIM. Searching `dat-reserve` showed unchanged cash/P&L and a 2.8 SIM reservation. Searching a nonexistent ID cleared old details and produced an explicit zero-match report within the six-record scope. CAWELON's opening event showed no matching settlement.

## Evidence and reproducibility

[Evidence directory](evidence/2026-10-30-record-navigation/), [browser observations](evidence/2026-10-30-record-navigation/browser-observations.json), [DAT settlement screen](evidence/2026-10-30-record-navigation/edge-dat-settlement-detail.png), [all-records screen](evidence/2026-10-30-record-navigation/edge-all-records-pending-detail.png), [checksums](evidence/2026-10-30-record-navigation/SHA256SUMS.txt).

```powershell
node scripts/inspect-rehearsal-records.js docs/evidence/2026-10-30-record-navigation/workspace-before.json
node scripts/inspect-rehearsal-records.js docs/evidence/2026-10-30-record-navigation/workspace-before.json --agent DAT --kind settle
node scripts/inspect-rehearsal-records.js docs/evidence/2026-10-30-record-navigation/workspace-before.json --search missing-record
```

All three commands exit 0 for completed queries. Invalid inputs/options exit 1 without partial output. A zero-match query is not evidence of zero real funds or absence of on-chain history.

| Exact browser/offline output pair | SHA-256 |
| --- | --- |
| All six records | `e4bf61ac749276e3f436d3b22fd5d77d8e7d2e3a233149c798c87b96d5fc8864` |
| DAT settlement | `612e63f82223ce3c59ab6c8cb3f30186bccbb678e3a76679ad3e72828f389724` |
| No matching record | `bc98a415c6a2d4bae88e2ec1999daa3c8e2fe06deda5b638bbab592c49b4cabf` |

Workspace and case collection before/after hashes remain respectively `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302` and `0914d537e54362f7882884f904358d36f028d557c5bd385ee01b5c94938445e3`.

## Scope and limits

The explorer uses the existing three-ledger, 200-events-per-ledger bounds. Search is limited to eighty characters and matches literal ID/address/reason text, not regular expressions. Display size is ten, twenty-five or fifty records. Full report encoding is capped at two MiB. Money is never summed across ledgers. Related records mean matching IDs within the same stored context; the relation does not prove execution or settlement. The canonical DAT/EMA/CAWELON order is not cross-chain chronology.

Browser source restoration used the ordinary paste fallback. The real UI had six events; multi-page behavior and rejected foreign-context events were verified in automated tests. No signing, transfer, approval, private-key retrieval, publication or deployment was performed.
