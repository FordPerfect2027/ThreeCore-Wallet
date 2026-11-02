# ThreeCore candidate review handoff — November 2, 2026

This is the current review starting point. The prior handoff mixed older source
pins and test totals under "current" headings; this revision replaces that
chronology with one source map. Historical evidence files remain unchanged.

Scope: the read-only ThreeCore Wallet and offline operation rehearsal, with
DAT, EMA and CAWELON checked separately. Signing, transactions, token approvals,
custody, swaps, bridges and autonomous spending are outside this candidate.
A 90% planning target is not an achieved release gate or a measured score.

## Exact source map

| Item | Fixed revision | What it establishes |
| --- | --- | --- |
| Inspected local evidence checkpoint | `529772807f32e637f19a26853d8a209482fa2f55` | Source, reconstruction evidence and actual-context acceptance receipt before this handoff correction |
| Latest Wallet implementation | `7c12a280649ee56d52165d9412db3af4c5bd4770` | Site-specific MetaMask guidance and earlier address wrapping; the last RPC behavior change remains the inclusive range correction at `96b5945` |
| Latest complete Wallet regression | `e5841f0d1b412b516b3e3eb4a81d75eabaf81edd` | 16,454 Node/HTTP and 1,021 synthetic browser passes; later test-only drain-wait fix included |
| DAT | `502944c94ffed408356b487abc9a710807697ee2` | Current checked local token source |
| EMA | `9cad39a196e8afc37abb5b99c260e00327c55d1c` | Current checked local token source |
| CAWELON | `e3a5fbb966008319b7b7204ddbfb705a3e9ab12c` | Current checked local token source |
| Public PR #4 head | `07041f00efdb503cb76a06fbe12e5531cb380930` | Earlier public source only |

All three token working trees were clean when this source map was checked.
The [saved checkpoint receipt](evidence/2026-11-02-release-regression/candidate-review-scope.json)
records 17 changed implementation files at `5297728` and their content digests.
It predates the later CSS and site-specific guidance changes listed here.
New documentation commits do not alter the implementation/regression pins above.

The later CSS-only change prevents permitted-account details overflowing narrow
cards. Actual Edge display confirmed the full address within a 296px element,
with `scrollWidth === clientWidth`. The existing tab was preserved and separate
empty validation tabs were closed. Its actual permission read still reported
Base Mainnet and one permitted account; this does not close the requested
Sepolia or account-switch gate. See the [layout receipt](evidence/2026-11-02-release-regression/account-probe-layout-summary.json).
The full regression predates this CSS-only change; the new evidence is the actual
rendered layout check, not another full regression run.

