# Phase 20 — Review duplicate wallet entries and reconnect explicitly

Date: October 21, 2026 (JST)

## Outcome and scope

The isolated Aerodrome proposal now includes a **visible wallet-entry review panel**. Users can review duplicated connections, choose the numbered entry to keep, cancel, remove only its duplicate entries, and then make a fresh wallet selection to reconnect. Same-name wallets with different provider objects remain separate. Empty/whitespace names receive numbered labels, without being treated as proof of publisher identity.

The two new browser conditions use actual mouse events on visible, unobscured panel buttons. They verify cancellation, a list change while a choice is selected, forced review after that change, explicit cleanup, rejection of the pre-cleanup callback, and fresh reconnection of the intended mock. Cleanup itself grants no account permission. Screenshots are captured during selection and visually reviewed.

This is an **implemented experimental UI in a modified, disposable browser page**, not an Aerodrome deployment. The unmodified official desktop page still does not connect the EIP-6963-only mock. No signed login was completed. The production ThreeCore session connector and token contracts are unchanged.

## Starting state and lineage

All four local trees were clean and matched freshly checked main. Previous main CI was successful in all four repositories.

| Repository | Starting main |
| --- | --- |
| DAT | `111290df5d9ff47a3870486b73a695695ad3483e` |
| EMA-Draft | `22d692bc53592fc8c343efdb0498387dd7404f9f` |
| CAWELON-Draft | `42014fcebe8cd3d89d537a180291bfbccaa7d23f` |
| ThreeCore-Wallet | `9073b55e63425c29dc4dce02898ed9584cc2e6a7` |

The original official-Aerodrome mock lineage `4848c39b60bac2c63fc38f685cdef12cd96290a8` and prior reports remain intact. Phase 19 supplied stale-choice rejection and reproduced cached rediscovery; its cleanup step was an explicit fixture operation. The new recovery conditions perform that cleanup through the visible panel instead. The original ten diagnostic conditions remain as regression controls.

## Recovery behavior

1. **Review first.** The panel resolves the current discovered connectors and groups only identical provider-object references. Display name, UUID, reverse-domain label and list position are not deduplication keys. Configured connectors are not cleanup candidates.
2. **Choose explicitly.** Every candidate retains its stable numbered label. The chosen entry is highlighted and identified in the status text. There is no default keep selection. One chosen group is processed at a time; other groups require another review.
3. **Cancel safely.** Closing the review clears its selection and invalidates pending review/apply results without changing the list or requesting permission.
4. **Reject stale reviews.** Addition, removal or reordering clears the selection. Immediately before cleanup, the controller checks connector object references, order, UID, name, getter/connect function references and resolved providers again. Changes or missing data require a fresh review.
5. **Bound waiting.** Review and final verification each have a three-second timeout. Late results cannot overwrite a canceled or superseded review. Repeated apply clicks cannot perform duplicate writes. A failed list update produces a recoverable error.
6. **Require a fresh connection choice.** Cleanup invalidates all old choice callbacks, including the retained entry, before updating the list. It never calls connect or a provider RPC. The user then selects a current entry in the existing wallet chooser; only that selected mock receives permission.

The panel uses text content for provider labels, native buttons, fieldset/legend grouping, pressed-state semantics, a live status message and explicit focus handling. The browser runner checks visibility and hit-testing before dispatching mouse events to its controls. This is not a full accessibility audit.

## Evidence and tests

