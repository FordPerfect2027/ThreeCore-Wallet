# ThreeCore release preparation — November 1, 2026

The latest [source portability and test-routing correction](SOURCE_PORTABILITY_2026-11-02.md)
fixes ordinary token builds and an accidental support-preload test failure. All
three builds, source/routing checks and local EVM/Wallet compatibility checks
pass; DAT also passes the complete revised standard check command. The earlier
source-newline mismatch is closed. Real-wallet and independent-review gates remain.

The latest [historical Sepolia verifier correction](SEPOLIA_VERIFIER_2026-11-02.md)
prevents RPC errors from becoming false PASS results. DAT passes 251 local
read-only cases and a public historical checkpoint recheck with a reproduced,
recorded-hash-matching reference. The final default path also passes its 24
dedicated cases. The later source correction above closes newline portability;
real-wallet acceptance remains open. This does not establish a release percentage.

The next development target is a release candidate for the **read-only ThreeCore
Wallet and offline operation rehearsal**, with DAT, EMA and CAWELON checked
separately. The user's planning target is 90% or higher. The earlier 60% artwork
was a provisional planning indicator; it is not a measured starting score.

Work is organized around the release gates below. More test invocations, more
checklist rows or the completed 600-item worklist do not advance a gate by
themselves. An unresolved essential gate cannot be offset by many small fixes.
This page does not extend the product to signing, transfers, approvals, custody,
swaps, bridges, or autonomous spending.

## Operator deadline and work order — updated November 2

The operator set the target deadline to **November 2, 2026, 12:00 JST**
(`2026-11-02T03:00:00Z`), correcting the earlier conversational reference to
November 3. The target remains 90% preparation; neither the deadline nor elapsed
time establishes a completion percentage or a release approval.

Do not wait for three newly created or funded accounts. Complete implementation,
saved-data compatibility/recovery preparation, candidate review and distribution
work first. Use the existing accounts for the final real-wallet sequence; an
optional three-distinct-account exercise can be left until that stage. Reading
balances and logs does not require funding the observed addresses. A later
transaction exercise would be separate scope and is not authorized here.

The operator will use this PC for browsing during development. Continue file-
based work without switching, reloading or closing their browsing tabs. Batch
remaining real UI acceptance separately. Preserve the original port 4231
process and unsaved Wallet/rehearsal data. Already passing full suites should
not be repeated without a relevant code change, new failure or unresolved
concern. Keep GitHub publication deferred for one combined update.

The later [RPC response-body deadline correction](RPC_BODY_DEADLINE_2026-11-02.md)
fixes five operational read-only commands in each token. All three complete
227-entry read-only suites pass in sequential local runs; initial failed runs
are retained. This source change is newer than the verified delivery below.
It does not complete real-wallet or independent-review gates.

The latest [verified combined delivery](DISTRIBUTION_CHECKPOINT_2026-11-02.md)
is `d9044422820973e53fa41e0c55908f6e34217d7f`: 4433 Wallet source files,
253 evidence manifests / 2348 entries, ten isolated startup checks,
and all 46 outer-archive entries matching after fresh extraction. All three
token bundles restore into empty Windows directories with spaces in their paths.
Each receives its own 19-package runtime from the existing npm cache and passes
30 CLI/input cases; existing node_modules is not reused. Dependencies are not
vendored, and these cases overlap the earlier 213-case suites. This delivery
includes the history CLI and runtime-installation corrections, with the open
Zod compatibility finding. It does not complete real-wallet acceptance.

Subsequent [token dependency review and repair](TOKEN_DEPENDENCY_REVIEW_2026-11-02.md)
patched two development dependencies and verified all three tokens again against
the fixed Wallet source. Six audit package entries remain from one Zod root
advisory and require compatible remediation/exposure review. This unresolved
finding must accompany the candidate; it is not cleared by the earlier clean
production-only audit, which predates the runtime dependency reclassification. The prepared new CI pins are local only and require the
documented token-before-Wallet publication order. The `7d58d08` delivery includes the dependency and canonical-read corrections.
Subsequent history CLI changes are tracked separately below.

## Acceptance gates and current evidence

