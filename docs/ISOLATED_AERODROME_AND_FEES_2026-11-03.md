# Isolated Aerodrome execution and fee review — November 3, 2026

The saved proposal → quote → allowance → fixed-call chain now reaches a real
local EVM execution using pinned Aerodrome contracts and the three project token
artifacts. The new fee comparison model, command and `/proposals/fees/` screen
retain the original budgets and reject missing fee components, mismatches,
expiry and excess costs. This completes a controlled integration and a saved
fee-review workflow; a public-chain fee acquisition adapter is still needed.

## Execution evidence

The final run used Hardhat `edr-simulated / hardhatOp`, chain ID 8453, without a
public fork. It deployed the actual pinned Router, Pool implementation,
PoolFactory and FactoryRegistry, plus the existing DAT, EMA and CAWELON build
artifacts. USDC is a local six-decimal ERC20 fixture with compatible metadata,
not Circle's deployed USDC contract. Each pool received synthetic liquidity:
2,000,000 project tokens and 100 fixture USDC. The disposable simulator holder
bought with 1 USDC and sold 50 project tokens. Each case starts from a restored
snapshot; the six cases do not share cumulative spending.

| Case, for each of DAT / EMA / CAWELON | Estimated gas | Used gas | Actual output |
| --- | ---: | ---: | ---: |
| Buy with 1 fixture USDC | 262,298 | 247,779 | 19,743.160687941225977009 project tokens |
| Sell 50 project tokens | 261,231 | 246,772 | 0.002492 fixture USDC |

All six simulations returned the Pool/Router quote, left chain state unchanged,
then completed a separate local transaction. Exact input/output/allowance
changes, total supplies, holder nonce and gas consumption were checked. For
each case, minimum output above the quote, expired deadline, revoked allowance
and paused factory caused the intended EVM rejection, without simulation state
changes: 24 negative controls across the six cases. These are not 30 distinct
product features or a percentage denominator.

The fixture builds the production source chain from local observations and
maps its addresses to the fixed public-address schema. The runtime independently
decodes the production call, verifies its amount, recipient, route and deadline,
then substitutes the actual local deployment addresses for execution. Every
record includes both calls and this mapping. Fixture labels explicitly say
that they are not public observations. No user wallet, user key or public-chain
write was used. The filtered environment and network guard recorded zero
network attempts during execution. Upstream source acquisition happened first,
outside that isolated execution.

Pinned dependencies:

- Aerodrome contracts `1ba30815bba620f7e9faa34769ffd00c214c9b82`.
- Its OpenZeppelin dependency `7b3e7b7055d6e1226d4920ca7d7c446c0c0bfff5`.
- Solidity `0.8.19+commit.7dd6d404`, compiler SHA-256
  `e0b74e0a16e783a35169f74d1a615ecb48d07c30f97346b83cd587949268681e`.
- Compiled artifact bundle SHA-256
  `435d5fd98400d7df5b5d28832f629ddcd2b9477cde2fb12ec6058f0dcc13e0d8`.

The source manifest preserves all 35 upstream source URLs and hashes plus the
original Aerodrome GPL/MIT and OpenZeppelin MIT license texts. Third-party
sources retain those licenses. The exact token revisions and artifact hashes
are in `execution-summary.json`; saved artifact copies are included. The
compiler binary remains in the original Downloads run directory and can be
retrieved from the manifest URL with the fixed hash.

## Fee correction and remaining acquisition

An added check initially assumed the holder's ETH debit equalled
`gasUsed × effectiveGasPrice`. It failed. The raw OP receipt exposes `l1Fee`
and operator parameters that the generic viem receipt did not expose. The final
run verifies, in all six cases:

`holder ETH debit = L2 execution charge + raw receipt L1 fee`.

Both operator parameters are explicitly zero in this simulation profile. Other
profiles are not silently treated as zero. The original failed log is retained.
This confirms the local post-execution breakdown, not a Base mainnet fee bound.

`src/proposal-fee-review.js` separately compares **pre-execution observations**
with the exact saved simulation-plan bytes, canonical block, original gas cap,
gas price cap, L1/operator budgets and total policy ceiling. BigInt preserves
integer amounts. The L2 ceiling uses the configured price cap. The total includes
the original buffer. Unknown L1 or operator bounds leave the total `null` and
the comparison blocked. The local run's pre-execution fee files correctly retain
both unknown components; later receipt values are not passed off as prior estimates.

The source environment is always shown. File hashes and replay verify internal
consistency, not the author's identity or current chain state. A complete
supplied synthetic estimate can pass the budget comparison but never authorizes
a transaction. Recorded replay uses recorded time; current recheck applies
current time without extending the original proposal deadline.

## Commands and screen

```text
node scripts/prepare-local-aerodrome.js NEW_DIRECTORY
node scripts/compile-local-aerodrome.js PREPARED_DIRECTORY DAT_TOOLCHAIN_DIRECTORY
node scripts/run-local-aerodrome-simulation.js PREPARED_DIRECTORY DAT_TOOLCHAIN_DIRECTORY
node scripts/verify-local-aerodrome-evidence.js docs/evidence/2026-11-03-isolated-aerodrome

node scripts/proposal-fee-review.js prepare SIMULATION_PLAN_FILE FEE_OBSERVATION_FILE
node scripts/proposal-fee-review.js verify FEE_REVIEW_FILE
```

The run command uses the existing three clean token checkouts listed in the
token preflight record. Reproduction needs those matching toolchains/artifacts;
the evidence replay command itself needs only this repository and Node. Each
new run requires a new output directory. Previous results and failed runs are
preserved. Fee preparation exits 0 for a complete passing comparison, 2 for a
valid blocked comparison, and 1 for invalid input or an error.

The screen accepts one complete fee-review archive or a simulation plan plus
fee observation. It displays saved versus current-time results separately,
keeps unknown costs visible, supports cancellation and saves the full sources.
Changing comparison settings invalidates an old result even if the control
changed without an input event. Leaving the page discards pending work.

Verification:

- 39 related automated checks passed, including 6 fee-model/command checks and
  4 screen behavior checks, plus existing proposal/allowance/server coverage.
- Actual app browser at port 4255 imported the final DAT buy fee archive,
  displayed the local environment and unknown total, exported an identical copy,
  then rechecked expiry and exported the new result. Both downloaded files were
  read from disk and replayed. Original plan and observation remain unchanged.
- Screenshot, complete outputs, failure log, source inventory and checksums are
  in [`evidence/2026-11-03-isolated-aerodrome/`](evidence/2026-11-03-isolated-aerodrome/).

## Open scope

Still required: production public fee bounds for the fixed call, fresh-state
simulation and state-change handling; authenticated spending conditions and
replay protection; final deployed-contract configuration; the deferred product
AI connection; and a new integrated distribution including these changes. The
local Router source pin is not a proof of equivalence with deployed public code.
Placeholder Voter/rewards/WETH constructor roles are not exercised by these
ERC20 volatile swaps. Gauges, stable pools, ETH routes and public execution are
outside this result. Existing original servers, loaded Wallet data and prior
sealed ZIPs are preserved. GitHub publication remains deferred.
