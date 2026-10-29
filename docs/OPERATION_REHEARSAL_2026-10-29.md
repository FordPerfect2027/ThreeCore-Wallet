# Offline operation rehearsal — October 29, 2026

The wallet now has a separate Japanese rehearsal screen at `/rehearsal/`. It helps inspect the intended DAT, EMA and CAWELON operation model before any execution integration: enter hypothetical limits, distinguish principal from profit, and see when a hypothetical own-token allocation must remain zero.

All examples use fictional SIM units, accounts and a fictional target. No example parameter is an approved operating policy. The screen does not connect to a wallet, request a signature, submit a transaction, grant an allowance, buy back tokens or burn tokens. Its content policy prohibits network connections. The server continues to enforce its existing origin and embedding boundaries.

## Using the screen

Start the existing local demo (`npm run demo`) and follow the operation-rehearsal link, or enter its local `/rehearsal/` URL directly in Chrome's address bar. If an automation-created navigation is refused as cross-site, a normal address-bar navigation is required; do not disable the server's origin protection. After opening the page this way, ordinary in-page actions and reloads work.

1. Choose DAT, EMA or CAWELON and a sample, then press **この例を表示**.
2. Inspect available cash, unresolved principal, cumulative realized P&L, fees and the conditional allocation estimate.
3. For a new single-operation scenario, change the inputs and choose either the unresolved or settled calculation. This replaces the displayed hypothetical scenario; it does not append to an imported ledger or edit all operations in a multi-operation example.
4. Save the inputs using **この試算の入力記録を保存**. The button hands the file to the browser; the message does not certify that a download completed.
5. Reopen the page, choose the saved JSON file, review its agent and record count, and press **確認した記録を表示**. The screen recalculates the result from the input records. File selection alone does not apply it.

Changes to inputs, agent or sample selection invalidate the previous result and its export. Cancelling or changing the selection also invalidates pending imports. The page accepts only fictional six-decimal SIM documents, limited to 128 KiB and 200 events.

## Calculation and policy boundaries

- Amounts use exact integer arithmetic. Deposits and withdrawals alter capital, never profit.
- Opening an operation removes principal and its opening fee from cash, leaves principal unresolved, and recognizes only the fee as an expense.
- Settlement recognizes gross return minus principal and closing fee. Previously recognized opening fees remain in cumulative P&L.
- Each accepted event preserves `cash + unresolved principal = opening capital + deposits - withdrawals + cumulative realized P&L`.
- Agent, chain and account must match the document. New operations must match the entered HTTPS origin and spender, stay within principal limits and the cash reserve, and respect pause and loss-budget settings. Operation IDs cannot be reused after acceptance. Replayed or unknown settlements are rejected.
- The loss-budget check models cumulative realized P&L minus opening fees and a full loss of unresolved principal. It does not predict future exit fees, price changes or actual loss containment. Settlement records describe supplied outcomes even when a loss has already occurred.
- Rejected business records do not change balances. They block allocation. Invalid document structure instead rejects the file.
- Hypothetical allocation is capped by positive cumulative P&L times the entered proportion and cash above the reserve, with integer rounding down. Any unresolved position, rejected record, pause or absence of net profit makes it zero. It is a budget illustration, not a payment or executable instruction.

One document represents one asset. The model does not price multiple assets, account for ETH gas in token units, reconcile on-chain receipts, validate dApp behavior, reserve a previously spent buyback budget, or implement an audited trading controller. Exports contain the inputs, not an authenticated result. Model results explicitly carry `simulationOnly: true`, `sourceVerified: false` and `authorizesExecution: false`.

## Recorded checks

All values below are fictional SIM. Opening capital is 1,000 SIM; example allocation is 10%.

| Scenario | Final cash | Unresolved principal | Realized P&L | Allocation estimate |
| --- | ---: | ---: | ---: | ---: |
| Profit | 1,028 | 0 | 28 | 2.8 |
| Loss | 958 | 0 | -42 | 0 |
| Loss followed by profit | 1,016 | 0 | 16 | 1.6 |
| Principal limit exceeded | 1,000 | 0 | 0 | 0 |
| Unresolved operation | 899 | 100 | -1 | 0 |
| Capital deposit only | 1,500 | 0 | 0 | 0 |

Chrome displayed all six DAT scenarios and the EMA/CAWELON profit scenarios. Editing an input removed the old results and disabled saving. The four-event loss/recovery example was actually downloaded, the page reloaded, and the file selected and explicitly applied. Recalculation returned cash 1,016 SIM, P&L 16 SIM, fees 4 SIM and allocation 1.6 SIM. The browser tool's download-event notification timed out; the actual saved file and its successful re-import independently establish the round trip.

Automated checks recorded for this development iteration:

- 60 new model tests: exact amounts, all three agents, scope/limit failures, replay protection, capital separation, accounting invariants, malformed input and file bounds.
- 11 new page tests: invalidation, explicit import application, cancellation, stale async completion, export and disposal.
- 3 new HTTP tests: route/module availability, local-only boundaries and no writable/file-exposure endpoint.
- Entire unit suite: **11,653 passed, 0 failed** (includes the 71 new model/page tests).
- HTTP and other wallet integration cases: **406 passed** (includes the 3 new HTTP tests).
- An initial `integration/*.test.mjs` invocation also selected `token-compatibility.test.mjs`, which deliberately fails from this wallet checkout because it must run inside a compiled token checkout. This environment-specific suite was not validated in this iteration; the 406 successes do not imply all 407 selected entries passed.

Focused reproduction:

```sh
node --test test/operation-rehearsal.test.js test/operation-rehearsal-page.test.js integration/operation-rehearsal-server.test.mjs
```

The screen and source are local development work. No public source release, deployed website, contract upgrade, real transaction, production acceptance or independent security audit is established by this record. The earlier subjective 35% planning estimate has not been raised to 50% on the strength of these offline checks.
