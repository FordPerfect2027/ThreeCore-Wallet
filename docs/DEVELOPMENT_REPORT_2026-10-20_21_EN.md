# ThreeCore Development and Validation Report

**October 20–21, 2026 (Japan Standard Time)**

DAT, EMA, CAWELON, and ThreeCore-Wallet received implementation changes, regression tests, read-only inspection tools, and mock-wallet experiments. The development snapshot documented here is published on GitHub, with successful CI runs for all four repositories.

The verified snapshot ends at **06:21:31 JST on October 21, 2026**, after Phase 12. This report describes that snapshot; its own documentation commit and later development are not included in the figures.

## Codebase progress by repository

These are repository file counts, not the size of each deployed token contract.

| Repository | Lines added during the period | Lines deleted during the period | Total lines at the snapshot |
| --- | ---: | ---: | ---: |
| DAT | 2,687 | 2 | 4,220 |
| EMA-Draft | 2,715 | 4 | 3,333 |
| CAWELON-Draft | 2,715 | 4 | 3,332 |
| ThreeCore-Wallet | 7,357 | 0 | 7,357 |
| **Total** | **15,474** | **10** | **18,242** |

The overall net increase is **15,464 lines**. The period contains 85 first-parent main commits across the four repositories: DAT 19, EMA 20, CAWELON 20, and Wallet 26. These commit counts exclude this report's publication.

### What the line counts include

The comparison starts immediately before each repository's first main commit on October 20 and ends at the exact commits listed below. ThreeCore-Wallet was created during the period, so its starting snapshot is empty. This is a start-to-end Git diff, not a sum of repeated edits or every intermediate commit.

The counts include tracked implementation, tests, developer tools, and configuration files, including blank and comment-only lines. They exclude README/prose, docs, lockfiles, dependencies, generated/vendor/build artifacts, and files over 1 MiB under the census policy. Shared source copied into multiple repositories is counted in each repository; it is not deduplicated. Added lines can include replacements.

| Category | Added | Deleted | Total at the snapshot |
| --- | ---: | ---: | ---: |
| Implementation | 4,242 | 0 | 4,980 |
| Tests | 9,613 | 0 | 10,750 |
| Developer tools | 1,378 | 0 | 2,005 |
| Configuration | 241 | 10 | 507 |

The census also estimates **15,846 active implementation/test/tool lines** after excluding configuration and blank/comment-only lines. This is a heuristic count, not a semantic measure of executable code.

[Per-file counts, comparison bases, and snapshot SHAs](development-2026-10-20-21-lines.json) make the totals checkable. The [source census](../scripts/codebase-census.js) defines classification and exclusions. With the four sibling repositories checked out at the snapshot commits, run `npm run census` from ThreeCore-Wallet. To inspect period changes, compare each recorded base and head with `git diff --numstat --no-renames BASE HEAD`, applying the census exclusions; for the newly created Wallet, compare against an empty tree.

The 20,000-line target is a reference goal. It does not establish quality, production readiness, security, or token value.

## What changed and what was checked

### Token behavior, read-only inspections, and permit boundaries

Across DAT, EMA, and CAWELON, the work added tests for transfers, allowance behavior, balance conservation, burns, and permit authorization boundaries. Permit tests reject mismatched chain/contract/domain data, nonces, signers, and modified message fields, and check that rejected operations leave the expected state unchanged.

Read-only tools inspect token identity, balances, existing allowances, Transfer/Approval event history, and Aerodrome Classic token/USDC pool data. The history readers reject removed, pending, malformed, or inconsistent event responses. Later checks compare event block hashes with provider headers, recheck the sampled end block, and pin allowance reads to a canonical block hash.

Public Base RPC and Aerodrome Classic factory reads were exercised and recorded as historical observations. They do not establish current reserves or future trading availability. The [original read-only evidence](validation-evidence-2026-10-21.json) records the observed block and responses. Liquidity-target reporting was also added; a target does not authorize depositing funds.

Token Solidity, supply, and production deployment settings were not changed during this reporting period. Contract creation, transfers, approvals, and permit signatures in the contract tests occur only in the local simulated EVM with test accounts. They are separate from the external-site mock wallet, which produces no signatures.

### Wallet connection state and data consistency

ThreeCore-Wallet added EIP-6963 discovery and explicit provider selection for its own interface. Connection and read handling were hardened to reject stale responses after disconnect, account/chain/provider changes, or reconnection.

Composite dApp checks read code, token balance, and allowance from one canonical block hash and reject observed snapshot replacements. The UI clears obsolete results and prevents delayed responses from restoring them. Permission-loss and disconnection errors also invalidate a session when no provider event arrives.

A provider is still trusted to implement requests truthfully. These checks cannot independently prove complete event history or permanent chain canonicality.

### Unresponsive connections and permission requests

Connected reads and connection probes now have local waiting deadlines. The account-permission prompt has its own deadline. Manual disconnect settles local pending work, and late responses cannot reconnect the session automatically.

An outstanding permission request is guarded for the same provider object within the loaded module, preventing a second prompt until the original request settles. This does not cancel the underlying Wallet dialog or coordinate separate pages/provider wrappers. Browser scheduling can also delay a timer; these are local waiting limits rather than a guaranteed total connection time.

### Browser UI and local EVM integration

Browser regressions exercise the actual ThreeCore DOM using a synthetic provider in an isolated headless Chrome profile. They cover disconnection, invalidation, delayed responses, deadlines, and provider selection.

