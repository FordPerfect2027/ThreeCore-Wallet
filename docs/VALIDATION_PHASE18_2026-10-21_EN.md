# Phase 18 — Distinguishing same-name and unnamed wallet choices

Date: October 21, 2026 (JST)

## Outcome

An isolated Aerodrome browser experiment now displays separate numbered choices for two wallets with the same name, and for two wallets whose names are empty or whitespace. Each choice preserves the underlying connector instance. In both conditions, selecting each keyless mock in turn grants account access only to that mock, rejects its signature request, and allows both mocks to finish with access revoked.

This is a **tested presentation and routing proposal**, not a deployed Aerodrome fix or wallet-publisher authentication. “Unnamed” means a blank display name here; it does not mean an anonymity or privacy feature. The unmodified official desktop page still fails to connect the EIP-6963-only mock. No signed login was completed.

## Starting state and scope

All four local repositories were clean, matched freshly checked GitHub main, and had successful previous main CI runs.

| Repository | Starting main |
| --- | --- |
| DAT | `08dd6dae0bde1d5d4fcee1fab8b7cb8b0e4b625c` |
| EMA-Draft | `74feb00d762d73c402ff159270ded37ce8e2a1d6` |
| CAWELON-Draft | `828c8bbe777a3820a33f44369281425466701f7e` |
| ThreeCore-Wallet | `b722a49f204f0defa8827ba0967b3bd19ce203dc` |

Original mock lineage: `4848c39b60bac2c63fc38f685cdef12cd96290a8`. Historical reports remain intact. The production Wallet session connector and token contracts are unchanged; token repositories receive the validated Wallet pin and documentation.

## What changed

The previous connector-list experiment made discovered wallets visible but left equal names indistinguishable. Its diagnostic correctly refused to choose. The new opt-in experiment adds a bounded, per-page registry keyed by the framework's connector instance UID, preserving connector methods and assigning stable local choice numbers.

- Same-name examples: `Wallet choice 1: ThreeCore TEST ONLY (no funds) (unverified name)` and `Wallet choice 2: ThreeCore TEST ONLY (no funds) (unverified name)`.
- Empty and whitespace names become `Wallet choice 1: Unnamed wallet (unverified name)` and `Wallet choice 2: Unnamed wallet (unverified name)`.
- Repeat announcements and reordered connector lists retain the existing choice numbers. Removed choices cannot be resolved by the diagnostic, and numbers are not reused for another connector during the page session.
- Names are normalized, stripped of control/bidirectional formatting characters and angle brackets, whitespace-collapsed and length-limited. This is display hygiene, not general anti-impersonation protection.
- Missing, duplicate, configured/discovered-colliding or rebound connector identities are rejected. Registry/list size is bounded. A failed list update invalidates the registry's current selection data.
- The test-only provider lookup matches the actual synthetic provider object returned by the connector, rather than its name, UUID, reverse-domain label or list position. Multiple matches, lookup errors and a list change during asynchronous lookup return no selection.

