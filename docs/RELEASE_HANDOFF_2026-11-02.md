# ThreeCore candidate review handoff — November 2, 2026

## Overall development target — confirmed November 3

The user explicitly confirmed that the provisional 90% target covers Token,
Wallet, AI and dApp together. The [whole-project scope and next implementation
sequence](WHOLE_PROJECT_SCOPE_2026-11-03.md) separates the completed read-only
capabilities from the missing product integration. A local Wallet delivery does
not complete that broader goal. Continue implementation without waiting for
funded accounts or repeating completed live connection exercises.

## Active development beyond the sealed package — November 3

The [fixed simulation-input builder](PROPOSAL_SIMULATION_PLAN_2026-11-03.md)
now derives unsigned Classic Router call data from the entire validated source
chain and the earliest expiry. Its offline command and saved replay passed all
27 related checks; four synthetic ABI encodings matched viem independently.
Historical Account 2 insufficiency correctly yields no call data. Gas estimation
and EVM simulation are still the next implementation, not completed by this
input builder. Keep the complete-goal active and use existing isolated runtimes.

The [proposal/allowance workflow](PROPOSAL_ALLOWANCE_2026-11-03.md) now binds
public canonical allowance reads to saved proposals and quotes, including USDC
buying and project-token selling. The screen supports read, cancellation,
source-preserving save, recorded replay and current recheck. All 47 related
checks passed. Real Account 2 evidence at block 53,457,078 shows zero USDC
allowance/balance and the correct 1 USDC example shortfall; three browser
downloads were verified. Next: transaction-specific fee/preflight and isolated
execution. The provisional whole-project view remains around 70%, not 90%.

The [manual proposal authoring screen](MANUAL_PROPOSAL_DRAFT_2026-11-03.md)
now creates proposal/condition review files directly from verified saved budget
evidence. Related checks pass 37/37. Actual browser files reproduce pass,
over-limit and insufficient-budget results; reimport/recheck preserves all source
texts and expiry. This completes manual authoring and the existing review handoff,
not AI generation or execution authority. Next: bind existing allowance records
to proposals/quotes, then fee/execution preflight. Prioritize reuse of completed
readers and review models instead of repeating live wallet connection exercises.

The [USDC acquisition screen](USDC_READ_UI_2026-11-03.md) completes ordinary
browser read/cancel/save and budget handoff. All 55 related checks passed,
including 10 new feature checks. Actual public results match the earlier command
at the same block, apart from acquisition time. The downloaded source was used
in the budget screen. Next short completion: proposal/conditions input and file
flow using the existing strict review model; no user-wallet transaction is needed.

The [USDC budget integration](USDC_BUDGET_2026-11-03.md) now supports
individual and shared spending, canonical public USDC/ETH observations,
source-preview transfer, evidence comparison and USDC-funded buy proposals.
Four actual browser downloads/reexports matched their prepared inputs exactly.
Public Account 2 held 0 USDC and 0.0007 ETH at the recorded block; the example
budget correctly failed while its source comparison passed. Final focused
checks passed 43/43 and HTTP checks 7/7. The user explicitly deferred AI
connection and requested completing short, near-finished features first.
Next: public USDC acquisition screen, then the existing-file workflow.
See the updated whole-project scope for the order and the provisional 65% view.

The [public quote acquisition screen](AERODROME_QUOTE_UI_2026-11-03.md) now
provides `/quotes/` through a bounded same-origin endpoint, exact decimal input,
cancel-on-change and quote-file download. All 56 related checks passed.
Normal-browser DAT sell, EMA buy and CAWELON buy at block 53,457,078 are recorded
separately from synthetic UI tests. Next independent work is USDC spending
budgets, gas/allowance binding and isolated execution. The user has since
deferred AI connection; do not repeat the credential question.

The [proposal/quote screen and archive](PROPOSAL_QUOTE_UI_2026-11-03.md)
adds offline `/proposals/quote/`, exact source/limit preservation, recorded-time
replay and current-time recheck. Related tests passed 48/48. Four actual browser
downloads were recomputed; pass, over-limit and expiry used synthetic inputs,
while a fourth deliberately paired a live quote with an unrelated synthetic
proposal and rejected its amount/block/time mismatches. Quote acquisition was
subsequently connected to the public screen described above.

