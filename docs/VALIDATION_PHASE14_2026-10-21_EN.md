# Phase 14 — Provider error recovery and disconnect cleanup

Date: October 21, 2026 (JST)

## Outcome

ThreeCore's connection and read UI now handles malformed provider rejections without getting stuck in a busy state. Failed reads remove old balances; explicit reconnection or another read can recover when the provider becomes available. A throwing listener-cleanup accessor cannot prevent local disconnection or leave the card displaying an old result.

This phase addresses ThreeCore's own adapter and demo. The official Aerodrome probe was not rerun. Its previously observed EIP-6963-only connection limitation remains unresolved; see [Phase 12](VALIDATION_PHASE12_2026-10-21.md). The mock-wallet lineage starting at `4848c39b60bac2c63fc38f685cdef12cd96290a8` is retained.

## Starting state

All four local checkouts were clean and matched the current GitHub main. The previous Phase 13 results were 377 Wallet cases, 24 synthetic Chrome cases and 44 integration cases per token, with successful main CI.

| Repository | Starting main |
| --- | --- |
| DAT | `58bcb6ea4a454d12ae97690fd3dc6222af95f9d0` |
| EMA-Draft | `bbfaf8afea0b3023c6abc4a7bfbe50b28367d758` |
| CAWELON-Draft | `eb375e8ea547908bc418d091e1ac7592eb70bd96` |
| ThreeCore-Wallet | `041a0bf1749262e3987d2428793baedbaece7b35` |

## Reproduction and correction

The UI previously assumed every rejected value had readable `code` and `message` properties. Null/undefined rejections could throw inside the catch handler, leaving the card busy. Throwing getters and revoked proxies could similarly replace the original rejection or escape error handling. The session also inspected `removeListener` outside its cleanup exception boundary, so a failing accessor could interrupt the visible disconnect.

The new `test/error-boundaries.test.js` reproduced **17 failures out of 25 cases** against the starting implementation. All 25 pass after correction.

- Inspect code/message independently and accept primitive fields without coercing foreign objects. Use a visible fallback when no readable message is available.
- Preserve the original provider rejection at the session API when the connection is still current. Numeric codes 4100, 4900 and 4901 still invalidate access; a string such as `"4900"` remains distinct. Internal read timeouts still disconnect.
- Recheck current state after inspecting provider-owned properties. An error getter that disconnects the card cannot restore a connected view.
- Read the cleanup method inside an exception boundary, preserve its provider receiver, and invalidate local state before attempting cleanup. Old callbacks remain inert even when the extension cannot remove them.
- Serve the shared error helper through the demo's explicit route allowlist and check its JavaScript content type. Keep browser fixtures restricted to the test mode.

## Validation

| Check | Result |
| --- | --- |
| New error-boundary suite before correction | 25 cases: 17 failed, 8 passed |
| Same suite after correction | 25 passed |
| Full local Wallet suite | 402 passed; no failures or skips |
| DAT local EVM integration | 46 passed |
| EMA local EVM integration | 46 passed |
| CAWELON local EVM integration | 46 passed |
| Corrected candidate: synthetic Chrome UI | 27 passed |
| Corrected candidate: HTTP routes and fixture isolation | 2 passed |

Each token has 23 cases on each simulated chain ID, 8453 and 84532: **46 per token, 138 total**. The added case reads the deployed local token, injects a null rejection during the next token read, confirms that stale balances disappear, and retries successfully. It checks unchanged block height, transaction count, supply, token balance, allowance and permit nonce, with no extra permission request. No remote fork is used.

Three new browser cases exercise permission rejection followed by reconnection, unreadable error properties followed by a successful read, and throwing cleanup followed by reconnection. They use synthetic providers in an isolated Chrome profile, with extensions disabled and no external RPC.

The release candidate is [`e953863d2ea84238bd990e5fa7c434c927de3f59`](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/e953863d2ea84238bd990e5fa7c434c927de3f59). [Its CI run](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39509494732) passed all four jobs. Before main publication, all ten tested implementation, test and workflow files are compared exactly with the release contents; only README and documentation/evidence are added. [Machine-readable evidence](phase14-validation-evidence.json) records job steps and result excerpts. Final main runs are available in each repository's Actions history.

Two earlier candidates did not pass. [The first](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39509040885) exposed a missing HTTP route for the new helper; the route and HTTP coverage were corrected. [The next](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39509195118) reached Chrome's 45-second wall-clock limit without a usable progress log. Its cause remains undetermined. Per-case browser diagnostics were added, and the subsequent candidate passed without increasing that deadline. This does not establish that the intermittent timeout's underlying cause is fixed.

The current source-count scope totals **18,759 physical lines**: DAT 4,220; EMA-Draft 3,333; CAWELON-Draft 3,332; Wallet 7,874. This includes implementation, tests, tools, configuration, comments and blank lines; documentation, dependencies, lockfiles and generated files are excluded. Shared code is counted in each repository. The 20,000-line reference target is not a quality or completion measure.

## Scope and remaining limits

Token contract code, supply, deployment settings and history implementation are unchanged. Each token's CI update pins the published Wallet revision and runs its own compilation, project tests, type checks and the 46-case integration suite. The Wallet matrix additionally runs 120 read-only cases and 10 history cases per token. Repeated executions and overlapping runners must not be summed as independent tests.

An unreadable error code cannot establish that the provider disconnected; an unknown/non-terminal error therefore allows an explicit read retry. Subsequent reads still validate the account and chain, and existing deadlines remain enforced. These exception boundaries do not sandbox same-page JavaScript, stop a non-returning synchronous getter, or guarantee that a broken extension physically removes its listeners.

No real-wallet signing, trading, transfers, approvals, liquidity additions, production deployments or game development were performed. Existing in-process EVM fixtures use simulated contracts and simulated state only.

Real extension compatibility, WalletConnect, completed signed login on an external site and an independent security audit remain unverified. The earlier [English development report](DEVELOPMENT_REPORT_2026-10-20_21_EN.md) retains its historical snapshot and line counts.

## Reproduction

```sh
# ThreeCore-Wallet
npm test
npm run test:demo-server
npm run test:browser-ui # Linux with Chrome; synthetic provider only

# Each compiled sibling token repository, using its locked dependencies
node --test ../ThreeCore-Wallet/integration/token-compatibility.test.mjs
```
