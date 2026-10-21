# Phase 17 — Aerodrome chooser proposal under multiple-wallet conditions

Date: October 21, 2026 (JST)

## Outcome

The isolated connector-list proposal now has evidence for multiple providers, repeated announcements and a provider becoming available after the wallet chooser has loaded. In those experimental pages, the intended keyless mock connects using EIP-6963 alone, rejects signing, revokes account access and reconnects explicitly. The unselected provider receives only an account-discovery read and retains no account permission.

The same-name test exposes a remaining design limitation: removing the list truncation can display two indistinguishable wallet names. **Our diagnostic refuses to choose either one. This is the diagnostic's safeguard, not evidence that Aerodrome itself prevents an ambiguous selection.** A production proposal needs a deliberate way for users to distinguish providers and select the intended connector instance.

The unmodified official desktop page still excludes the announced mock from its chooser and does not request its account permission. **Official Aerodrome EIP-6963-only compatibility remains unresolved.** No Aerodrome deployment was modified, and no signed login was completed.

## Starting state

All local repositories were clean, matched GitHub main, and had successful previous main CI runs.

| Repository | Starting main |
| --- | --- |
| DAT | `d224b04df371881740342e6070a4dfc71c776728` |
| EMA-Draft | `f64c031f74c0af3628f1971a8a23c1b6e062c08e` |
| CAWELON-Draft | `01bb488b77d81d9d3c34bde2e710800c9e90873f` |
| ThreeCore-Wallet | `4634fec948edeb2cacbcb601ae23712a30852e35` |

The original mock lineage `4848c39b60bac2c63fc38f685cdef12cd96290a8` and all historical reports are retained. Phase 16 established the single-provider comparison; this phase expands its conditions and strengthens the diagnostic itself.

## Six observed conditions

Each condition uses a fresh extension-free Chromium profile. Synthetic providers have separate state, fixed test identities and no keys. They reject all signature and transaction methods. Only the legacy baseline defines `window.ethereum`.

| Page / scenario | Observation |
| --- | --- |
| Unmodified official, legacy plus EIP-6963 | Browser Wallet grants mock account access; signing rejected; revocation and reconnection observed |
| Unmodified official, EIP-6963 only | Provider discovered; no named choice or account permission request after rediscovery and another Browser Wallet click |
| Experimental page, one provider | Named mock connects; signing rejected; revocation and reconnection observed |
| Experimental page, two providers and repeated announcements | Secondary provider appears first; each provider is reannounced three more times; one choice remains per distinct name; the intended primary connects while secondary permissions remain empty |
| Experimental page, delayed provider | Chooser initially lacks the mock; activating its announcement after page readiness adds it; explicit selection connects and subsequent revocation/reconnection succeeds |
| Experimental page, two providers with the same name | Two choices remain visible; our diagnostic makes no selection and requests no permission or signature from either provider |