The [Aerodrome proposal quote integration](AERODROME_PROPOSAL_QUOTE_2026-11-03.md)
now obtains canonical single-pool buy/sell quotes for all three agents, compares
Pool and Router results with reserve/fee arithmetic, and binds saved quotes to
current proposal conditions and the original budget block. Live reads saved
eight valid observations plus two expected zero-output rejections. Final
feature/proposal tests passed 38/38; the overlapping public-reader regression
passed 167/167. USDC spending budgets and isolated execution remain
unfinished at that checkpoint. USDC budgets are completed above. Product AI
authentication is deferred at the user's request; independent non-AI development
continues without another credential question.

The [proposal comparison foundation](OPERATION_PROPOSAL_REVIEW_2026-11-03.md)
now binds imported proposals to exact budget evidence, account/network/token,
dApp origin and contract, amount limits and time windows. It includes an offline
command, a local screen and source-preserving saved-result verification.
All 25 feature and 207 related tests passed; actual browser downloads reproduced
success, expiry and over-limit results using explicitly synthetic data.
This follow-up is not in the sealed `cd7f7ed` ZIP. Actual product AI generation,
USDC budgets and isolated execution integration are the next missing work.

The [integrated public-reading and budget delivery](INTEGRATED_PUBLIC_BUDGET_DELIVERY_2026-11-03.md)
now pins `cd7f7ed`, passes 16,585 Node/HTTP and 1,026 synthetic browser cases,
and restores all four source projects from one ZIP. Fresh ordinary startup and
actual Wallet, rehearsal and budget-source file returns passed. This is the
latest local package; the preceding `4dfa300` package remains unchanged.

The user requested continued development toward the broader 90% planning target.
The earlier package and recovery checkpoint did not complete that goal.
The [new budget screens](OPERATION_BUDGET_2026-11-03.md) add separate token/ETH
calculations and shared-account fee totals, with 683 related checks and actual
save/restore/re-export evidence. The later [saved-observation comparison](OPERATION_BUDGET_EVIDENCE_2026-11-03.md)
adds original-record linkage, 920 related checks and actual historical-file
match/mismatch evidence. Neither feature verifies current chain balances.
The subsequent [same-block public acquisition](PUBLIC_TOKEN_BATCH_2026-11-03.md)
now works through a bounded reader and command, with live Sepolia/Mainnet evidence,
1,058 related checks and browser file recovery. The subsequent
[on-screen acquisition and balance transfer](PUBLIC_TOKEN_BATCH_UI_2026-11-03.md)
adds explicit read/cancel/save, exact account/network/block binding, an origin-bound
HTTP boundary and preview-before-apply balance transfer into a budget. Actual
Sepolia/Mainnet UI files match the earlier command results byte-for-byte.
Signing, sending and secret access remain excluded; GitHub publication is
still deferred. The previously sealed package is unchanged and excludes this work.

## Earlier consolidated delivery — November 3, source 4dfa300

Start with the [current delivery and completion record](ACCOUNT_REFRESH_DELIVERY_2026-11-03.md).
`ThreeCore-complete-4dfa300-20261103.zip` contains the corrected Wallet and all
three token projects in one package. Fresh extraction verified 62 entries;
the supplied single command restored all four exact source trees. Its contents
include the account-input correction and completed developer review below.
The older package records retain their historical scope and unchanged bytes.
The [final startup and recovery supplement](FINAL_STARTUP_RECOVERY_2026-11-03.md)
also confirms ordinary startup from the restored package and an actual in-app
browser file return through fixed versions `4dfa300` → `36ed431` → `4dfa300`,
preserving all nine histories byte-for-byte.

## Earlier Wallet correction — November 3, source 7bdb23d

The implementation recorded in this section is `7bdb23d3398e1e92582a602bb22f06d364825412`.
It fixes stale configuration and backup-state summaries after applying a
permitted account. Read the [finding, correction and validation record](ACCOUNT_INPUT_REFRESH_2026-11-03.md)
alongside the earlier review. The corrected source passed 16,470 Node/HTTP and
1,026 synthetic browser cases. An actual Edge permission-input exercise confirmed
both display changes, and fixed-version restoration/export preserved all nine
histories byte-for-byte. Original servers and user tabs were preserved.

