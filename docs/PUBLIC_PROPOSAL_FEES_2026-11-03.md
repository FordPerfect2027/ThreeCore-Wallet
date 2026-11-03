# Source-bound public fee reads — November 3, 2026

The fee screen now accepts a saved simulation plan and explicitly requests a
simulation and fee estimate for its original canonical Base block. The original
proposal, recipient, allowance evidence, deadline and fee caps are preserved.
The returned archive can be replayed offline, rechecked at the current time and
downloaded with the original source bytes. It is a read-only development feature.

## Completed path

- Revalidate the complete proposal/quote/allowance chain before any public RPC.
- Use only the fixed Base endpoint, chain 8453, original Router call and canonical
  block hash. Reject changed chains, block headers, outputs, expired inputs and
  exceeded gas/price caps. No state overrides or fallback to another block.
- Simulate the fixed call with `eth_call`; require its two returned amounts to
  match the original quote. Estimate gas for the same call and block.
- Read `GasPriceOracle.getL1FeeUpperBound` and `getOperatorFee` at that block.
  The L1 input conservatively sizes an unsigned EIP-1559 transaction with an
  empty access list and uint64 nonce bound. No nonce or signature is obtained.
  Operator fees use the original gas limit, not merely estimated gas.
- Unknown oracle components remain unknown and block a complete fee result.
  These are block-specific estimates; the L1 estimate is not a protocol cap or
  guarantee of a future transaction's fee.
- Local HTTP requests are same-origin, bounded and cancellable, with at most
  two concurrent acquisitions. The screen only requests on an explicit click.
  Cancellation, navigation, replacing files and editing conditions suppress
  late results. Original files remain intact after a failed acquisition.

The public acquisition source limit is 512 KiB; the HTTP response remains capped
at 2 MiB. A boundary test found that the existing generic RPC string limit was
too small for a complete archive. The archive client now explicitly requests a
larger string allowance within the unchanged byte cap. Other RPC callers retain
their default string limit. Saved-data review retains its separate file limits.

## Verification and its scope

**Actual public reads:** At Base block **53,461,696**, the oracle returned an L1
upper-bound estimate of **7,968,017,949 wei** for an illustrative 400-byte unsigned
transaction and an operator estimate of **0 wei** for 500,000 gas. A separate
oracle view call estimated **48,934 gas** using the canonical block-hash selector.
This confirms oracle acquisition and selector support, not a ThreeCore swap.
Full request/response records and the block hash are in the evidence directory.

**Actual saved sources:** The historical Account 2 insufficient-balance plan and
the expired local DAT buy plan both fail with `FEE_PLAN_BLOCKED` before making
any public RPC request. No currently eligible funded user swap source was used.
Successful full public swap simulation is therefore still unverified.

**Synthetic transport and isolated evidence:** The complete reader, HTTP and
browser-client path passes with controlled RPC fixtures for three token buys
and a sell. These tests are not public-chain observations. Sixty independent
unsigned serializations using viem 2.56.6 validate the size bound over gas, fee
and nonce boundaries. Existing isolated swap evidence remains separately pinned.

**Actual browser:** The ordinary server at port 4256 imported the Account 2
blocked plan, refused acquisition and retained the source. It then imported the
isolated DAT fee record, replayed its saved result and downloaded an identical
copy. Current-time recheck correctly reported expiry and unknown components;
the second download preserves the same source plan and observation. Both
downloaded files were read from disk and replayed.

All **55 related automated tests passed**, including transport restrictions,
512 KiB input handling, cancellations, saved replay and the existing dependent
proposal/RPC clients. This is focused verification, not a new whole-release run.

Evidence: [`evidence/2026-11-03-public-proposal-fees/`](evidence/2026-11-03-public-proposal-fees/).

## Use and remaining work

Open `/proposals/fees/` on the current candidate server. Import a valid simulation
plan and select the acquisition button, or import an existing fee review for
offline inspection. The command-line equivalents are:

```text
node scripts/read-proposal-fees.js read SIMULATION_PLAN_FILE
node scripts/read-proposal-fees.js bounds 400 500000
node scripts/verify-evidence-manifest.js docs/evidence/2026-11-03-public-proposal-fees/SHA256SUMS.txt
```

The `bounds` command alone never simulates a swap. A fee result neither authenticates
its source author nor authorizes execution. Current-state refresh, policy authority
and replay protection, the final public contract configuration, deferred product
AI connection and a new integrated distribution remain. User-wallet signing,
approval transactions and broadcasts were not used. Earlier servers, user data
and sealed packages remain preserved.

Primary references: [Base fee specification](https://docs.base.org/specifications/transactions/network-fees),
[OP Stack fees](https://docs.optimism.io/op-stack/transactions/fees),
[GasPriceOracle source](https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/GasPriceOracle.sol),
[EIP-1559](https://eips.ethereum.org/EIPS/eip-1559).
The upstream source link is mutable; the actual observed calls and responses
are recorded locally instead of treating that link as an immutable deployment proof.
