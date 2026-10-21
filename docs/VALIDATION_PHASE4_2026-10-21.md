# Consistent block reads — 2026-10-21

## Result

- Wallet: **179 tests passed**, no failures or skipped tests.
- Local token–Wallet integration: **22 tests per token**, **66 total**, no failures or skipped tests.
- Before implementation, the new 16-case block suite had 15 failures and one pass. This included both observable mixed-block behavior and missing new API support; it does not represent 15 distinct security vulnerabilities.

## Behavior

The composite dApp preflight previously read each contract/balance/allowance at `latest`. A new block could change state between these reads. It now captures `eth_getBlockByNumber("latest", false)` and sends an EIP-1898 `{ blockHash, requireCanonical: true }` selector with every state read. A final header lookup at the original height must return the same number and hash.

The report includes a decimal-string `blockNumber` and lowercase `blockHash`. Invalid headers, missing state, a changed canonical block and disconnected/reconnected sessions discard the report. Unsupported selectors propagate the provider error; there is no automatic downgrade or retry against `latest`.

The header request is guarded by the same connection epoch as existing reads. A delayed header from an old connection cannot satisfy or invalidate a new connection. Hashes are validated before issuing reads, and copied/frozen header data prevents a custom adapter from mutating the captured snapshot.

## Evidence

Offline cases cover head advancement, final-height replacement, initial/final missing headers, malformed numbers and hashes, genesis, uint256 number precision, case normalization, unavailable/noncanonical state, unsupported hash selectors, explicit ETH/ERC-20/code reads, invalid caller selectors, stale header responses and reconnection at both header boundaries.

For every token, on each in-process simulated chain ID (8453 and 84532):

1. A fixture transfers three raw units and changes allowance from 9 to 17 after the first preflight state read. The report still returns the original balance and allowance 9 at the captured hash, while direct local EVM reads confirm the newer state.
2. A fixture snapshots the local chain, creates an approval block, then rolls back and replaces that block during preflight. The inspection rejects the removed snapshot without a fallback. A fresh inspection succeeds with the replacement allowance 11.

All 18 previous integration cases per token remain passing. The bridge allows only account simulation, chain/header reads, bytecode/native-balance reads and the expected token balanceOf/allowance calls. Fixture writes use local Hardhat accounts and cannot be requested through the Wallet bridge.

## Reproduce and CI baselines

From a compiled token checkout, run:

```sh
node --test ../ThreeCore-Wallet/integration/token-compatibility.test.mjs
```

From Wallet, run `npm test`. Follow the phase 3 setup instructions for locked token dependencies and compilation.

Wallet CI compiles pinned token baselines `DAT@1c4b99bf709514fb36a7bc1acf473fd38cd01eb6`, `EMA-Draft@cb82fc0815a81123a213b9549c0a93c4c45ac23d`, and `CAWELON-Draft@7de3673efdc4f426f5fbdfbb6164b0c405674cc9`. Token CI also pins the updated Wallet suite for future token changes.

## Compatibility and limits

- Custom sessions must expose `getBlockSnapshot` and honor the optional block hash on all state-read methods. Existing custom implementations that ignore the hash do not meet this contract.
- Individual session reads still default to `latest` when no hash is supplied. The composite preflight pins automatically.
- The implementation follows [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898). Truthful RPC responses and correct selector/canonicality handling remain provider trust assumptions. Rechecking does not provide finality or guarantee that the block remains canonical after the report is returned.
- Real browser-wallet/provider support for these hash selectors has not been exercised. Providers without support will fail the preflight safely.
- No real-wallet signature, transfer, approval, trade or LP action was performed. Local fixture operations have no production effect.
- The official Aerodrome synthetic-wallet probe inherited from `4848c39b60bac2c63fc38f685cdef12cd96290a8` was not rerun. Completed sign-in and full external-dApp compatibility remain unverified.
- These results do not constitute an independent security audit. No game development or line-count padding was undertaken.