Final candidate: [0ae3f5b6fabe92541fa46003ad7c6d8041f317d8](https://github.com/FordPrefect2026/ThreeCore-Wallet/commit/0ae3f5b6fabe92541fa46003ad7c6d8041f317d8). [Regression CI](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39548501319) and [twelve-condition external diagnostic](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39548501400) record the tested source. [Machine-readable evidence](phase20-validation-evidence.json) preserves exact job identities, asset hashes, recovery checkpoints, mock permission/request histories and connection outcomes. Full observations and panel PNG captures remain in the diagnostic artifacts.

The first candidate, `845c587b4a92f06177c72c5846aa3353ec3136f7`, passed both workflows. Screenshot review prompted clearer selected-choice styling; the final candidate additionally uses real browser mouse events for the recovery panel and was revalidated. No failed candidate is represented as a pass.

| Validation | Result |
| --- | --- |
| Offline Wallet suite | 492 passed locally and in candidate CI; 25 new cases |
| Demo HTTP / fixture isolation | 2 passed |
| Deliberate uncaught-error and unhandled-rejection controls | Both correctly rejected |
| Existing Chrome UI suite | Same 27 cases passed in each of 3 consecutive fresh profiles |
| DAT / EMA / CAWELON integration | 46 per token; 138 total |
| Token read-only / history in Wallet matrix | 120 / 10 per token |
| External diagnostic | 10 retained conditions plus 2 new recovery-UI conditions |

The new same-name and blank-name conditions each reproduce four connector entries for three providers. Only the two entries for the primary provider appear in the duplicate group. Closing the panel preserves all four entries. A subsequent list reorder invalidates the selection and blocks stale apply. After another review, keeping the original primary entry removes only its rediscovered duplicate. Three distinct providers remain; the panel reports no duplicates. Old callbacks remain invalid. A fresh native choice reconnects the primary mock only; subsequent selection of the added mock grants only its synthetic account. Signature attempts reject with code 4001. All three mocks finish revoked.

A green diagnostic means its expected observation was verified. These twelve conditions include the unsuccessful official EIP-6963-only connection and deliberate refusal of ambiguous selection; they are not twelve successful connections. Repeated runs and overlapping suites are not summed as unique tests. The existing 27-case UI suite is separate from the new external recovery-panel scenarios.

All ten tested workflow/source/test files are compared exactly with the main publication; only README and this phase's report/evidence are added after candidate validation. Token repositories pin the published Wallet revision and retain their current-main compilation, project tests, type checking and 46 integration checks on simulated chain IDs 8453 and 84532, without a remote fork. Final main outcomes are recorded in each repository's Actions history.

The pinned official response is unchanged from Phase 19: `https://aerodrome.finance/assets/index-8N6caatx.js`, 2,026,768 bytes, SHA-256 `1ab822229f1f4b7e20c1e7b4780cceb1afca995a31d8d4ef7f3a7a4ec8a94a38`. The choice-expression replacement has SHA-256 `50559924ca5a7a5beeb1775470262b4dbd1b5fa73c8eee5ebbd9f845d671975c`; injected registry/controller/panel source is pinned by the candidate commit. Unknown URL, status, bytes or replacement counts are refused. No Aerodrome server was modified.

## Reproduction

Source census: DAT 4,220; EMA-Draft 3,333; CAWELON-Draft 3,332; Wallet 9,671; total **20,556 physical lines**. This includes code/tests/tools/configuration/comments/blanks, excludes prose/dependencies/lockfiles/generated files, and counts shared files separately per repository. The 20,000-line reference is not a completion or safety threshold.

```sh
npm test
npm run test:demo-server
node scripts/test-browser-ui.js --verify-error-detection
for attempt in 1 2 3; do npm run test:browser-ui || exit 1; done
for scenario in duplicate-name unnamed; do
  node scripts/run-isolated-aerodrome-probe.js --mock-wallet --eip6963-only --diagnose-discovery --test-wallet-choice-fix --test-wallet-lifecycle --test-wallet-recovery-ui "--scenario=$scenario" || exit 1
done
```

Recovery mode requires the mock, EIP-only, discovery diagnostic, choice experiment and lifecycle flags. It creates a new extension-free Chromium profile containing keyless synthetic providers. Existing sessions and real wallet extensions are not attached. The panel is injected only into this explicitly enabled experiment.

## Remaining limitations

Removing a connector entry does not revoke wallet permission or uninstall an extension. [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) defines discovery announcement/request events; the removal/restoration fixture manipulates the pinned framework's list and is not a standardized uninstall event. The framework's internal mutation API is not a stable public integration contract. Rediscovery can recreate a duplicate, which requires another review; this change does not permanently suppress discovery.

Exact object equality is intentionally conservative. Different wrapper objects are not assumed to be the same provider, even if names or metadata match. Choice numbers and metadata do not authenticate publishers. Arbitrary malicious getters/providers, adversarial icons, real pending permission prompts, mobile, WalletConnect, extension lifecycle behavior and a full accessibility or independent security audit remain unverified. A late JavaScript result can be rejected without canceling an already dispatched permission request.

Official EIP-6963-only connectivity and deployment of the proposal remain unresolved. The earlier Phase 14 Chrome timeout remains unexplained. No real-wallet signing, trading, transfers, token approvals, liquidity additions, production deployment, upstream communication or game development was performed. Physical line counts remain a reference, not a safety or completion claim.
