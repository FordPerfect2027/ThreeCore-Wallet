# ThreeCore candidate review handoff — November 2, 2026

This is the current review starting point. The prior handoff mixed older source
pins and test totals under "current" headings; this revision replaces that
chronology with one source map. Historical evidence files remain unchanged.

Scope: the read-only ThreeCore Wallet and offline operation rehearsal, with
DAT, EMA and CAWELON checked separately. Signing, transactions, token approvals,
custody, swaps, bridges and autonomous spending are outside this candidate.
A 90% planning target is not an achieved release gate or a measured score.

The current standalone review package is
[`ThreeCore-review-128ee11-20261103.zip`](CONSOLIDATED_REVIEW_2026-11-03.md).
It contains the applied private helper repair in all three token sources and
the later 68-case decoder comparison and nine-record recovery evidence.
All four complete Git histories, 5,022 Wallet source files, 285 token source
files and 264 manifests / 2,903 evidence entries matched. The outer ZIP was
freshly extracted and all 29 listed files matched; an alteration control failed
as expected. Wallet implementation/test files are unchanged from the complete
regression below. No new full regression or live event pass is claimed.

The earlier standalone package is `ThreeCore-review-bf690f3-20261103-r1.zip`.
It includes the diagnostics, navigation recovery, evidence-checker repair and
all three token compatibility guards. All 42 outer files, 4,783 Wallet source
files and 258 evidence manifests / 2,676 entries matched. The clean restored
Wallet passed **16,470 Node/HTTP and 1,024 synthetic browser cases**. See the
[fixed-source regression and package record](FIXED_CANDIDATE_REGRESSION_2026-11-03.md).
The nine-record actual backup round trip retains its separate
[earlier live record](REVIEW_CONTINUATION_2026-11-03.md).
Older ZIPs remain fixed historical evidence. No GitHub publication occurred.

The later [old-source compatibility and history recovery check](LEGACY_HISTORY_RECOVERY_2026-11-03.md)
found that public checkpoint `07041f0` rejects current shared-account backups.
A separate history-view copy preserves all nine observations and is accepted by
both decoders; restoring the original configuration reproduces the original
bytes exactly. This is offline file recovery, not a completed browser rollback.

A later [private Zod 4 repair candidate](ZOD_MIGRATION_CANDIDATE_2026-11-03.md)
now passes clean installation, actual configuration validation, all three token
builds/type checks and artifact comparisons, plus DAT's 251 read-only cases.
The repair is now [committed and installed in all three local token projects](ZOD_APPLIED_2026-11-03.md).
Each applied environment passes the targeted regression, forced compilation,
type check and dependency-graph check, with zero findings in its dated full
audit. The earlier shared-directory installation error was repaired and final
checks rerun. These supplements are outside the sealed Wallet ZIP and do not
close live-wallet or independent-review gates.

The [later pure-decoder comparison](HELPER_DECODER_COMPATIBILITY_2026-11-03.md)
adds 68 input fixtures in each actual token installation. Acceptance, decoded
values and error paths match upstream helper 3.0.8; three standard message
differences are recorded. The [fresh-tab recovery](LIVE_RECOVERY_2026-11-03.md)
also restored and re-exported the actual nine records byte-for-byte at port
4233. That origin still required Wallet permission; no new live-switch pass
is inferred from file restoration.

