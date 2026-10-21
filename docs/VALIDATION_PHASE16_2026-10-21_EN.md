# Phase 16 — Aerodrome EIP-6963-only connection investigation

Date: October 21, 2026 (JST)

## Outcome

The unmodified official Aerodrome desktop interface still discovers the synthetic EIP-6963 provider but does not expose it in the wallet chooser. No account permission request reaches that provider after the Browser Wallet route is selected, including after explicit rediscovery and a second selection.

A controlled comparison now provides stronger causal evidence: removing only the connector-list truncation in a disposable browser's copy of the verified JavaScript response makes the synthetic wallet visible. Selecting it establishes synthetic account access using EIP-6963 alone, reaches a signature request that the mock rejects with code 4001, and supports synthetic revocation followed by explicit reconnection. `window.ethereum` remains absent.

**This is an experimental browser response replacement, not a fix deployed to Aerodrome. Official EIP-6963-only compatibility remains unresolved. No signed login was completed.** The result is bounded to the recorded desktop build and mock provider; it is not a production-ready upstream patch or a universal compatibility claim.

## Starting state and provenance

All four local repositories were clean and matched GitHub main. Their previous main CI runs were successful.

| Repository | Starting main |
| --- | --- |
| DAT | `271bc8256b5235da0d5bac63f929c55dd2a42e8c` |
| EMA-Draft | `0ba640f8f2116e922f747dd6301510088350e0fb` |
| CAWELON-Draft | `2d5093e7eef77ae756268cd3c8f0c1668436cbac` |
| ThreeCore-Wallet | `a25779e361c58d38f2494d7b42f6812bd8755e40` |

The original official-interface mock lineage at `4848c39b60bac2c63fc38f685cdef12cd96290a8` is retained. A fresh [unmodified baseline run](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39512681357), at `311a655cf191e5d85dedfd35618ebb3d19a03d83`, reproduced the earlier limitation before the new experiment was added.

## Controlled comparison