The later copy-only change at `7c12a28` explains MetaMask's site-specific account
permissions and network selection, separately from its asset display. Existing
permitted-account, card-controller and connection-boundary suites passed all
82 cases. RPC dispatch, permission requests and identity checks did not change.
The later actual Edge session displayed the new guidance and completed Account
2 / Base Sepolia reads, file restore and reconnection at source `8e5079d`.
See the [successful Sepolia follow-up](LIVE_ACCEPTANCE_2026-11-02.md#account-2--base-sepolia-successful-follow-up), the earlier
[site-context follow-up](LIVE_ACCEPTANCE_2026-11-02.md#metamask-site-context-and-guidance--afternoon-follow-up)
and [Japanese operator steps](OPERATOR_ACCEPTANCE_JA.md#metamaskで切り替えたのにthreecoreへ反映されない場合).

The [public PR](https://github.com/FordPerfect2027/ThreeCore-Wallet/pull/4) was
rechecked through unauthenticated GitHub GET requests on November 2. It is open
and draft at the head shown above. All five jobs in
[run 41311235726](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/runs/41311235726)
completed successfully at that same head. Their older token pins are retained
in the [raw receipt](evidence/2026-11-02-release-regression/public-pr4-recheck.json).
Those results do not cover the new local token pins or subsequent Wallet work.
Publication remains deferred for the operator's combined update.

## Changes to inspect

Relative to the public head, the inspected local checkpoint changes **17 files,
123 added and 54 deleted lines** in src, examples and scripts. CI, tests,
documentation and the evidence newline policy are additional, separate changes.
Those fixed-checkpoint counts exclude the later changes at `307ed11` and
`7c12a28`; inspect those two commits as well when reviewing the latest candidate.

| Change | Source starting points | Review question |
| --- | --- | --- |
| Compare a verified backup with current full contents | `examples/workspace-panel.js`, `src/workspace-overview.js` | Can cancellation, edited input or extra retained observations cause a false match? |
| Keep accepted transfer archives through Stop/context changes | `src/transfer-archive-controller.js`, `examples/transfer-archive-panel.js`, `examples/transfer-panel.js` | Are pending previews cancelled while accepted records remain exportable under their original identity? Can different identities mix? |
| Recognize a saved-list backup and show its correct restore control | `src/file-read-status.js`, `examples/file-read-panel.js`, `examples/transfer-vault-panel.js`, `examples/wallet-demo.js`, `scripts/inspect-wallet-saved-file.js` | Does strict collection validation run before guidance? Does navigation avoid automatic import, storage writes or provider requests? |
| Allow existing accounts to serve multiple token cards | `src/wallet-setup.js`, `src/wallet-setup-file.js`, `src/workspace-format.js`, `src/workspace-file.js`, `src/workspace-overview.js`, the setup/workspace/demo panels and `examples/index.html` | Are histories still token-specific? Are distinct addresses counted honestly? Are permission and invalidation checks unchanged? |
| Enforce the inclusive history window at dispatch | `src/security-rpc.js` | Does 2,000 pass and 2,001 fail before either the wallet provider or local HTTP relay sends an upstream request? |

The bounded developer review inspected all changed implementation lines, related
controller/transport context and selected existing regression assertions. No
additional implementation defect was established by that inspection. It found
the stale handoff pin and missing range-change review entry corrected here.
This is not an independent audit or a review of every unchanged source line.

Review the capability boundaries across the complete candidate:

| Boundary | Source starting points | Required evidence |
| --- | --- | --- |
| Permission and identity | `src/wallet-session.js`, `src/provider-registry.js`, `src/provider-event-gate.js` | Explicit permission, bounded requests and stale-read invalidation; saved files never restore permission |
| Read-only dispatch | `src/security-rpc.js`, `src/base-state-provider.js` | Method/parameter guards remain on every route; writes and signing are rejected before dispatch |
| Local HTTP and transport | `examples/security-http.js`, `examples/dev-server.js`, `examples/base-state-rpc.js`, `src/state-rpc-http.js` | Exact local origin, no embedded access, bounded response bytes/deadlines, aborted/late result suppression |
| Input and recovery | `src/security-file.js`, `src/file-read-service.js`, `src/security-json.js`, `src/transfer-vault-collection.js` | Delayed callbacks cannot revive cancelled input; explicit restore preserves required originals |

Relevant assertions are in the security-RPC, base-state HTTP, shared-account,
workspace comparison, archive-retention, saved-vault-collection, provider-event
and browser UI suites. Review assertions and scope, not just passing totals.

## Evidence already available

- [Complete regression](NATIVE_CRYPTO_TEST_WAIT_2026-11-02.md): 16,454 Node/HTTP
  and 1,021 synthetic browser passes. The initial one-test failure and test-only
  wait correction are retained. These are not new reruns for this handoff.
- [Token source and test routing](SOURCE_PORTABILITY_2026-11-02.md): all three
  current builds, source/routing and local history/Wallet compatibility checks
  passed. DAT also passed its full standard check. Earlier read-only totals
  overlap and must not be summed into a feature count.
- [Actual Mainnet acceptance](LIVE_ACCEPTANCE_2026-11-02.md): three cards sharing
  one existing MetaMask account, saved-file restore, explicit reconnect, pending
  read Stop and byte-identical histories. The later real-provider checks reject
  wrong card account/network settings; they do not switch MetaMask itself.
- [Actual Sepolia acceptance](LIVE_ACCEPTANCE_2026-11-02.md#account-2--base-sepolia-successful-follow-up): all three cards on
  existing Account 2, three identity files, one saved portfolio observation per
  card, actual chooser import and restoration after a DAT token-list edit,
  Stop/resume and explicit three-card reconnect. The two 4,371-byte exports
  match exactly; the four prior Mainnet backups remain unchanged. This is one
  account and a same-tab restore, not live switch-event or server-migration proof.
- [Actual-file recovery](ACTUAL_FILE_RECOVERY_2026-11-02.md): distinct saved
  collections and complete workspaces restored in isolated native storage,
  including browser restart and a byte-identical download.
- [Source reconstruction](DEPLOYMENT_SOURCE_RECONSTRUCTION_2026-11-02.md): all
  six complete runtime byte comparisons now match, including recovered DAT
  Mainnet source and its final-newline difference. Mainnet initial creation/
  issuance was checked for three tokens; EMA and CAWELON also have exact Sepolia
  creation/issuance replays. All three complete Mainnet creation inputs match.
- [Reproducible distribution](DISTRIBUTION_CHECKPOINT_2026-11-02.md): the fixed
  full Wallet/token package and its fresh checkout, startup and ZIP receipts.
- [Development dependency review](ZOD_EXPOSURE_2026-11-02.md): the remaining
  Zod finding and bounded exposure analysis. The incompatible forced-major
  upgrade is documented in [the compatibility record](ZOD_COMPATIBILITY_2026-11-02.md).

Checksums establish byte consistency, not provenance, current chain state,
token safety or independent approval. Private account backups and screenshots
remain in their documented local Downloads folders. Redacted summaries cannot
replace those originals when a reviewer needs to recheck an actual observation.

## Packages and reproduction

The full distribution in Downloads is
`ThreeCore-review-23d0a35-20261102.zip`:
50,030,551 bytes, SHA-256
`31a88b5c015fd4adb71100d8b66fb8fd06b4eae5ad14defd868e76ce9d80aadc`.
Its source pin is `23d0a35b129c32be581bf1a3ffad57e228b9b65c`.
It includes the implementation/regression above, but predates the additional
source-reconstruction and live-context receipts.

The current standalone compiler/replay kit is
`ThreeCore-source-verification-complete-f7aaec1-20261102.zip`:
445,316 bytes, SHA-256
`7c77c4abd74f8067940057c48c2175de07f9560c4bf310afabf57e11a48f0b3b`.
It pins `f7aaec1e7179324bb9dcb7d8efb17b6414b5dcf9` and includes the complete
DAT Mainnet source recovery. Its four relocated offline checks passed and all
30 package manifest entries matched after fresh extraction. The previously
verified compiler installation was reused; dependency versions were unchanged.

The earlier additional standalone compiler/replay kit is
`ThreeCore-source-verification-9838e5b-20261102-final.zip`:
358,656 bytes, SHA-256
`867bef2f9a75fc3807c19c48f786d780403b4acc59ccd79e43249cb8330d7161`.
It pins source `9838e5ba1b097fa998cb95d36f8d7fec4834143d`. Its three offline
checks passed with a fresh 21-package compiler installation and fresh npm cache.
The initial dependency installation needs npm access; the checks use saved
observations without RPC or a wallet. This profile's clean dated audit does not
clear the affected full development environment.

Restore the full distribution's bundle in a new directory, without a remote:

```powershell
git init threecore-review
git -C threecore-review fetch ../ThreeCore-Wallet-review.bundle HEAD
git -C threecore-review checkout --detach FETCH_HEAD
git -C threecore-review rev-parse HEAD
```

Adjust the bundle path and compare HEAD with its package receipt. Do not assume
this older bundle contains additions made after its pin. From the review checkout:

```powershell
node scripts/verify-evidence-collection.js .
node docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs
npm run test:wallet
node scripts/test-browser-ui.js
```

The browser suite uses disposable profiles and synthetic providers, with no
real wallet or external RPC. Evidence collection requires a Git index; individual
manifests can be checked in a plain extraction with
`node scripts/verify-evidence-manifest.js <manifest-path>`.
For the additional offline compiler checks, use the standalone kit's README or
the source-reconstruction document. Do not install full development dependencies
merely to perform those saved-data checks.

Use an unused loopback port for any candidate-server exercise. Preserve the
original 4231 process and unsaved tabs. A different port has separate browser
storage and wallet permission. Follow the
[operator guide](OPERATOR_ACCEPTANCE_JA.md) and
[version-return procedure](SOURCE_CHECKPOINT_2026-11-01.md#preparing-and-returning-to-a-known-version).
Do not clear the user's database or reload their working tab to create a test.

## Remaining release evidence

| Open item | Evidence needed to close it | Current limit |
| --- | --- | --- |
| Actual account and chain switching | Observe existing MetaMask accounts switching and Base Mainnet/Sepolia changes; verify invalidation, explicit reconnect and preserved records | Separate Account 1/Mainnet and Account 2/Sepolia sessions now passed. The operator changed context after the prior session stopped; live switch-event invalidation remains unobserved |
| Complete candidate migration and return | Start the fixed candidate separately, restore actual saved files, reconnect and return to the preserved working version with records intact | Export/startup and offline format/native-storage checks passed; real-wallet migration/return is open |
| Native OS file-selection path | Select and cancel through the original profile's Windows file picker, then verify actual imported bytes | Supported browser filechooser and real files passed; native picker traversal was not exercised |
| Development dependency finding | Compatible remediation with applicable regression, or an explicit qualified release risk decision | One Zod root advisory remains; the forced patched major breaks an unchanged helper |
| Independent review and release | Review the exact final scope, resolve findings, approve the deployment plan and release explicitly | No independent reviewer has completed or approved this candidate |

The original server was not restarted; its old imported server modules are not
a demonstration of the complete candidate. Current native browser automation
cannot establish Edge's URL reliably for extension control. Preserve that
limitation instead of bypassing browser protections.

The DAT Mainnet metadata comparison was closed by the later Sourcify-input
recovery and local compilation against the separately recorded RPC bytes.
This closes that developer verification item, not the independent-review gate.
The full Wallet distribution and the older 9838e5b kit predate this follow-up;
their source pins and earlier results remain unchanged. The f7aaec1 source kit
includes the complete comparison.

For every finding, record the exact commit, affected path, trigger, expected and
observed behavior, evidence, impact, proposed fix and retest status. Do not count
time spent, the old 600-item list or repeated tests as release completion.
