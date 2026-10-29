# Ten-part operation-ledger development batch — October 29, 2026

This batch extends the offline rehearsal into a sequential, reviewable ledger. It remains a fictional single-asset exercise: it does not connect a wallet, sign, transfer funds, submit token approvals, buy back tokens or burn tokens. The changes are local development, not a public release or evidence of 50% mainnet readiness.

## Ten work items

| Item | Implemented behavior | Automated evidence |
| --- | --- | --- |
| 1. Fee ceilings | V2 has explicit opening and closing fee limits; V1 is not silently migrated. | `operation-rehearsal-v2.test.js` |
| 2. Closing-fee reservation | Each unresolved V2 operation reserves closing fees; new principal and capital withdrawals cannot consume them. Closing fees above the declared reserve are rejected. | Model and page tests |
| 3. Allocation reservation | A hypothetical allocation reserves part of cumulative net profit; the remaining budget subtracts existing reservations. | Three-agent double-allocation tests |
| 4. Reservation release | Full cancellation restores the reserved amount without creating profit. A consumed reservation ID cannot be reused, and a foreign agent cannot release it. | Model and ledger tests |
| 5. Sequential records | Append opens, settlements, deposits, withdrawals, allocations and releases, with a 200-record bound. | Ledger and page tests |
| 6. Review before append | Preview displays before/after figures. Confirmation applies only that exact current preview once. Edits, replacement, cancellation and disposal invalidate it. | Ledger and page tests |
| 7. Undo | Undo restores the exact preceding ledger, including reserved amounts. Keep at most ten append checkpoints; replacement or agent changes clear them. | Ledger and page tests |
| 8. CSV | Export recalculated applied rows, explicit simulation flags and exact base-unit strings. Unconfirmed previews are excluded. | Ledger and page tests |
| 9. Offline file checker | Independently of the browser, bounded file reading, strict UTF-8/JSON validation, SHA-256 comparison and recalculation. | `operation-rehearsal-cli.test.js` |
| 10. End-to-end verification | Existing regression checks, Chrome interaction, real downloads, reload/import, offline verification and a saved evidence record. | Batch validation record |

## How to use it

Open the local demo's `/rehearsal/` page. Display an example to create a V2 ledger. The original single-operation inputs create a new scenario; to continue the displayed history use **いまの履歴に1件追記** instead.

Choose a record type, enter its operation/reservation ID and relevant amounts, and press **追記前に確認**. The preview changes no applied state. **確認した記録を追記** then appends that exact record. A rejected proposal can be explicitly retained as a rejected record; it changes no money and blocks new allocation until undone. **追記確認を取り消す** cancels only the pending preview. **直前の追記を取り消す** undoes an applied append.

For a settlement, use an ID displayed as unresolved. For a release, use an active reservation ID. The page displays both lists. Deposits are capital, not profit. Reservation and release records alter availability, not cash balances or profit. All amounts and fees use the same fictional asset; ETH gas is not converted to SIM.

Saving JSON preserves the current inputs and ordered records. Loading requires separate review/application and recomputes the result. Previous V1 files remain V1 and can still be read/saved; this page disables appending to V1 rather than inventing fee limits or fee reserves. Start a new example for V2. There is no automatic browser storage or cross-agent ledger recovery.

The CSV is a derivative viewing aid, not an import or an authenticated receipt. Monetary columns are exact **base-unit strings** with an explicit decimals column. Import them as text in spreadsheet software to avoid its numeric precision limits. JSON remains the recalculable record.

## Exact accounting and limits

The capital identity remains:

`cash + unresolved principal = opening capital + deposits - withdrawals + cumulative realized P&L`

V2 also reports:

`available cash = cash - reserved closing fees - reserved allocation`

Opening principal and withdrawals must leave the entered reserve floor after those reservations. The modeled worst-case loss check includes all unresolved principal and reserved closing fees. Opening fees are recognized immediately; a successful settlement releases its reserved closing fee and recognizes the actual supplied fee. A settlement beyond its fee reserve is rejected as a hypothetical proposal; this is not a mechanism for hiding or reconciling an actual on-chain expense.

The profit quota is `floor(max(cumulative P&L, 0) * allocationBps / 10000)`. New allocation is limited to the unreserved portion of that quota and available cash above the reserve floor. Unresolved positions, rejected records or pause disable new allocation. A later loss can make earlier reservations exceed the quota: the report shows the excess and blocks further allocation. Releasing reservations reduces this excess without inventing profit.

