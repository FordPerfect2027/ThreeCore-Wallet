# Local testnet acceptance work — 2026-10-25

Developed from `bf409924d5d65bcd2283159581b6ddc98be4084d` in an isolated PC checkout.
Nothing from this iteration has been pushed to GitHub. The source checkout and
its unmodified baseline remain available, with a separate pre-change Git bundle.

## Scope and completion criteria

The current milestone is a **read-only ThreeCore testnet prototype**: explicitly
connect each DAT/EMA/CAWELON account, check balances, keep observations, save and
restore settings/history, and stop safely. It does not include custody, signing,
transfers, approvals, swaps, bridges or autonomous spending.

The earlier conversational 70% was a rough estimate, not a measured requirement
score. This iteration replaces line-count targets with observable acceptance
criteria. Test counts and the number of checklist rows must not be converted
into a claim of 90% overall completion.

| Acceptance area | Evidence in this iteration | Status |
| --- | --- | --- |
| Three distinct account/provider identities | Full application connected DAT, EMA and CAWELON with separate fixture providers and account addresses | Passed locally |
| Exact balances against compiled token contracts | 50 local-EVM integration cases per token, including existing balances/allowances and block consistency checks | Passed locally |
| Save, close/reopen and restore all three histories | Full application remount plus an actual in-app browser page reload; restored settings and one identical history per token | Passed locally |
| Restoring does not restore wallet permission | Zero permission/RPC calls after native reload, inspection and confirmed restore; reconnection is an explicit later action | Passed locally |
| Stop, delayed response and account/network changes | Per-token application tests; delayed RPC cannot revive results or start another read; unaffected cards stay connected after one account changes | Passed locally |
| Failure recovery and preservation | A failed observation leaves accepted history intact; only a new successful read can create fresh output | Passed locally |
| Stop during view publication | Reproduced on baseline, fixed, tested for all three agents and against actual local token contracts | Passed locally |
| Existing security and storage regression suite | 10,700 unit, 348 HTTP and 710 browser cases, no failures | Passed locally |
| Public Base Sepolia registered contract identities | Code, name, symbol and decimals read at a single canonical block hash for all three catalog entries | Observed successfully |
| Three distinct real wallets on the public testnet | Permission UI, actual account ownership, balances, save/reload/restore and reconnect in the intended wallet/browser environment | Pending user wallet availability |

The last row remains an acceptance gate. Local provider fixtures and local EVM
tests are not evidence that a browser extension granted real account access.
The public contract probe also requested no wallet permissions or user balances.
Mobile wallets, WalletConnect and external dApp interoperability need their own
scope and evidence before being described as supported.

## Fixed view-delivery bug

An `onChange` observer can synchronously disconnect or clear a result while the
card is publishing it. Previously, the card updated its internal state but its
notification guard suppressed delivery of the restrictive state to that same
observer. The displayed state could therefore retain a cancelled result or a
connected label although the operation had already stopped.

`wallet-card-controller` now delivers the updated restrictive view after the
observer returns. Notifications are bounded to three iterations, stop on disposal,
and stop immediately when the visible phase/connection/result/error is unchanged.
Existing transition boundaries continue to reject reentrant operation starts.
This is a display/lifecycle correction, not evidence of a fund transfer.

Nine new regression cases failed on the baseline and pass after the fix. The
focused controller/progress suite passed 113 cases. The full suites below were
then run on the final implementation.

## Validation counts

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Node unit tests | 10,700 | 0 |
| HTTP isolation and routes | 348 | 0 |
| In-app browser full application tests | 710 | 0 |
| DAT compiled contract / local EVM | 50 | 0 |
| EMA compiled contract / local EVM | 50 | 0 |
| CAWELON compiled contract / local EVM | 50 | 0 |
| Total, excluding repeated focused runs and public probes | 11,908 | 0 |

The comparable unit/HTTP/browser subtotal is 11,758, up 31 from 11,727.
The separate EVM matrix is now 150 cases, up 12 from its earlier 138-case matrix.
Each token's 50 cases cover two in-process chain-ID configurations (8453 and
84532); this does not send transactions to either public network.

Token source revisions compiled with the existing Solidity 0.8.34 toolchain:

- DAT: `e0215f1a32824c19bcc89da96841e758928f4f29`
- EMA: `362db49dcc5d5db5560b71ed5acd19bba326575e`
- CAWELON: `c62f63370f7bcbe559d07b4d757384cf5f43ff0f`

The public Base Sepolia observation was made at block **49,737,620**, hash
`0x079f49a6c644b63d4dd48e80fb60564bd4c4e7ed03bfd8068b81735513c82431`.
All three registered contracts returned the expected name, symbol and 18 decimals.
DAT reported a current total supply of 999,999,998 tokens, two below the catalog's
initial supply. The probe records that difference and does not change the catalog
or infer its cause. EMA and CAWELON matched their initial-supply references.
This is one endpoint's point-in-time response, not code-identity attestation.

## Reproduce the local workflow

```powershell
$env:THREECORE_DEMO_PORT='4209'
node examples/dev-server.js --ui-test
```

Open `/test/browser/acceptance-demo/`. Use **1** to connect the three isolated test
providers and create histories, then **2** to save. Reload the page normally.
Use **3** to inspect the saved changes, and **4** to restore them. All three cards
must contain their saved history and remain disconnected with zero provider calls
in the new page. The normal application controls are available in the expandable
panel. The fixture uses a unique `threecore-test-acceptance-` database and never
reads an extension or the user's existing checkpoint database.

The test routes return 404 without `--ui-test`, reject foreign origins/frames,
and the demonstration's CSP disallows external connections. The full browser
suite is `/test/browser/`; the focused suite is `/test/browser/?suite=acceptance`.

Adjacent `wallet-testnet-acceptance-verification-20261025` evidence includes
`view-before.log`, `view-after.log`, `unit-final.log`, `http-final.log`,
`browser-final.json`, `evm-*-final.log`, `manual-reload.json`,
`reload-restore-proof.png` and `public-testnet-contracts.json`.

## Remaining real-wallet check

Use three already prepared, distinct public testnet accounts and the intended
browser wallet. Confirm the origin and permissions in the wallet's own UI.
For each token: bind the intended account and chain, read the catalog contract,
record exact units and block, save the three histories, reload, inspect/restore,
and explicitly reconnect. Verify account/chain-change invalidation and disconnect
while a read is pending. Preserve observed results and any failures before marking
this gate complete. No seed phrase, private key, transfer or signature is needed.
