# Proposal and existing allowance integration — November 3, 2026

The new `/proposals/allowance/` screen takes a saved proposal/quote review and
reads the existing Aerodrome Classic Router allowance at its exact block. Buy
proposals use native Base USDC; sell proposals use the corresponding DAT, EMA or
CAWELON contract. The account, token and Router come from validated sources;
there are no editable RPC, spender or transaction fields.

## Completed behavior

- Nine public RPC reads pin state by canonical block hash and recheck both the
  header and chain. Missing token code produces unknown amounts, never zero.
- The comparison re-evaluates the original proposal and quote at the current
  time without extending their deadlines. It binds account, agent, direction,
  token, spender, block number/hash/timestamp, observed balances and allowance.
- Required, existing and missing amounts retain integer precision, including
  USDC's six decimals. A missing allowance does not grant a new one.
- A single saved file includes the exact original proposal/quote text, the
  observation with SHA-256, limits, comparison time and result. Reopening
  recomputes the recorded result before offering a current-time recheck.
- File replacement, edits, cancellation and page exit invalidate pending work.
  The same-origin read endpoint bounds body size, deadlines and concurrency.

## Verification

The 13 feature/HTTP checks passed. The overlapping regression run passed 47/47;
these totals are not added. Coverage includes all three USDC buy contexts and
DAT sell, uint256 precision, shortages, unknown code, wrong account/block/state,
future/stale time, archive tampering, cancellation, and HTTP restrictions.

Actual browser operation used ordinary server port 4254. A synthetic 1 USDC
proposal with 1 USDC allowance passed and was downloaded. Separately, the
existing Account 2 source was read from the public RPC at block 53,457,078:

- account: `0xcfae42798e867968c60fedf38d7ee401120072c8`
- block hash: `0xe60495e68f89e6bf1dc9d70baadf368aa30027864b71dcbdf57b8c78f0ad656a`
- native USDC allowance to Classic Router: 0
- balance: 0 USDC and 0.0007 ETH
- illustrative proposal amount: 1 USDC; recorded allowance shortfall: 1 USDC

The real-source comparison correctly retained the original budget/quote failures
and reported allowance/balance shortages. It was downloaded, reopened,
rechecked and saved again. Three actual downloads were verified on disk, with
unchanged original sources and observations across the recheck.

Evidence and the independent replay script are in
[`evidence/2026-11-03-proposal-allowance/`](evidence/2026-11-03-proposal-allowance/).
Run `node docs/evidence/2026-11-03-proposal-allowance/verify-browser-files.mjs`
on the original workstation to recheck downloads. Saved result files can also
be opened directly in the new screen without the workstation script.

## Remaining scope

This completes the saved-proposal-to-existing-allowance workflow, including its
public reader and browser handoff. It does not authenticate proposal authority,
estimate transaction gas, simulate execution or authorize a transaction. Source
checksums detect changes, not maliciously authored evidence. The next work is
transaction-specific fee/preflight and isolated execution integration. The whole
project is not declared 90% complete, and AI connection remains deferred at the
user's request. No GitHub publication or user-wallet transaction occurred.