## Developer-review follow-up — November 3

The user assigned the technical review to Codex. That bounded review is now
[complete](DEVELOPER_REVIEW_2026-11-03.md): 250 selected Wallet checks passed,
and all three token environments passed the 14-case toolchain command, including
six new grouped tests of the actual Hardhat configuration validators. Token
changes add regression coverage and correct the maintenance record; contracts,
helper archive and dependency pins are unchanged. The current source-change
map is [recorded here](evidence/2026-11-03-developer-review/source-changes.json).
The local workflow points to those new token commits for later publication.

The [incremental delivery and recovery check](DEVELOPER_UPDATE_DELIVERY_2026-11-03.md)
restored all four updated source versions and preserved the actual nine-record
backup byte-for-byte across new/base/new decoders.

Requester/reviewer assignment is not a blocker to continuing development.
Independent third-party approval is not claimed. The sealed b7df758 package
remains unchanged; these changes are a follow-up for consolidated delivery.


This is the current review starting point. The prior handoff mixed older source
pins and test totals under "current" headings; this revision replaces that
chronology with one source map. Historical evidence files remain unchanged.

Scope: the read-only ThreeCore Wallet and offline operation rehearsal, with
DAT, EMA and CAWELON checked separately. Signing, transactions, token approvals,
custody, swaps, bridges and autonomous spending are outside this candidate.
A 90% planning target is not an achieved release gate or a measured score.