All variants use a fresh extension-free Chromium profile and a keyless mock account. Only the legacy baseline defines `window.ethereum`. The EIP-6963 variants announce the same explicitly labeled `ThreeCore TEST ONLY (no funds)` provider, following the [EIP-6963 discovery mechanism](https://eips.ethereum.org/EIPS/eip-6963).

| Variant | Synthetic wallet visible by name | Account access | Signature boundary | Revoke / reconnect |
| --- | --- | --- | --- | --- |
| Unmodified official, legacy plus EIP-6963 | No; Browser Wallet route used | Granted in mock | Rejected, 4001 | Observed |
| Unmodified official, EIP-6963 only | No | No permission request | Not reached | No connection to reconnect |
| Locally modified response, EIP-6963 only | Yes, fifth choice | Granted in mock | Rejected, 4001 | Observed |

The official asset was `https://aerodrome.finance/assets/index-8N6caatx.js`, 2,026,768 bytes, SHA-256 `1ab822229f1f4b7e20c1e7b4780cceb1afca995a31d8d4ef7f3a7a4ec8a94a38`. Its chooser derives a limit from the initially configured connector count and uses `r.slice(0,_0e)` before mapping display names. On the observed desktop page, this retains four configured options while excluding the appended discovered provider.

The experiment replaces exactly that one list-truncation expression with the full connector list, preserving the existing display-name mapping. The modified response hash is `69429c4d642607894a315b4d3797ff36dc30d09e851fb146a54d248190f3b34c`. No server, repository owned by Aerodrome, production deployment, provider identity or real wallet was changed. Before/after chooser labels, RPC method names, discovery ordering, hashes and validation jobs are recorded in [machine-readable evidence](phase16-validation-evidence.json); raw observations remain in the workflow artifacts.

The comparison supports the list truncation as the blocker in this build. An upstream solution would need a maintained connector-list implementation and broader wallet, mobile, deduplication and untrusted metadata testing. The version-pinned response replacement is deliberately a diagnostic instrument, not a runtime workaround for users.

## Corrections and safeguards in our diagnostic tools

- Prefer the exact announced synthetic wallet name in discovery-only mode. The earlier probe tried only the generic Browser Wallet route; it could not exercise a future chooser that correctly displayed the discovered mock. The legacy baseline keeps its original route for comparison.
- Reject ambiguous duplicate labels, disabled buttons, lookalike names and unknown command-line arguments.
- Require all of `--mock-wallet`, `--eip6963-only` and `--diagnose-discovery` before allowing `--test-connector-list-fix`.
- Intercept only the exact pinned asset URL in the disposable browser. Require HTTP 200, exact byte length, SHA-256 and one matching expression. Unknown builds, redirects, repeated replacement or missing interception cannot produce a successful experiment.
- Label experimental outcomes separately. A successful experiment always reports `unmodifiedOfficialConnectionObserved: false` and `completedSignIn: false`.
- Keep the default-deny provider: signature, transaction, approval and unsupported requests reject. No private keys or user browser profiles are loaded.

Token contracts and the production Wallet session connector are unchanged. The three token repositories receive a pinned Wallet revision and English validation links.

## Verified results

Candidate [`b77d054939d3b4148a916040eaeef81e345a489e`](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/b77d054939d3b4148a916040eaeef81e345a489e) passed [regression CI](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39513426528) and [all three external diagnostic variants](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39513426445).

| Check | Observed result |
| --- | --- |
| Wallet offline suite, local and candidate CI | 414 passed, including 12 new diagnostic cases |
| Demo HTTP route / fixture isolation | 2 passed |
| Uncaught-error and unhandled-rejection controls | Both correctly rejected |
| Synthetic Chrome UI | 27 cases passed in each of 3 consecutive fresh profiles |
| DAT / EMA / CAWELON integration | 46 per token; 138 total |
| Token read-only / history checks in Wallet matrix | 120 / 10 passed per token |
| External diagnostic variants | 3 completed; official EIP-only result remains negative |

A green diagnostic job means the observation is complete; it does not mean the connection succeeded. Repeated browser executions are the same 27 cases, and overlapping token runners must not be summed. Wallet integration uses pinned token contract revisions, simulated chain IDs 8453 and 84532, and no remote fork. Each token's main CI also checks its current contract against the newly pinned Wallet revision. Final publication CI is available in the four repositories' Actions histories.

The nine tested workflow/source/test files are compared exactly with the main publication contents. README and report/evidence files are the only additions after candidate validation.

The current source-count scope is 19,051 physical lines: DAT 4,220; EMA-Draft 3,333; CAWELON-Draft 3,332; Wallet 8,166. It includes implementation, tests, tools, configuration, comments and blank lines; excludes documentation, dependencies, lockfiles and generated files; and counts shared code separately in each repository. Line count does not measure completion or security. Historical reports retain their original snapshots.

## Reproduction and remaining limits

```sh
npm test
npm run test:demo-server
node scripts/test-browser-ui.js --verify-error-detection
for attempt in 1 2 3; do npm run test:browser-ui || exit 1; done
node scripts/run-isolated-aerodrome-probe.js --mock-wallet --diagnose-discovery
node scripts/run-isolated-aerodrome-probe.js --mock-wallet --eip6963-only --diagnose-discovery
# Explicit counterfactual; never an official-site compatibility pass:
node scripts/run-isolated-aerodrome-probe.js --mock-wallet --eip6963-only --diagnose-discovery --test-connector-list-fix
```

The isolated external launcher uses Chrome on Linux or Edge on Windows; Chrome-based CI supplies the recorded observations. The pinned experiment intentionally stops when the official asset changes. Real extension compatibility, mobile interfaces, WalletConnect, authenticated signed login and an independent security audit remain unverified. The earlier Phase 14 Chrome timeout remains unexplained; these passing runs do not establish its cause or eliminate intermittent failures.

No real-wallet signing, trading, transfers, token approvals, liquidity additions, production deployments or game development were performed. No upstream issue, message or pull request was sent.
