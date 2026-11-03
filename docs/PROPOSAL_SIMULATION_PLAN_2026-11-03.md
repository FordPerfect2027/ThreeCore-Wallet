# Fixed proposal inputs for simulation — November 3, 2026

`src/proposal-simulation-plan.js` derives a reproducible unsigned Classic Router
call from the complete saved budget/proposal/quote/allowance chain. It rechecks
the source at the current time before making call data available. Failed
conditions leave `call: null` and retain the reasons.

The recipient is the source account. The single volatile route, factory, token
pair, input amount and minimum output come from the validated quote. The
deadline is the earliest of the proposal/policy expiry, quote age, block age and
allowance age boundaries; reopening a file cannot extend it. Original fee
budgets remain separate fields for the later cost comparison. There is no nonce,
signature, account request or broadcast function.

Offline commands:

```text
node scripts/proposal-simulation-plan.js prepare ALLOWANCE_REVIEW_FILE
node scripts/proposal-simulation-plan.js verify SIMULATION_PLAN_FILE
```

Preparation exits 0 for an eligible simulation input, 2 for a valid but blocked
plan, and 1 for an input/error failure. Verification replays the recorded time,
not the current chain. A consumer must prepare/recheck again before simulation.

## Evidence

The five feature checks and overlapping 27-case regression passed. They cover
fixed recipients/limits, three USDC buy contexts plus DAT sell, expiry,
insufficiency, shared-source agent selection, archive changes, cancellation and
offline command behavior. A missing agent budget is an explicit blocked result.

The pinned [official IRouter interface](https://raw.githubusercontent.com/aerodrome-finance/contracts/1ba30815bba620f7e9faa34769ffd00c214c9b82/contracts/interfaces/IRouter.sol)
was fetched and verified against its prior SHA-256. The independent installed
viem 2.56.6 encoder/decoder produced the identical 324-byte call in all four
synthetic examples. The historical Account 2 allowance file produced a blocked
plan, with no call data. Source files, recorded plans and verification are in
[`evidence/2026-11-03-proposal-simulation-plan/`](evidence/2026-11-03-proposal-simulation-plan/).

## Remaining work

This step fixes simulation inputs; it does not yet estimate gas or execute an
EVM simulation. Base's [official fee documentation](https://docs.base.org/specifications/transactions/network-fees)
describes L2 execution, L1 publication and operator components. The next work
must estimate those components for the fixed call and compare them with the
source budgets. Existing isolated Hardhat environments are available for
controlled execution tests without a public fork or user keys. A mock Router
test must be labeled separately from the deployed Aerodrome behavior.

The whole-project estimate remains around 70%; this foundation is not a claim
of 90%, a working product AI connection, transaction authority or mainnet
readiness. GitHub publication remains deferred.