**Choice numbers identify local connector instances, not legitimate publishers.** Name, reverse-domain label and UUID are self-reported discovery metadata; see the [EIP-6963 specification](https://eips.ethereum.org/EIPS/eip-6963). The test knows both mock provider objects in advance. That test oracle is not a way for a real user to authenticate an unknown wallet. Production usability, trusted wallet-side confirmation and resistance to malicious providers still require separate design and validation. Do not interpret the numbered labels as a verified-wallet badge.

## Eight observed conditions

Each condition uses a fresh extension-free browser profile with keyless synthetic providers. Only the legacy baseline defines `window.ethereum`. The two-provider fixtures announce the secondary mock first, so the intended primary is not simply the first item in the chooser.

| Page / condition | Observed result |
| --- | --- |
| Official, legacy plus EIP-6963 | Mock connects, signing is rejected, account access is revoked and explicitly reconnected |
| Official, EIP-6963 only | Discovery is observed; the mock is absent from the chooser and receives no permission request, including after rediscovery and a second click |
| Connector-list experiment, one provider | Mock connects, rejects signing, revokes and reconnects |
| Connector-list experiment, repeated announcements of two providers | Intended named mock connects; the other mock remains without permission |
| Connector-list experiment, delayed provider | Mock appears after explicit activation and can connect, reject signing, revoke and reconnect |
| Connector-list experiment, equal names | Our diagnostic refuses ambiguous selection and sends neither mock a permission or signature request |
| New choice experiment, equal names | Two distinct numbered choices remain stable after reannouncement; each selects its own mock, rejects signing and ends revoked |
| New choice experiment, empty / whitespace names | Two distinct numbered “Unnamed wallet” choices remain stable; the same independent two-mock flow passes |

For each new condition, the evidence records ten checkpoints: before and after repeated announcements, primary connection, primary signature rejection, revocation, explicit reconnection, primary disconnection, secondary connection, secondary signature rejection, and final revocation of both. Before secondary selection, the secondary mock has only discovery/read calls and no account permission. During secondary connection/sign-in attempts, the primary remains revoked and receives no additional non-read method. The final snapshot shows empty accounts for both providers. These are synthetic account-access checks; no token approval is granted.

A successful diagnostic means its expected outcome was observed. It does **not** mean eight successful connections, nor does the old ambiguous-selection refusal establish that Aerodrome itself blocks ambiguous choices.

## Experimental response and adapter

The experiment requires all of `--mock-wallet`, `--eip6963-only`, `--diagnose-discovery` and `--test-wallet-choice-fix`, with `--scenario=duplicate-name` or `--scenario=unnamed`. It cannot be combined with the earlier connector-list flag. Unknown or conflicting options fail before browser work.

It injects the mock and the experimental registry into the disposable page, then replaces exactly one pinned chooser expression with a call to that registry. The registry source is included in the tested commit. This includes both a response change and our adapter; it is not evidence that removing list truncation alone solves the issue.

| Asset check | Value |
| --- | --- |
| URL | `https://aerodrome.finance/assets/index-8N6caatx.js` |
| Original size | 2,026,768 bytes |
| Original SHA-256 | `1ab822229f1f4b7e20c1e7b4780cceb1afca995a31d8d4ef7f3a7a4ec8a94a38` |
| Earlier list-only response SHA-256 | `69429c4d642607894a315b4d3797ff36dc30d09e851fb146a54d248190f3b34c` |
| New choice response SHA-256 | `801f2d4a7b81e9da2fab58d032921cabf98a052109ed653fedf30a64e46826ba` |

The original URL, HTTP status, bytes, digest and unique replacement must match. An unknown build is refused. The adapter requires the exact official origin and synthetic marker, and is not loaded by the ordinary Wallet demo. No Aerodrome deployment was changed, and no upstream communication was sent.

## Test evidence

Candidate [`9f8e92c187623b336b70dd97bc9c107dfb072617`](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/9f8e92c187623b336b70dd97bc9c107dfb072617) passed [regression CI](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39524511497) and [all eight external diagnostic conditions](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39524511496). [Machine-readable evidence](phase18-validation-evidence.json) includes job results, asset hashes, visible choices, cumulative RPC methods, rejected signatures and permission state. Full raw observations are retained in the external workflow artifacts.

| Check | Result |
| --- | --- |
| Wallet offline suite, local and candidate | 448 passed; 20 additional cases |
| Demo HTTP route / fixture isolation | 2 passed |
| Deliberate uncaught-error / unhandled-rejection controls | Both correctly rejected |
| Chrome UI | Same 27 cases passed in each of 3 consecutive fresh profiles |
| DAT / EMA / CAWELON integration | 46 per token; 138 total |
| Token read-only / history checks in Wallet matrix | 120 / 10 per token |
| External diagnostic matrix | 8 conditions completed with the distinct outcomes above |

New offline cases cover label identity and stability, blank names, configured-connector preservation, removal, ambiguous provider mapping, invalid and rebound identities, stale asynchronous resolution, malformed lists, sanitized names, bounded state, origin/mock gating, exact replacement and CLI gating. The scenario-report regressions reject missing checkpoints, premature secondary access, cross-provider leakage and invalid choice evidence.

The 11 tested workflow/source/test files are compared byte-for-byte with the staged main publication. Only README and this phase's report/evidence are added afterward. Final main CI is available in each repository's Actions history. Token CI also checks its current project tests, compilation, types and the newly pinned Wallet using simulated chain IDs 8453 and 84532 without a remote fork. Repeated or overlapping runners must not be summed as unique test cases.

Source scope: DAT 4,220 lines; EMA-Draft 3,333; CAWELON-Draft 3,332; ThreeCore-Wallet 8,832; **19,717 total**. Counts include implementation, tests, tools, configuration, comments and blank lines; exclude documentation, dependencies, lockfiles and generated files; and count shared code separately per repository. The 20,000-line reference is not a completion or quality criterion.

## Reproduction and limits

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
for scenario in duplicate-name unnamed; do
  node scripts/run-isolated-aerodrome-probe.js --mock-wallet --eip6963-only --diagnose-discovery --test-wallet-choice-fix "--scenario=$scenario" || exit 1
done
```

Observed external runs use Linux Chrome. The existing launcher also supports Windows Edge with a disposable profile, but that does not establish real-extension compatibility. Official EIP-6963-only connection, production chooser behavior and publisher authentication remain unresolved. Real extensions, mobile, WalletConnect, signed login, arbitrary malicious metadata/icon behavior, and an independent security audit remain unverified. The earlier Phase 14 Chrome timeout remains unexplained.

No real-wallet signing, trading, transfers, token approvals, liquidity additions, production deployments or game development were performed. Existing token integration fixtures operate only on simulated EVM state.
