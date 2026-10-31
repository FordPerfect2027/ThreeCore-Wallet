# Wallet task navigation

Continuation item 401. Final source revision `9255bfc`.

The wallet now offers a labelled navigation menu with 12 links to connection and balances, account setup, token identity, allowances, saved transfers, historical periods, saved periods, period reports, saved reports, report comparison, reconciliation and protection status. Each link moves keyboard focus to the existing section without requesting a wallet operation. Existing IDs are retained, and disposal removes the navigation and restores the section attributes.

## Validation

- Browser runtime and demo/file server integration: **58 passed**, zero failed/skipped/cancelled; **1,407.5651 ms**, before the formatting-only restoration.
- Native Chrome with the final source: **846 passed**, including real focus movement through all 12 destinations with no wallet requests.
- The first implementation accidentally normalized mixed line endings. A separate correction restored original line endings; the net feature diff is 34 added lines. Both successful native runs are retained. Formatting and reruns do not add development items.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-wallet-navigation/`.

The ledger is **401 / 600**. The most recent full-wallet checkpoint remains item 396 at `4d4329b`: 14,415 tests and 843 native cases. This navigation batch has the integration and final native checks above. Synthetic local data only; no real signatures, transactions, approvals, keys, external RPC, publication, deployment or existing-server restart.