The [later Account 1 follow-up](LIVE_RECOVERY_2026-11-03.md#later-account-1-permission-and-connection-confirmed)
now confirms permission and three explicit Mainnet connections at 4233, with
all nine original histories retained in a validated export. After a reported
site-network change, the controlled page still returned/rendered Mainnet and
completed a native-balance read. The requested Sepolia change was not observed;
live switch-event acceptance remains open. Subsequent page-hidden and inactivity
protection stops retained all nine histories in byte-identical, validated exports.
The later photograph and [foreground-tab recovery](LIVE_RECOVERY_2026-11-03.md#foreground-tab-alignment-and-recovery--1320-jst)
confirmed that the user had been viewing Edge's Extensions page with MetaMask's
asset-network filter. The visible Wallet is now identified and has all nine
records restored, with a verified browser-local checkpoint and identical export.
Its provider still returns Mainnet. The current dependency is comparing the
actual MetaMask site panel with that visible Wallet, without blindly repeating
the already reported network-selection or permission steps.

The latest local implementation is the [navigation recovery improvement](NAVIGATION_RECOVERY_2026-11-03.md)
at `f6f378c`: 62 server/security cases and actual Edge navigation passed.
The original permitted origin was recovered through the rehearsal page, three
Account 1 / Sepolia reads completed at block 53,572,089, and a nine-record backup
was verified. The prior [connection-stop diagnostic improvement](CONNECTION_STOP_DIAGNOSTICS_2026-11-03.md)
at `856f670` passed 453 targeted Node cases and 1,024 synthetic browser cases.
Live switch-event invalidation remains separately unverified.
The [latest full fixed-source regression](FIXED_CANDIDATE_REGRESSION_2026-11-03.md)
at `bf690f3` includes both changes and the later checker/test fixes. Public CI
still applies only to its older published head; local results are not remote CI.

## Exact source map

| Item | Fixed revision | What it establishes |
| --- | --- | --- |
| Earlier bounded code-review checkpoint | `529772807f32e637f19a26853d8a209482fa2f55` | Source, reconstruction evidence and actual-context acceptance receipt before this handoff correction |
| Latest Wallet implementation | `f6f378cc9b44f33fc7e147f4626e23573de06a6c` | Explicit same-origin entry-guide link; 62 server/security cases and actual Edge recovery passed; controller diagnostics remain at `856f670` |
| Latest complete Wallet regression | `bf690f38b070362aab1369fbf22c8e68b1a6567f` | Restored standalone package: 16,470 Node/HTTP and 1,024 synthetic browser passes on unchanged source |
| DAT | `dc2535732e9b83bddd8c5f4a2208c65fdff0a6d1` | Earlier empty-data fix plus applied private Zod 4 helper repair; contract bytes unchanged |
| EMA | `cae4130e8e01fd325fdcb6a589a46338be08b27e` | Earlier empty-data fix plus applied private Zod 4 helper repair; contract bytes unchanged |
| CAWELON | `9fc0ffa988f5b9a80d75d7f95b80e6a759f1610d` | Earlier empty-data fix plus applied private Zod 4 helper repair; contract bytes unchanged |
| Public PR #4 head | `07041f00efdb503cb76a06fbe12e5531cb380930` | Earlier public source only |

All three token working trees were clean when this source map was checked.
The [saved checkpoint receipt](evidence/2026-11-02-release-regression/candidate-review-scope.json)
records 17 changed implementation files at `5297728` and their content digests.
It predates the later CSS and site-specific guidance changes listed here.
New documentation commits do not alter the implementation/regression pins above.

The [later toolchain repair](TOOLCHAIN_EMPTY_DATA_2026-11-02.md) replaces the token
pins from the source-portability checkpoint. The prior decoder converted empty
RPC data into a zero byte. The first upgrade failed because the lock retained an
old helper; the corrected lock and final decoder regression passed, including
a separate clean installation. Each token's full standard-check components and
50 Wallet compatibility cases passed. All three ABI and complete creation/runtime
bytecodes match their parents. The prepared local workflow uses the new token
pins; the public PR and its earlier CI results remain unchanged. This does not
itself resolve the separate Zod advisory; the applied repair above is later.
Neither toolchain result closes actual-wallet/independent-review gates.

The [latest network-label clarification](LIVE_ACCEPTANCE_2026-11-02.md#requested-network-and-observed-network-distinguished)
at `8fa0ed2` displays the card's requested network alongside the network returned
by MetaMask. Actual Edge checks confirmed mismatched and matched states and
the existing apply restriction; 69 existing cases passed. The original six
records and both running servers were preserved. This display-only change
does not establish live network-switch invalidation or rerun full regression.

The earlier one-line origin display at `dfc0746` was observed in a separate empty
Edge tab for all three cards; 58 existing account/setup-panel cases passed.
The fixed `f52109a` candidate archive and completed migration exercise predate
this display addition. The [network-switch target follow-up](LIVE_ACCEPTANCE_2026-11-02.md#network-switch-target-follow-up)
records that MetaMask still returned Sepolia for port 4231 after the operator
reported switching to Base. The operator subsequently confirmed port 4231;
fresh-page permission reads still returned Sepolia. No live switch-event pass
or handler defect is inferred from that mismatch.

The later CSS-only change prevents permitted-account details overflowing narrow
cards. Actual Edge display confirmed the full address within a 296px element,
with `scrollWidth === clientWidth`. The existing tab was preserved and separate
empty validation tabs were closed. Its actual permission read still reported
Base Mainnet and one permitted account; this does not close the requested
Sepolia or account-switch gate. See the [layout receipt](evidence/2026-11-02-release-regression/account-probe-layout-summary.json).
At that point the full regression predated this CSS-only change; that original
record is an actual layout check. The later full regression at `2126019` now
includes this source without replacing the earlier layout receipt.

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
Those fixed-checkpoint counts exclude the later changes at `307ed11`,
`7c12a28`, `dfc0746` and `8fa0ed2`; inspect those commits as well when reviewing the latest candidate.

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

- [Latest complete regression](FIXED_CANDIDATE_REGRESSION_2026-11-03.md): 16,470 Node/HTTP
  and 1,024 synthetic browser passes from the clean restored `bf690f3` package.
  The [earlier native-crypto test correction](NATIVE_CRYPTO_TEST_WAIT_2026-11-02.md)
  and its original failure remain separately recorded.
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
  The later [compatible private candidate](ZOD_MIGRATION_CANDIDATE_2026-11-03.md)
  includes the helper source repair, clean installation, full-plugin checks
  and three token patches. The [applied follow-up](ZOD_APPLIED_2026-11-03.md)
  records final verification and the local commits in the source map above.

Checksums establish byte consistency, not provenance, current chain state,
token safety or independent approval. Private account backups and screenshots
remain in their documented local Downloads folders. Redacted summaries cannot
replace those originals when a reviewer needs to recheck an actual observation.

## Packages and reproduction

The earlier **Wallet source candidate** is
`ThreeCore-candidate-f52109a-20261102.zip`, source
`f52109a3a5d25665667b19b811584e33da035d15`, 29,172,809 bytes, SHA-256
`db16c2523aa7477cf0279b58def2a5010fb579a007b2df255e9fc7db524894a0`.
All 4,658 exported files / 126,215,683 bytes matched the fixed Git source.
It starts in ordinary mode on the separate loopback port 4232. Eight startup
checks passed, and its own readers accepted the actual Mainnet, Sepolia and
fictional rehearsal backups without modifying them. It includes the guidance
and Sepolia receipt available at that fixed revision. This source archive is separate from the
older combined Wallet/token review package below.

The [migration preparation receipt](evidence/2026-11-02-release-regression/candidate-f52109a-migration-preparation.json)
records the preparation scope. The later [completed migration and return](LIVE_ACCEPTANCE_2026-11-02.md#fixed-candidate-migration-and-return-completed)
now covers actual MetaMask permission, three new Sepolia reads, six retained
Wallet records, explicit reconnection at the original origin, and byte-identical
7,237-byte candidate/return exports. The rehearsal also restored six fictional
records and three cases into the candidate and a new original-origin tab;
all three 17,387-byte session files match exactly. Both original PID 2108 /
port 4231 and candidate PID 28252 / port 4232 retained their recorded start times.
This closes the scoped candidate migration/return exercise. Return used the
preserved development server with current client files, not a separately pinned
older public release. Actual account/chain-switch invalidation remains open.
No browser protection was changed.

The earlier standalone combined review package in Downloads is
`ThreeCore-review-2126019-20261102.zip`, 51,127,612 bytes, SHA-256
`a938e26ed7c572962c32decf0cc452654caeed58f5514be9ae41418c9ad605ea`.
It contains Wallet source `212601977bc6dad8da298f11ebb9e7a421052571` and the
three earlier token revisions recorded in its dated distribution receipt.
Complete history and
source archives for all four repositories were restored into new directories.
The package's `START_HERE.txt` and `package-receipt.json` are the entry points;
`node verify-package.mjs` checks all 31 files after extraction. See the
[historical distribution record](DISTRIBUTION_CHECKPOINT_2026-11-02.md#earlier-combined-review-package-2126019).
It needs no earlier ZIP or supplement. Packaging did not rerun full regression
or close any real-wallet, dependency-security or independent-review gate.

The earlier full distribution in Downloads is
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
| Actual account and chain switching | Observe existing MetaMask accounts switching and Base Mainnet/Sepolia changes; verify invalidation, explicit reconnect and preserved records | Separate Account 1/Mainnet, Account 1/Sepolia and Account 2/Sepolia sessions passed. The later 4233 Account 1/Mainnet session connected all three cards with nine original histories. After a reported change, that page still rendered/read Mainnet. Page-hidden/inactivity stops and unchanged nine-record exports were observed separately; the requested new chain and live switch-event invalidation remain unobserved |
| Older immutable release rollback, if required for release | Exercise the final deployment's pinned previous-release rollback plan | Candidate `f52109a` migration and return to the preserved development server now passed for Wallet and rehearsal. That server serves current client files. Offline follow-up found public checkpoint `07041f0` rejects shared-account backups; a nine-record history-only recovery copy is verified, but browser rollback to a public release is not |
| Native OS file-selection path | Select and cancel through the original profile's Windows file picker, then verify actual imported bytes | Supported browser filechooser and real files passed; native picker traversal was not exercised |
| Development dependency release review | Independently review the applied private helper fork and approve its maintenance/release scope | The affected Zod version is replaced in all three local installations; final builds/types, dependency graphs, exact bytecode comparisons and dated full audits pass. Transaction-executing suites were not rerun; independent review and release approval remain open |
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