The delayed fixture uses an explicit activation after the real chooser is observed, so the test does not depend on guessing a network delay. Repeated announcements reuse the same provider objects and UUIDs. Same-name providers have different UUIDs and reverse-domain labels. The [EIP-6963 specification](https://eips.ethereum.org/EIPS/eip-6963) provides the discovery event mechanism; metadata remains self-reported and is not proof of wallet identity.

## Corrections to the diagnostic

1. **Reject concurrent replacement attempts before asynchronous work.** Previously, two responses arriving while the first response body was loading could both see the experiment as pending. A new regression reproduced two body-read attempts where only one was expected. The helper now claims the replacement synchronously, before awaiting CDP, and records verification failures as refused. The regression fails on the preceding implementation and passes after correction. This was a diagnostic concurrency defect; it is not evidence of a real-wallet transaction issue.
2. **Separate UI readiness from selection safety.** A chooser with two identical mock labels is rendered, although our exact-label selector cannot safely choose between them. The report now records `siteUiLoaded: true` and `routeUnambiguous: false` independently. Ambiguity does not become a successful connection result.
3. **Record and verify scenario-specific evidence.** Capture state before delayed activation or repeat announcements, the unselected provider's RPC methods and permissions, chooser counts, and state through reconnection. Missing evidence, accidental secondary permission, unexpected secondary methods, legacy-provider contamination or an unapplied experiment cause failure.

CLI scenario names are fixed and require the explicit mock, EIP-6963-only, discovery-diagnostic and connector-experiment flags for additional scenarios. Unknown or conflicting flags are rejected. The ordinary production Wallet session connector and all token contracts are unchanged.

## Boundaries of the proposed dApp correction

The response replacement still changes only the connector-list truncation identified in Phase 16. It requires the exact asset URL, HTTP 200, byte length, SHA-256 and one matching expression. It is a counterfactual browser experiment, not a production workaround or an upstream source patch.

Original asset: `https://aerodrome.finance/assets/index-8N6caatx.js`, 2,026,768 bytes, SHA-256 `1ab822229f1f4b7e20c1e7b4780cceb1afca995a31d8d4ef7f3a7a4ec8a94a38`. The single replacement removes `r.slice(0,_0e)` truncation while preserving the existing display-name mapping. Modified response SHA-256: `69429c4d642607894a315b4d3797ff36dc30d09e851fb146a54d248190f3b34c`. An unknown build is refused rather than patched by a loose match.

A maintained upstream implementation should retain dynamically discovered connectors, preserve explicit selection of the actual connector instance, handle repeat announcements without discarding distinct providers, and present same-name choices without implying that a name or reverse-domain label authenticates them. This phase verifies discovery timing and distinct-name selection in the experimental build. It **does not implement or validate a production UI for disambiguating same-name wallets**, nor does it cover arbitrary metadata collisions, malicious icons, mobile wallets or every extension. The list change alone is therefore not presented as a complete production fix.

## Validation evidence

Final candidate [`354719fcff2a44da45c64e66452da876abba6047`](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/354719fcff2a44da45c64e66452da876abba6047) is checked by [regression CI](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39516429566) and [the six-condition external diagnostic](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39516429622). [Machine-readable evidence](phase17-validation-evidence.json) contains the observed states, provider separation, hashes and job results. Raw observations remain in the workflow artifacts.

| Check | Result |
| --- | --- |
| Wallet offline suite, local and final candidate | 428 passed; 14 more cases than Phase 16 |
| Demo HTTP route / fixture isolation | 2 passed |
| Intentional uncaught-error / unhandled-rejection controls | Both correctly rejected |
| Synthetic Chrome UI | Same 27 cases passed in each of 3 consecutive fresh profiles |
| DAT / EMA / CAWELON integration | 46 per token; 138 total |
| Token read-only / history checks in Wallet matrix | 120 / 10 per token |
| External browser conditions | All 6 diagnostics completed with the distinct outcomes above |

A green diagnostic is not a blanket compatibility pass: one condition observes failed official EIP-only connection, and another verifies refusal of ambiguous selection. Repeated executions are not additional independent cases. Token integration uses simulated chain IDs 8453 and 84532 without a remote fork. Each token's main CI checks its current contract against the newly pinned Wallet revision and retains compilation, project tests and type checking.

The 11 tested workflow/source/test files are compared exactly with the main publication. Only README and report/evidence files are added after candidate validation. Final main CI is available in the four repositories' Actions histories.

Current source scope: DAT 4,220 lines; EMA-Draft 3,333; CAWELON-Draft 3,332; Wallet 8,469; total 19,354. This includes implementation, tests, tools, configuration, comments and blank lines, excludes documentation, dependencies, lockfiles and generated files, and counts shared code separately per repository. Physical line count is not a quality or completion measure.

## Reproduction and remaining limits

```sh
npm test
npm run test:demo-server
node scripts/test-browser-ui.js --verify-error-detection
for attempt in 1 2 3; do npm run test:browser-ui || exit 1; done
node scripts/run-isolated-aerodrome-probe.js --mock-wallet --diagnose-discovery
node scripts/run-isolated-aerodrome-probe.js --mock-wallet --eip6963-only --diagnose-discovery
for scenario in single multi-reannounce delayed duplicate-name; do
  node scripts/run-isolated-aerodrome-probe.js --mock-wallet --eip6963-only --diagnose-discovery --test-connector-list-fix "--scenario=$scenario" || exit 1
done
```

Recorded browser runs use Linux Chrome. The external launcher supports Edge on Windows with a disposable profile; it does not reuse a user's session. The pinned experimental asset may stop matching a future Aerodrome build, in which case the diagnostic must be investigated rather than its hash bypassed.

Official EIP-6963-only connection, production same-name disambiguation, real extensions, mobile, WalletConnect, authenticated signed login and an independent security audit remain unverified or unresolved. The earlier Phase 14 Chrome timeout remains unexplained. No real-wallet signing, trading, transfers, approvals, liquidity additions, production deployments, game development or upstream communications were performed.
