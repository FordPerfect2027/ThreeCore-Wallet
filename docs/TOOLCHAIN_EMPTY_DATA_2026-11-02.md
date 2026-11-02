# Empty RPC data preserved in the token development toolchain

The previous installed Hardhat decoder converted `0x` to `[0]`, making empty
data indistinguishable from `0x00`. The corrected local token candidates return
`[]` for `0x`, `[0]` for `0x00`, and preserve `0x0100` exactly. Malformed data is
still rejected. This fixes development tooling; no deployed token was changed.

The pure [before](evidence/2026-11-02-toolchain-empty-data/baseline-pure-probe.json)
and [after](evidence/2026-11-02-toolchain-empty-data/corrected-pure-probe.json)
probes load only conversion helpers, with no configuration, wallet, EVM or RPC.
Upstream [fix #8765](https://github.com/NomicFoundation/hardhat/pull/8765) and
[follow-up #8790](https://github.com/NomicFoundation/hardhat/issues/8790) explain
the empty-data bug and the possibility of retaining old helpers through a lock.

## Repair and failure retained

Hardhat 3.21.2, keystore 3.1.2, node-test-runner 3.1.2 and viem-plugin 3.1.0 are
pinned with hardhat-utils 5.1.1 and hardhat-zod-utils 3.0.8. The first upgrade
retained old helpers and failed the regression. Its test, log, lock and dependency
graph remain in the evidence directory. The corrected override/lock resolves
the helper used by Hardhat itself. The final regression resolves from that
consumer so a different root-level copy cannot hide a stale nested decoder.

Undici 6.29.1 and 7.30.1 overrides apply within their respective major ranges.
The runtime OpenZeppelin/viem dependencies, contract sources and solc 0.8.34 are
unchanged. All three fresh builds have identical ABI, creation bytecode and
runtime bytecode to their exact parent artifacts. Only `buildInfoId` differs;
full artifact-file hashes therefore differ. See the
[field comparisons](evidence/2026-11-02-toolchain-empty-data/artifact-comparisons.json).

## Local validation

| Token | Local revision | Source/routing | Pure decoder | Contract | Read-only | Local history | Wallet compatibility |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DAT | `47d8aa9db72e54e49fc9521f9b4022c416a7c6d1` | 7 | 2 | 37 | 251 | 10 | 50 |
| EMA | `5d36704ec1a5f5fb89febd7f414eee9fe41fd3ac` | 7 | 2 | 39 | 227 | 10 | 50 |
| CAWELON | `4af9e1db98cac546e498b6f34531ba890cc2e3c0` | 7 | 2 | 39 | 227 | 10 | 50 |

All listed cases passed. Compilation and type checking also passed. DAT ran
each standard-check component separately; EMA and CAWELON completed
`npm run check`. The final decoder-resolution refinement was then rerun for
all three. Wallet compatibility uses source
`ed32d7cd2593f8fc73b5a46ac27b6b1b2454d6c2`, on both simulated chain IDs 8453 and
84532. These are overlapping validation categories, not features or a percentage.

The three token sources shared one installed dependency directory. An additional
initially empty installation reproduced the corrected lock with the command below
and passed the final decoder regression:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

it reused the npm cache. This is Windows/Node 24.19.0 evidence, not three separate
installations or a Linux CI run. The four saved-data workflow checks, including
source reconstruction, also passed with the new DAT toolchain. They used recorded
observations and do not constitute fresh public-network checks.

The prepared Wallet workflow now pins these token revisions and runs the decoder
regression before compilation. The token commits must be published before that
workflow is published. No GitHub write or remote CI run was performed.

## Reproduce and inspect

From each pinned token checkout, install the lock and run `npm run check`.
To exercise Wallet compatibility after compilation, with the Wallet checkout
in a sibling directory named `wallet`, run from the token checkout:

```sh
node --test ../wallet/integration/token-compatibility.test.mjs
```

The local EVM suites include synthetic fixture transactions and signatures.
They do not access the user's wallet, keys or seed, or submit public transactions.

[Results and exact snapshots](evidence/2026-11-02-toolchain-empty-data/results.json),
original logs, source patches and the failed first attempt are covered by
[SHA-256 checksums](evidence/2026-11-02-toolchain-empty-data/SHA256SUMS.txt).
The retained orchestration scripts describe the local experiment; the ordinary
token commands above are the portable reproduction path.

This repair does **not** close the separate Zod advisory GHSA-mrhx-c7xc-m3w5:
the audit still reports six affected package entries from one root advisory.
Zod remains 3.25.76. Live-wallet switching, native file-picker traversal,
independent review and explicit release approval remain separate open items.