| Gate | Completion evidence needed | Current assessment |
| --- | --- | --- |
| Fixed source and regression | A named commit with successful unit, HTTP, real Chrome fixture, and compiled-token CI jobs | The latest inspected public PR head is `07041f00efdb503cb76a06fbe12e5531cb380930`; [run 41311235726](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/runs/41311235726) completed all five jobs successfully. PR #4 remains open and draft. The [current local source at `34d1731`](SHARED_ACCOUNT_ACCEPTANCE_2026-11-02.md) passed 16,451 Node/HTTP and 1,021 synthetic browser cases, plus 150 local compatibility cases against freshly compiled token artifacts. Existing dependency installations were reused. No new remote CI result or publication applies to those local changes |
| Public evidence and reproducibility | All referenced files present in a fresh checkout and hashes/record invariants verified | A fresh Windows checkout exposed 460 evidence mismatches caused by automatic line-ending conversion. The [correction at `c53cb26`](EVIDENCE_PORTABILITY_2026-11-02.md) preserves original evidence bytes; its fresh checkout verifies 248 manifests / 2,231 entries with zero mismatches, plus historical-record consistency. The final local package receipt separately covers the new evidence folder. New local evidence has no remote CI result; the successful public evidence job belongs to `07041f0` |
| Real wallet acceptance | All three token cards with existing accounts (sharing allowed); permission UI, exact balances/block, save/reload/restore, explicit reconnect, and a switch between two existing accounts | Incomplete. The [revised acceptance matrix](SHARED_ACCOUNT_ACCEPTANCE_2026-11-02.md) removes the unnecessary third-account prerequisite while retaining the permission, identity and recovery checks. Token count and distinct wallet count are reported separately; no new account is required |
| File recovery on the intended PC | Actual downloaded bytes, verified re-import, confirmed restore, preserved originals, and a stopped/cancelled operation recorded | [Rehearsal recovery](OPERATOR_RECOVERY_2026-11-01.md) passed for six fictional records / three cases. [Real balance-history recovery](HISTORY_RECOVERY_2026-11-01.md) passed for one permitted EMA account with two observations. [Archive/vault recovery](VAULT_RECOVERY_2026-11-02.md) now includes retained archives after disconnect/protective stop, saved-list survival across reload, duplicate-free collection re-import, cancelled/reviewed bundle import and byte-identical exports. [Isolated actual-file checks](ACTUAL_FILE_RECOVERY_2026-11-02.md) now cover two distinct collection files in empty native stores, eight distinct full workspaces across browser restarts, and an actual byte-identical browser download. Original-profile OS selection and the live three-token candidate using existing accounts remain separate |
| Read-only and input protection | No write/signing RPC reachable through the supported controls; malformed input, stale provider responses, wrong identity/network and cancellation reviewed and tested | Existing guards and regression are present. A [bounded developer source review](OPERATOR_RECOVERY_2026-11-01.md#connection-guidance-and-bounded-source-review) traced connection/read dispatch, request filtering and stale-result protection. This does not replace review of the final candidate or independent review |
| Reproducible distribution and rollback | A fixed-source archive that starts from a fresh directory; integrity checks and safe replacement/return instructions; no reliance on the developer's untracked files | The prior exported `97dae0f` package had 4,279 / 4,279 source files matching its commit and [ten successful fresh-directory HTTP/startup checks](RELEASE_REGRESSION_2026-11-02.md). The current application source is `34d1731`; its final delivery receipt records the new export, empty-repository restoration, evidence verification and startup checks separately. The [operator procedure](SOURCE_CHECKPOINT_2026-11-01.md) is documented; real-wallet migration/return remains to be exercised |
| Operational support | Supported browsers/networks, bounded RPC behavior, failure/retry instructions, backup procedure, and troubleshooting records for the candidate | The [Japanese operator guide](OPERATOR_ACCEPTANCE_JA.md) consolidates account identity, failed connection, preservation, backup and restore steps. Rehearsal file recovery and one real EMA account's settings/history recovery were exercised on the intended PC. The new plain-file comparison also reports exact content matches and retained extra history |
| Independent review and release decision | Separate review of the final scope and findings, explicit release decision and a deployment plan | Not completed. A developer's self-check or source publication is not independent review or deployment |

The 431 CI HTTP cases exclude the separate local-navigation-help file included
in `npm run test:wallet`; this explains the different CI/local subtotals. The
three browser passes exercise the same 1,001 cases repeatedly, not 3,003 unique
features. Compiled-token jobs use local EVMs and do not send public transactions.

## Work completed after the 600-item checkpoint

1. Reproduced and fixed the CI race in asynchronous report-review test setup.
   The same native-digest timing control fails before and passes after;
   [313 related cases also passed](CI_REVIEW_READINESS_2026-11-01.md).
2. Re-ran the complete public CI successfully on the fixed source above.
3. Integrated the existing public historical verification records from main
   without replacing the ongoing implementation.
4. Added an evidence-integrity CI job. This catches missing committed artifacts
   as well as modified bytes, including files a local working directory could
   otherwise supply accidentally. Results are retained as workflow artifacts.
5. Re-established access to the existing rehearsal tab and opened the wallet
   through its same-origin link in a separate tab. The rehearsal still showed
   six fictional records and three comparison cases; it was not reloaded.
6. Added a read-only source-package verifier and tested missing/changed/extra
   files, fixed revision selection, size limits and directory redirection.
   Verified a Git-exported package in a new directory and started its own
   loopback server without changing the existing 4231 process.
7. Changed the links between Wallet and operation rehearsal to open a separate
   tab, with visible wording that tells the operator what will happen. Previously
   they navigated the current tab, whose `pagehide` handler disposes in-memory
   state; going back cannot be relied upon to recover it. The existing tab now
   stays open. This does not add automatic storage or protect a tab that the
   operator closes or reloads; the page explains when to save files.
   In Microsoft Edge, ordinary clicks opened distinct tabs in both directions;
   the Wallet report-name draft and the rehearsal's two fictional records
   remained unchanged in their original tabs. The user's pre-existing six
   fictional records and three cases were preserved without a reload. The
   existing demo-route and local-navigation suites passed all eight cases.
8. Exercised the complete rehearsal file cycle in Microsoft Edge, including
   cancelling an import preview before applying a second reviewed import.
   [Saved evidence](OPERATOR_RECOVERY_2026-11-01.md) includes both downloaded
   JSON files, their matching hashes, a structural inspection and explicit
   limits of the observed UI evidence.
9. Added Japanese messages for wrong account, wrong chain and absent account
   permission, without changing the identity checks. The existing controller
   and connection-boundary suites passed 66 cases. Consolidated the operator
   steps and recorded the bounded read-only source review.
10. Added an explicit, read-only preview of already permitted wallet addresses,
    with revalidation before input and a separate Connect action. This removed
    the need for the operator to copy the selected address during resumption.
    [Account reconnection evidence](ACCOUNT_RECONNECTION_2026-11-01.md) records
    116 focused passes, 1,004 synthetic UI passes and the intended-PC observation.
11. Exercised a real EMA balance-history file round trip and added an explicit
    comparison of a verified plain backup with current settings and full history.
    The [history-recovery record](HISTORY_RECOVERY_2026-11-01.md) documents two
    actual observations and the distinct synthetic automated tests. This
    continuation is being collected locally; it has not been pushed to GitHub.
12. Fixed connection invalidation erasing explicitly accepted transfer archives.
    Active operations and previews are still cancelled, while accepted records
    remain available for offline JSON saving under their original context.
    [Archive-retention evidence](TRANSFER_ARCHIVE_RETENTION_2026-11-01.md)
    separates the automated verification, offline probe and subsequent
    intended-PC result. The latter now passed for one permitted EMA account.
    This is local work awaiting the operator's requested combined publication.
13. Exercised saved-list persistence, idempotent collection re-import, cancelled
    and reviewed working-bundle import, and individual-card restore in Microsoft
    Edge. Fixed the generic inspector rejecting the app's own whole-list backup
    and added the correct restore destination. [Recovery and guide evidence](VAULT_RECOVERY_2026-11-02.md)
    includes the precise limits of the real-PC exercise and the separate
    synthetic tests. No new history query or GitHub publication was performed.
14. Completed the full local regression for the subsequent collection-guide
    changes, corrected a deadline test's assumption about worker start, and
    verified whole-list restore into an isolated empty native browser database.
    [The regression record](RELEASE_REGRESSION_2026-11-02.md) preserves initial
    failures, the passing reruns and limits. Recovered the two known public
    accounts from verified backups before asking the operator to re-enter them;
    the third real account remains unidentified.
15. Exercised the review package in fresh directories, repaired incomplete Git
    bundle history, and fixed Windows checkout conversion of checksummed files.
    [Portability evidence](EVIDENCE_PORTABILITY_2026-11-02.md) retains the original
    failures, 63 focused passes and the normal-Windows full checkout result.
    The [independent-review handoff](RELEASE_HANDOFF_2026-11-02.md) is prepared;
    preparation is not completion of an independent review.

16. Corrected the actual repeated-account restrictions in Connect, permitted-account
    input, setup export and workspace backup. Added one-account/three-token and
    two-account scenarios, including shared-provider invalidation and reviewed
    persistence. [Current evidence](SHARED_ACCOUNT_ACCEPTANCE_2026-11-02.md)
    records 16,451 full Node/HTTP passes, 1,021 full synthetic browser passes,
    150 cases against fresh token builds, and six separately recorded real
    public-RPC observations. No third real account is required for this scope.

## Current real-wallet observation

Account 1's previously missing public address was obtained through the supported
permitted-account preview. EMA reconnection, canonical metadata/balance reads,
settings/checkpoint preservation, reload, reviewed restore and Stop/Resume were
subsequently observed on November 1; see the [resumption record](ACCOUNT_RECONNECTION_2026-11-01.md).

On November 2, nine verified workspace backups identified the two known public
accounts and their historical card assignments. The intended Edge Wallet tab
again displayed Account 1, Base Mainnet and one already permitted address.
No new wallet permission or balance read was performed. A later loss of browser
debugger attachment prevented further UI/screenshot confirmation; the original
tab and server were not reloaded or restarted. The public addresses and detailed
observations remain in private local records.

The existing Wallet's visible DOM and screenshot were subsequently recovered
without reloading it: two EMA balance observations and one saved archive remained.
Native browser control still could not establish the active URL for navigation
to a separate empty-store test page, so that real restore was not performed.
The temporary empty-store server was then closed; the original server remained.

No third real account was found in those saved files. The initial backup and
checkpoint collection contain synthetic repeated-digit identities, not a third
real wallet. [The operator handoff now starts with saved configuration recovery](OPERATOR_ACCEPTANCE_JA.md#接続するアカウントをそろえる),
followed by the existing permission preview. This one current Mainnet permission
and two historical identities do not by themselves complete the real-wallet
checks. The later [shared-account correction](SHARED_ACCOUNT_ACCEPTANCE_2026-11-02.md)
permits those existing accounts and removes the missing third account as a
prerequisite. Actual testnet observations are still recorded separately from Mainnet.

The November 2 continuation also completed actual read-only Base Sepolia RPC
queries for both recovered accounts and all three tokens at canonical block
53,169,113: six zero-balance observations with contract code present. This did
not use MetaMask or establish its testnet permission. Account-specific raw data
remains private in Downloads; the packaged summary is redacted. The existing
Wallet UI was readable, but further control failed before an action was
confirmed. Its original tabs and server were preserved.

## Next work order

Evidence CI, the fresh-directory source/startup check and the intended-PC
rehearsal file cycle have passed on their named revisions. Account 1 resumption
and a two-observation EMA balance-history round trip have now been observed on
the intended PC. Collect subsequent development and verification locally before
any combined GitHub publication. One-account saved-collection persistence and
re-import are also observed. The subsequent [isolated actual-file recovery](ACTUAL_FILE_RECOVERY_2026-11-02.md)
passes empty-database collection import, complete Wallet restoration, browser-
process restart and byte-identical native download on the intended PC. The
original-profile OS chooser and real-wallet permission are separate checks.
Continue the existing-account public-testnet acceptance matrix, then complete
independent review before a release decision. Record each material
finding with its source revision, reproduction, fix and verification. Keep the
current 4231 server and the user's open rehearsal data intact. New test servers
must bind loopback on unused ports and be closed only by their own test process.

## Token canonical-read follow-up — November 2

The [canonical token identity correction](CANONICAL_TOKEN_IDENTITY_2026-11-02.md)
now pins all state reads by canonical block hash and rejects network/block
changes. All three token read-only suites passed 159 cases, and three public
Mainnet observations succeeded at block 53,389,236. CLI provider errors are
redacted. Browser Wallet code, real-wallet acceptance and the remaining Zod
finding are unchanged. The prepared token CI pins point to the new local
commits. The 7f92929 delivery remains an earlier checkpoint and does not include
this correction.

The subsequent [balance and reference-quote correction](CANONICAL_TOKEN_IDENTITY_2026-11-02.md#follow-up-balances-and-reference-quotes)
now extends canonical hash reads to those two standalone commands. Each token
passes 194 full read-only cases, superseding the earlier overlapping 159-case
run. Six new public-RPC observations succeeded; existing-account details are
retained privately. Real-wallet UI acceptance and independent review remain
separate.

## History CLI follow-up — November 2

The [history command correction](HISTORY_CLI_2026-11-02.md) now blocks known
invalid input before RPC and redacts provider error details. Each token passes
213 read-only cases; 19 history CLI/input cases are included. Before/after
evidence reproduces unnecessary requests in the original commands. This does
not close the remaining real-wallet, independent review or Zod gates.

## Read-only runtime installation follow-up

The [runtime installation correction](READ_ONLY_RUNTIME_2026-11-02.md) fixes a
reproduced missing-viem startup failure after production-only installation.
Each token passed the existing 213 read-only cases in its own fresh 19-package
installation with development and optional dependencies omitted. Package versions,
contracts and readers are unchanged. Full development Zod remediation, real-wallet
UI acceptance and independent review remain open. The 7d58d08 combined delivery
predates this follow-up; new CI jobs are prepared locally without a remote result.
