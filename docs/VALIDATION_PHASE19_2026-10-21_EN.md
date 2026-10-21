# Phase 19 — Wallet addition, removal, rediscovery and reconnection

Date: October 21, 2026 (JST)

## Outcome and boundaries

The isolated Aerodrome chooser proposal now rejects saved choices after their connector is removed, rejects stale connection results, and refuses connection when two active connector identities resolve to the same provider. Both same-name and empty/whitespace-name fixtures exercise addition, removal, rediscovery, reordering, restoration, explicit reconnection and final revocation.

The browser experiment exposed a relevant behavior: adding a third mock causes the framework to rediscover a previously removed provider from its discovery cache under a new connector UID. Restoring its old connector then produces two choices for the same provider. The proposal rejects that ambiguous connection. After the test fixture explicitly removes the duplicate, a fresh selection connects the intended original mock; selecting the newly added mock connects only that mock.

This remains a **proposal tested in modified disposable browser pages**, not a deployed Aerodrome fix. Duplicate cleanup is an explicit fixture operation; a production recovery UI is not implemented. Numbered choices identify connector instances, not authentic wallet publishers. The unmodified official desktop page still does not connect the EIP-6963-only mock. No signed login was completed.

## Starting state

All four local working trees were clean, matched freshly checked GitHub main, and had successful previous main CI.

| Repository | Starting main |
| --- | --- |
| DAT | `8f059b9419ac2d999bd004240c6cb175065d4641` |
| EMA-Draft | `25d81f70b7ad06fd699349ba3128f4c1720d6899` |
| CAWELON-Draft | `3a0ae2d2af223b30c9c9fc6fcd2030466ba55521` |
| ThreeCore-Wallet | `d190a25ea3361b7e1d10bb13da09539ef792fed2` |

The original mock lineage `4848c39b60bac2c63fc38f685cdef12cd96290a8` and historical reports are retained. Production Wallet session code and token contracts are unchanged. Token repositories pin the validated Wallet and link this report.

## Defects reproduced and corrected

1. **Old callbacks survived list removal.** Nine of ten focused lifecycle regressions failed against the preceding adapter. Removing a choice, restoring the same UID, changing its displayed name or invalidating the list did not prevent its saved connect function from running. Each continuous presence now has a separate validity token. Removal invalidates old callbacks; restoring the same UID preserves its display number but requires a fresh selection. Addition and reordering preserve valid selections without moving them to another provider.
2. **Asynchronous work could outlive the choice.** The adapter checks selection validity before and after provider resolution and after the connector returns. Removal during initial resolution sends no permission request. A result arriving after removal is rejected, without trying another connector. Provider-object changes behind an unchanged getter and rebound connector functions are also rejected.
3. **Rediscovery could create two choices for one provider.** This was observed in the real pinned framework during the second candidate's browser test. A new regression failed before the additional correction. Connection now resolves the current discovered providers and requires one unambiguous match for the selected provider, even for a fresh callback. Both duplicated choices are refused until the fixture explicitly removes the duplicate. Display names, reverse-domain labels and list position are not routing keys.

The first browser candidate also exposed an error in our new test fixture: it assumed a connector-store `getState` API that was not exposed. The fixture now reads `config.connectors` and validates the store's mutation/subscription methods. This was our harness mismatch, not a newly discovered production Aerodrome defect. The [Wagmi configuration implementation](https://github.com/wevm/wagmi/blob/main/packages/core/src/createConfig.ts) documents the separation; the pinned browser experiment validates the actual build. Its internal mutation API is not a stable public integration contract.

## What the lifecycle experiment does

Each fresh extension-free profile contains three separate keyless mock providers. The secondary mock announces first; the primary and secondary start with equal names or empty/whitespace names. The third mock is initially inactive and uses the same display-name condition. All signature/transaction methods reject; no key is present.

After the existing two-provider connection/rejection/revocation sequence, the lifecycle test records fifteen checkpoints:

1. Both initial mocks revoked; the third mock is inactive.
2. Remove the primary connector from the experimental framework list.
3. Invoke its saved callback: reject it with no new permission or signing request.
4. Activate the third provider through EIP-6963. Observe both its new connector and the cached primary's rediscovered connector, each with a new number; the removed number is not reused.
5. Reverse the discovered list. Existing UID-to-number bindings remain unchanged.
6. Restore the original primary connector. Four connector choices now represent three mock providers.
7. Invoke the original saved callback again: it remains stale despite restoration.
8. Invoke a freshly captured restored callback: refuse the duplicated provider without requesting permission.
9. Explicitly remove the rediscovered duplicate in the fixture. This is not an automatic production recovery mechanism.
10. Make a fresh visible primary selection. Only the original primary mock grants access.
11. Remove that connected choice from the list. Its already granted mock permission remains until separately revoked.
12. Explicitly revoke primary mock access; the secondary and added mock remain without access.
13. Select the added mock by its unique current provider binding. Only its synthetic account is granted.
14. Attempt sign-in with that mock. Its signature request is rejected with code 4001.
15. Revoke the added mock. All three finish with empty account permissions.