The latest three additions confirm that ThreeCore's own selector can connect without `window.ethereum`, accept a late EIP-6963 announcement, and preserve the user's selected provider when another provider appears.

Each token's local EVM integration suite contains 42 cases: 21 on simulated chain ID 8453 and 21 on simulated chain ID 84532. These chain IDs identify local test configurations; they do not mean transactions were sent to Base Mainnet or Base Sepolia.

## Official Aerodrome mock-wallet experiments

The experiments continue the original [Aerodrome mock-wallet validation commit](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/4848c39b60bac2c63fc38f685cdef12cd96290a8).

The latest probe used isolated temporary Chrome profiles without real wallet extensions or existing accounts. It injected a synthetic provider with a fictitious public account and rejected signing requests. No ThreeCore browser extension was distributed or connected in this test.

| Mock provider configuration | Observed result |
| --- | --- |
| Legacy `window.ethereum` plus EIP-6963 | The official UI requested account permission, reached Sign-in, and requested `personal_sign`. The mock rejected signing with code 4001. Synthetic permission revocation and explicit reconnection were also exercised. |
| EIP-6963 only | Discovery and an account-readiness query occurred, but no account-permission request reached the mock after waiting, rediscovery, and a second click. Connection was not established. |

The investigation combined request traces with the exact public JavaScript served by the site. In the observed build, discovered connectors are appended internally, but the displayed chooser is sliced to the number of initially configured connectors. Its Browser Wallet option uses the legacy `window.ethereum` provider. This explains why discovery alone did not lead to a selectable EIP-6963-only mock wallet.

The inspected asset was `https://aerodrome.finance/assets/index-8N6caatx.js`, SHA-256 `1ab822229f1f4b7e20c1e7b4780cceb1afca995a31d8d4ef7f3a7a4ec8a94a38`. This finding is scoped to that build and tested desktop route.

**EIP-6963-only connection on that Aerodrome interface remains unresolved.** The external site was not modified. Its chooser would need to retain discovered connectors and connect through the provider the user selects. ThreeCore's own selection tests passed, but that does not establish compatibility with every external dApp.

The [live diagnostic run](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39498715359) succeeded in completing the observations; its successful job status does **not** mean the EIP-6963-only connection passed. Neither configuration completed signed login. [Detailed discovery evidence](phase12-discovery-evidence.json) preserves the observed stages and source fingerprint.

The live-tested source commit was `1aa163c6edd128e5755f6a9245a20874d91af05c`. Its ten probe/test/workflow files were checked for exact content equality with the final Wallet development snapshot; the final snapshot additionally carries documentation, evidence, and normal-CI token pins.

## Latest verified test results

| Suite | Result |
| --- | --- |
| Wallet offline tests | 361 passed; 0 failed, 0 skipped |
| HTTP route tests | 2 passed |
| Synthetic Chrome UI tests | 21 passed |
| Wallet/token integration | 42 per token; 126 across DAT, EMA, and CAWELON |
| Token project test runner | DAT 157; EMA 159; CAWELON 159 passed |
| Separate token read-only runner | 120 per token passed |
| Local EVM history tests | 10 per token passed |
| Token compilation and type checks | Passed for all three repositories |

The token project runner includes read-only tests that are run again by the separate read-only runner. Tests are also repeated in local runs and multiple CI workflows. These overlapping executions are **not added into a grand total of independent cases**.

The final token CI runs test each token snapshot against Wallet `bb8cd3c`. The Wallet CI matrix pins the preceding Phase 11 token versions; the subsequent token Phase 12 changes contain only workflow pins and documentation. This keeps the tested implementation relationship explicit.

### Published development snapshots and successful CI evidence

| Repository | Development snapshot | CI result |
| --- | --- | --- |
| DAT | [5ccb341](https://github.com/FordPrefect2026/DAT/commit/5ccb3419129dccb0bd5e1506eb464b1a38768e26) | [Success](https://github.com/FordPrefect2026/DAT/actions/runs/39499670830) |
| EMA-Draft | [2ccab13](https://github.com/FordPrefect2026/EMA-Draft/commit/2ccab1335aa60502fda210e582aef7e06c3a9c6a) | [Success](https://github.com/FordPrefect2026/EMA-Draft/actions/runs/39499685930) |
| CAWELON-Draft | [171a6c9](https://github.com/FordPrefect2026/CAWELON-Draft/commit/171a6c9f4476f9412027e857dde1fef1017eb8c4) | [Success](https://github.com/FordPrefect2026/CAWELON-Draft/actions/runs/39499702005) |
| ThreeCore-Wallet | [bb8cd3c](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/bb8cd3c8ef76de6cf6b5effc7daed10234e13276) | [Success](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39499276746) |

The [machine-readable validation summary](development-2026-10-20-21-validation.json) includes job-level test-count excerpts, run IDs, the exact commits, and live-probe outcomes. At verification, each local checkout matched its published main and had no uncommitted changes.

## Remaining limits and boundaries

- Real-wallet connection behavior, completed signature login, WalletConnect, Coinbase/Binance extensions, and other dApps remain unverified.
- No real-wallet signatures, trades, transfers, token approvals, LP additions, or production deployments were performed in this work.
- No game development was performed.
- No independent security audit or production-readiness certification is claimed. Automated checks cover specific behavior; they do not prove universal compatibility or guarantee funds safety.
- The official Aerodrome interface may change after the recorded observation. Its EIP-6963-only route still requires external-site changes.

The development record is intended to make completed work, reproducible evidence, and remaining gaps visible together.
