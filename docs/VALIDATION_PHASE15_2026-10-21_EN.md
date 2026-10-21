# Phase 15 — Browser validation that detects unexpected errors

Date: October 21, 2026 (JST)

## Outcome

The synthetic browser suite now fails if the page reports an uncaught exception or an unhandled Promise rejection, even when all individual UI assertions pass. Two intentional fault controls verify that detection, and CI requires three consecutive normal runs with a fresh Chrome profile each time.

This phase strengthens validation. Wallet runtime behavior and token contracts are unchanged. The single Chrome timeout observed in Phase 14 was not reproduced; its underlying cause remains undetermined. The new checks do not prove that the timeout has been fixed.

## Starting state

All four local repositories were clean, their HEADs matched GitHub main, and their previous main CI runs had succeeded.

| Repository | Starting main |
| --- | --- |
| DAT | `5c1a77a0cd6b83080ea368f74b5cbd4cd079544d` |
| EMA-Draft | `725710dcc1a5010b597fe8d4ffa3ebd89b90d3c4` |
| CAWELON-Draft | `f3c88348d2a9ed545732b8c5a18d3b0dfebe99df` |
| ThreeCore-Wallet | `6ad394223f24b3e0a299a5ceca05fe9a2acbe825` |

## Investigation and reproduction

First, the existing browser suite ran three consecutive times in fresh profiles. All 27 cases passed in each run: [baseline CI](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39510279188). This provides a bounded stability observation, not proof that an intermittent failure is absent.

The investigation then found a separate verification gap: the browser result counted exceptions caught by each test, but did not include page-level `error` or `unhandledrejection` events. A timer callback throwing an exception, or a rejected Promise without a handler, could leave the suite marked successful.

Two intentional fault controls reproduced that gap in [the pre-fix validation run](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39510677814). Both pages still reported 27 passing UI cases and no recorded unexpected errors, so both new controls correctly failed the validation job. This was a test-system defect; it does not establish that previous Wallet runs actually contained those unexpected errors.

## Changes

- Record uncaught page errors and unhandled Promise rejections during the synthetic suite. Include them in the final status and diagnostic output.
- Allow the browser an event-loop turn to report pending unhandled rejections before marking completion, and update the status if a later error is observed.
- Validate the actual body summary: expected case count, passed/failed counts, unexpected-error count and error kind. A success-like string elsewhere in fixture content is insufficient.
- Run two explicit negative controls. Each must execute its injected fault, complete all 27 UI cases, and report exactly one unexpected error of the intended kind with an overall failed page status. An unrelated browser crash, timeout or failed UI assertion cannot satisfy a control.
- Require three consecutive normal runs, using a new isolated profile each time. A failing attempt fails the CI step; this is not a retry-until-success policy.
- Extend HTTP checks to ensure fault-control URLs are unavailable in normal demo mode.

The existing 45-second wall-clock deadline and 240-second virtual-time budget are unchanged. No dependencies, wallet permissions, signing methods or transaction methods were added.

## Verified candidate results

| Check | Result |
| --- | --- |
| Full Wallet suite, local and candidate CI | 402 passed |
| HTTP routes and fixture isolation | 2 passed |
| Intentional uncaught-exception control | Correctly rejected |
| Intentional unhandled-rejection control | Correctly rejected |
| Normal synthetic Chrome suite | 27 cases passed in each of 3 consecutive runs |
| DAT / EMA / CAWELON integration | 46 passed per token; 138 total |
| Token read-only checks in the Wallet matrix | 120 passed per token |
| Token history EVM checks in the Wallet matrix | 10 passed per token |

Candidate [`b4ca74b82c1c4538108cb8691698d1e7af317724`](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/b4ca74b82c1c4538108cb8691698d1e7af317724) passed [all four CI jobs](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39511016194). The four tested workflow/test/runner files are compared exactly with the main release contents before publication. Only README and report/evidence files are added. [Machine-readable evidence](phase15-validation-evidence.json) records the reproduction and candidate logs. Final main runs are available in each repository's Actions history.

The browser still has **27 distinct UI cases**. Repeating them three times or running them under a negative control does not create additional independent cases. The token integration suite also remains at 46 cases per token, across simulated chain IDs 8453 and 84532 without a remote fork. Token CI pins the published Wallet revision and retains compilation, project tests, type checks and integration checks.

The source-count scope now contains **18,829 physical lines**: DAT 4,220; EMA-Draft 3,333; CAWELON-Draft 3,332; Wallet 7,944. Counts include implementation, tests, tools, configuration, comments and blank lines. Documentation, dependencies, lockfiles and generated files are excluded; shared code is counted separately per repository. Line count is not a quality or completion measure.

## Remaining limits

The historical Chrome timeout remains unexplained. Passing these bounded runs does not establish universal browser stability or catch errors outside the observed browser session.

The official Aerodrome probe was not rerun, and its previously observed EIP-6963-only connection limitation remains unresolved. The original mock-wallet lineage at `4848c39b60bac2c63fc38f685cdef12cd96290a8` is preserved. Real extension compatibility, WalletConnect, completed external-site signed login and an independent security audit remain unverified.

No real-wallet signing, trading, transfers, approvals, liquidity additions, production deployments or game development were performed. Existing EVM fixtures operate on simulated local state only.

## Reproduction

```sh
# ThreeCore-Wallet; browser commands require Linux and Chrome
npm test
npm run test:demo-server
node scripts/test-browser-ui.js --verify-error-detection
for attempt in 1 2 3; do npm run test:browser-ui || exit 1; done

# Each compiled sibling token repository with its locked dependencies
node --test ../ThreeCore-Wallet/integration/token-compatibility.test.mjs
```