An allocation is an **unexecuted reservation**. The model does not record a spent buyback budget, actual token purchases, burns, distributions, valuation changes, slippage or tax accounting. It has no cryptographic authority to enforce a limit on a wallet. A matching checksum establishes byte equality with a supplied hash; it does not establish authenticity or independently validate on-chain history.

## Offline checker

From this checkout:

```sh
npm run rehearsal:check -- path/to/rehearsal.json --json
npm run rehearsal:check -- path/to/rehearsal.json --sha256 EXPECTED_64_HEX_CHARACTERS
```

The checker reads only the named file, with a 128 KiB cap, and performs no network requests, wallet requests or file writes. `expectedChecksumMatched` is null when no expected hash was supplied. Exit 0 means the file was recalculated and its supplied records satisfy the modeled constraints; exit 2 means a structurally valid file contains rejected records or an overcommitted allocation; exit 1 means argument, file, encoding, checksum or schema failure. None authorizes execution.

Reproduce the focused checks:

```sh
node --test test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs
```

Token-contract compatibility tests require their own compiled token checkout and are outside this offline batch. The existing local HTTP origin protection remains unchanged; an automation-origin navigation that is refused should be opened once through the normal address bar, then in-page controls and reload can be used.

## Validation record

The automated validation runs are complete:

- Full unit regression: **11,707 passed, zero failures**, rerun with concurrency 2.
- Final focused model/controller/UI/CLI/server run: **130 passed, zero failures**. This includes two additional reentrancy checks added after the full regression had already loaded the ledger tests. These counts overlap and must not be added together.
- Integration regression: **406 passed, zero failures**, excluding the token-contract compatibility suite that needs a separate compiled token checkout.
- The first full run had one timing-sensitive failure in `file-read-formats.test.js` (a 5 ms caller deadline). Its isolated rerun passed all 66 cases, and the lower-concurrency full rerun passed without changing that test or its implementation. Both the failed and successful logs are retained.
- Existing V1 Chrome-exported data still recalculates correctly and matches its previously recorded SHA-256. Synthetic V2 fixtures and CSVs for DAT, EMA and CAWELON were saved and independently recalculated; these fixtures are explicitly labeled as generated files, not Chrome downloads.

Chrome verification completed on October 29, 2026 (JST), after attaching to the newly opened rehearsal tab. All ten items in this batch are complete within the offline simulation scope.

The observed sequence covers the profit example, rejection of an opening fee above its ceiling, closing-fee reservation, settlement preview without applying it, confirmed settlement, allocation preview/application, rejection and cancellation of an excess allocation preview, allocation release, undo, and revocation of a preview after editing. Actual Chrome JSON and CSV downloads were then saved. Reload cleared the volatile page state; importing the downloaded JSON required confirmation and restored the same three applied records, with no undo history carried across reload. Sixteen DOM observations and screenshots are retained.

The restored fictional result is: cash **1,028 SIM**, cumulative realized P&L **28 SIM**, fees **2 SIM**, reserved allocation **2.8 SIM**, available cash **1,025.2 SIM**, and remaining hypothetical allocation **0 SIM**. The downloaded CSV exactly matches the rows recalculated from that JSON. These are demonstration amounts, not account balances or on-chain results.

Saved evidence: [index and verification instructions](evidence/2026-10-29-operation-ledger/README.md), [actual Chrome JSON export](evidence/2026-10-29-operation-ledger/chrome-DAT-ledger-v2.json), [actual Chrome CSV export](evidence/2026-10-29-operation-ledger/chrome-DAT-ledger-v2.csv), [browser observations](evidence/2026-10-29-operation-ledger/chrome-ledger-validation.json), [independent file check](evidence/2026-10-29-operation-ledger/chrome-download-offline-check.json), and [restored result screenshot](evidence/2026-10-29-operation-ledger/chrome-ledger-result.png).

The JSON export is 1,581 bytes, SHA-256 `7d719172ede0bb3c54812d8c29850798177a821b25e773bdd98b91717848f1c9`. The CSV export is 786 bytes, SHA-256 `66156b636f6326fe49db923ae79446b485d479e9c193dd63cc987ba71cb2637d`. Hashes establish byte equality only. The source and evidence are saved locally; this work does not establish a mainnet completion percentage.