The earlier standalone review package is
[`ThreeCore-review-b7df758-20261103.zip`](CONSOLIDATED_REVIEW_2026-11-03.md#latest-handoff-live-switches-and-complete-local-token-simulation).
It pins `b7df758`, includes the actual network/account-switch observations and
complete local token simulations, and supplies an actionable
[independent-review brief](REVIEW_BRIEF_2026-11-03.md).
All four histories were restored without remotes; 5,060 Wallet files, 285 token
files, 269 evidence manifests / 2,933 entries and all 32 outer package files
matched. Fresh extraction and an alteration-detection control passed. No
independent approval or percentage follows from packaging.

The earlier standalone review package is
[`ThreeCore-review-128ee11-20261103.zip`](CONSOLIDATED_REVIEW_2026-11-03.md).
It contains the applied private helper repair in all three token sources and
the later 68-case decoder comparison and nine-record recovery evidence.
All four complete Git histories, 5,022 Wallet source files, 285 token source
files and 264 manifests / 2,903 evidence entries matched. The outer ZIP was
freshly extracted and all 29 listed files matched; an alteration control failed
as expected. Wallet implementation/test files are unchanged from the complete
regression below. The sealed ZIP predates the live-switch supplement below;
no new full regression is claimed.

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

The later [local token simulation](TOKEN_SIMULATION_2026-11-03.md) closes the
missing functional regression after the helper repair: 115 existing contract
cases and 30 local history cases passed with the actual final token installations.
Only disposable simulator accounts were used. Complete artifact files and clean
source trees are unchanged; independent helper review remains open.

The [later pure-decoder comparison](HELPER_DECODER_COMPATIBILITY_2026-11-03.md)
adds 68 input fixtures in each actual token installation. Acceptance, decoded
values and error paths match upstream helper 3.0.8; three standard message
differences are recorded. The [fresh-tab recovery](LIVE_RECOVERY_2026-11-03.md)
also restored and re-exported the actual nine records byte-for-byte at port
4233. That origin still required Wallet permission; no new live-switch pass
is inferred from file restoration.

The [Account 1 follow-up](LIVE_RECOVERY_2026-11-03.md#later-account-1-permission-and-connection-confirmed)
and [foreground-tab recovery](LIVE_RECOVERY_2026-11-03.md#foreground-tab-alignment-and-recovery--1320-jst)
established the actual visible Wallet and preserved all nine histories after
earlier attempts had changed only MetaMask's asset-list filter. The later
[live-switch exercise](LIVE_RECOVERY_2026-11-03.md#actual-network-and-account-changes--13251335-jst)
now confirms Mainnet-to-Sepolia invalidation, then Account-1-to-Account-2
invalidation at 4233. All three cards stopped with the respective wallet-change
reasons, the new context was read from the provider, and explicit reconnection
was required. Before/immediately-after downloads match byte-for-byte for each
change. Nine original histories survived both reconnections unchanged. Six new
read-only observations are saved separately: Account 1 at Sepolia block
53,791,215 and Account 2 at 53,793,042. This is one observed direction for each
change in one existing profile, not a live in-flight race or independent review.

The earlier local implementation includes the [navigation recovery improvement](NAVIGATION_RECOVERY_2026-11-03.md)
at `f6f378c`: 62 server/security cases and actual Edge navigation passed.
The original permitted origin was recovered through the rehearsal page, three
Account 1 / Sepolia reads completed at block 53,572,089, and a nine-record backup
was verified. The prior [connection-stop diagnostic improvement](CONNECTION_STOP_DIAGNOSTICS_2026-11-03.md)
at `856f670` passed 453 targeted Node cases and 1,024 synthetic browser cases.
Live switch-event invalidation is covered by the scoped later exercise above.
The [latest full fixed-source regression](FIXED_CANDIDATE_REGRESSION_2026-11-03.md)
at `bf690f3` includes both changes and the later checker/test fixes. Public CI
still applies only to its older published head; local results are not remote CI.

## Exact source map

| Item | Fixed revision | What it establishes |
| --- | --- | --- |
| Earlier bounded code-review checkpoint | `529772807f32e637f19a26853d8a209482fa2f55` | Source, reconstruction evidence and actual-context acceptance receipt before this handoff correction |
| Latest Wallet implementation | `7bdb23d3398e1e92582a602bb22f06d364825412` | Post-input configuration/backup summary refresh; see the current correction record above. Includes the earlier navigation and connection-stop improvements |
| Latest complete Wallet regression | `7bdb23d3398e1e92582a602bb22f06d364825412` | 16,470 Node/HTTP and 1,026 synthetic browser passes on the exact implementation/test files; the final browser rerun includes successful cleanup |
| DAT | `c50aae41b9c7aa496833e6260cc3314dc3c3fbfb` | Applied helper repair plus configuration-validator regression and maintenance record; contract bytes unchanged |
| EMA | `a37c60574e279980b5ce90775842d27b9c4ce5eb` | Applied helper repair plus configuration-validator regression and maintenance record; contract bytes unchanged |
| CAWELON | `0f5dfa00a6e1738df3706e12e59b48459ff875a0` | Applied helper repair plus configuration-validator regression and maintenance record; contract bytes unchanged |
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
older public release. The later account/chain-switch exercise is recorded above.
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
| Older public-release rollback, if required for release | Exercise the final deployment's pinned previous-public-release rollback plan | Actual browser file return between immutable candidates `4dfa300` and `36ed431` passed, preserving nine histories exactly. The older public `07041f0` rejects shared-account configuration; its separate nine-record history-only recovery is verified, but full browser rollback to that public checkpoint is not |
| Native OS file-selection path | Select and cancel through the original profile's Windows file picker, then verify actual imported bytes | Supported browser filechooser and real files passed; native picker traversal was not exercised |
| Private-helper publication scope | Include its exact archive, source delta, maintenance procedure and completed developer review in the consolidated delivery | Developer review is complete under the user's assignment. Configuration regression and simulated contract/history checks pass. Public distribution remains deferred; third-party approval is not claimed |
| Final publication/deployment decision | Present the finished source/evidence package and the intended delivery scope before the deferred publication | The user assigned developer review to Codex; no reviewer-identification response is pending. A separate third-party audit is not completed or implied |

The original server was not restarted; its old imported server modules are not
a demonstration of the complete candidate. Current native browser automation
cannot establish Edge's URL reliably for extension control. Preserve that
limitation instead of bypassing browser protections.

The DAT Mainnet metadata comparison was closed by the later Sourcify-input
recovery and local compilation against the separately recorded RPC bytes.
This closes that developer verification item. Third-party audit status remains separate.
The full Wallet distribution and the older 9838e5b kit predate this follow-up;
their source pins and earlier results remain unchanged. The f7aaec1 source kit
includes the complete comparison.

For every finding, record the exact commit, affected path, trigger, expected and
observed behavior, evidence, impact, proposed fix and retest status. Do not count
time spent, the old 600-item list or repeated tests as release completion.
