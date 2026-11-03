# USDC spending budgets and saved public balances

USDC-funded buy proposals can now use the existing budget, saved-source,
proposal and Aerodrome quote comparison flow. The separate
`threecore.usdc-operation-budget.v1` format means Base Mainnet native USDC
with six decimal places. Earlier token-budget files retain their original
DAT/EMA/CAWELON meaning. This feature does not execute transactions.

## Completed behavior

- Individual budgets separate USDC principal from ETH costs and reserves.
- Shared-account budgets add all USDC spending and count common reserves once.
  Conflicting USDC balances/reserves are rejected. Distinct project-token
  holdings remain separate; mixed USDC/project budgets are supported.
- A bounded public reader fixes the Base RPC and native USDC contract, reads
  metadata, USDC and ETH at one canonical block hash, then rechecks hash and chain.
  Explicit heights never fall back to latest. Cancellation and deadlines apply.
- Checksum-bound source files can populate a preview in `/budget/`. Applying a
  preview changes only balances and precision, preserving requested spending,
  reserves and fee assumptions. Asset/network changes invalidate old previews.
- `/budget/shared/` shows combined USDC insufficiency. `/budget/evidence/`
  accepts one USDC source for all matching budgets and preserves that source.
- USDC-funded buy proposals bind account, chain, input token, amount, budget,
  original source block and quote limits through the existing review flow.

Native USDC address reference: [Circle's official contract table](https://developers.circle.com/stablecoins/usdc-contract-addresses),
Base Mainnet `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

## Verification

`docs/evidence/2026-11-03-usdc-budget/` contains the original inputs, public
acquisition trace, browser returns, screenshots and test output.

- Initial core checks: 8 passed; related regression: 132 passed.
- Final focused feature/UI/CLI checks: 43 passed; HTTP integration: 7 passed.
  These suites overlap and must not be added together as unique cases.
- Actual public Account 2 at block **53,457,078**, hash
  `0xe60495e68f89e6bf1dc9d70baadf368aa30027864b71dcbdf57b8c78f0ad656a`:
  **0 USDC**, **0.0007 ETH**. Eleven read-only requests, no wallet connection.
  The budget agrees with the source but fails its example spending/reserve
  assumptions; consistency is not sufficiency.
- Actual browser source preview/apply and individual budget download matched
  the prepared input exactly. Original-source evidence export matched exactly.
- With explicitly synthetic balances of 10 USDC, three 4-USDC plans each pass
  individually but require 14 USDC including shared reserves: **4 USDC short**.
  Browser export, reimport, recalculation and reexport preserved exact bytes.
- A synthetic full proposal plus buy quote passes; altered source block fails.
  This is separate from public balance observations and is not a live trade.

Reader: `node scripts/public-usdc.js read PUBLIC_ACCOUNT [BLOCK_NUMBER]`.
Saved-file verification: `node scripts/public-usdc.js verify SAVED_FILE`.
At this checkpoint acquisition is available through the command; budget and
saved-source comparison are available through the browser. A public USDC
acquisition screen is the next short implementation step.

Checksums protect recorded bytes, not the identity of their author. Fee inputs
remain assumptions, and allowance/fee preflight and isolated execution are not
finished. Base Sepolia USDC is outside this feature. No secrets, signatures,
transfers or approval transactions were used. Existing servers and packages
remain unchanged; this work is local and is not in the sealed cd7f7ed package.