Missing checkpoints, changed labels, reused identities, missing buttons, failed stale/ambiguous rejection, unexpected permission on another mock, wrong accounts or missing final revocation fail the diagnostic.

Removal/restoration uses the pinned framework's connector store through an explicit test-only control. It is **not an extension uninstall test or a standardized removal event**. [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) specifies discovery announcement/request events. A provider can remain in discovery caches after a list entry is removed. “Unnamed” refers to blank display names, not an anonymity feature.

## Candidate and browser evidence

Final candidate: [2d2551c8287c80f9d6532b008133e582559b4139](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/2d2551c8287c80f9d6532b008133e582559b4139). [Regression CI](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39528359933) and [ten-condition external diagnostic](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39528359937) succeeded. [Machine-readable evidence](phase19-validation-evidence.json) records visible choices, independent mock state, calls, rejection results and exact asset hashes. Raw observations remain in workflow artifacts.

Earlier candidates are retained for traceability: `42bd42ef84bf6d60ab6b4bbfcb39eb8e3b6ee5ef` failed the two new conditions because of the fixture API mismatch; `a73e6a020813ef629c8e5354d245150f0eda238a` exposed cached rediscovery and failed the expected lifecycle checks. Those failures were not counted as passes and were not published to main.

| Validation | Result |
| --- | --- |
| Offline Wallet suite | 467 passed locally and in final candidate CI; 19 new cases |
| Demo HTTP / fixture isolation | 2 passed |
| Deliberate uncaught-error and unhandled-rejection controls | Both correctly rejected |
| Chrome UI | Same 27 cases passed in each of 3 consecutive fresh profiles |
| DAT / EMA / CAWELON integration | 46 per token; 138 total |
| Token read-only / history in Wallet matrix | 120 / 10 per token |
| External diagnostic | 8 retained baseline conditions plus 2 lifecycle conditions |

The retained conditions include official legacy access, unsuccessful official EIP-6963-only access, list-only single/multiple/delayed cases, the old ambiguous-name refusal, and the two numbered-choice baselines. A green diagnostic validates its expected observation; it does not mean ten successful connections. Repeated and overlapping test runners are not added as unique test cases.

The 12 tested workflow/source/test files are compared exactly with main publication; only README and phase report/evidence are added after candidate validation. Final main CI in all four repositories validates their published commits. Each token's CI retains compilation, project tests, type checking and 46 integration checks against the new Wallet pin on simulated chain IDs 8453 and 84532, without a remote fork.

The response experiment remains pinned to `https://aerodrome.finance/assets/index-8N6caatx.js`, 2,026,768 bytes, SHA-256 `1ab822229f1f4b7e20c1e7b4780cceb1afca995a31d8d4ef7f3a7a4ec8a94a38`. It changes one exact chooser expression to call our adapter with the connector list and config. The new response SHA-256 is `50559924ca5a7a5beeb1775470262b4dbd1b5fa73c8eee5ebbd9f845d671975c`. Adapter and fixture source are pinned by the tested commit. Unknown asset bytes, URL, status or replacement counts are refused. No Aerodrome server was modified.

Source census: DAT 4,220; EMA-Draft 3,333; CAWELON-Draft 3,332; Wallet 9,241; total **20,126 physical lines**. This includes code/tests/tools/configuration/comments/blanks, excludes prose/dependencies/lockfiles/generated files, and counts shared files separately in each repository. Crossing the 20,000-line reference does not establish completion, safety or quality.

## Reproduction and remaining limits

```sh
npm test
npm run test:demo-server
node scripts/test-browser-ui.js --verify-error-detection
for attempt in 1 2 3; do npm run test:browser-ui || exit 1; done
for scenario in duplicate-name unnamed; do
  node scripts/run-isolated-aerodrome-probe.js --mock-wallet --eip6963-only --diagnose-discovery --test-wallet-choice-fix --test-wallet-lifecycle "--scenario=$scenario" || exit 1
done
```

The workflow also runs all eight retained baseline conditions. Lifecycle mode requires the mock, EIP-only, discovery-diagnostic and choice-experiment flags. No existing browser session is attached.

Already-dispatched permission requests cannot be canceled by rejecting a late JavaScript result; already-granted wallet permission is not revoked by deleting a UI entry. The browser test uses explicit synthetic revocation, and the offline test verifies rejection of a late result, not permission rollback. Pending real-wallet prompts and application/framework events during such prompts remain unverified.

Official EIP-6963-only connection, a deployed chooser/recovery UI, real extensions/uninstall behavior, mobile, WalletConnect, publisher authentication, signed login, arbitrary malicious metadata/icons and an independent security audit remain unresolved or unverified. The earlier Phase 14 Chrome timeout remains unexplained. No real-wallet signing, trading, transfers, token approvals, liquidity additions, production deployment, upstream communication or game development was performed.
