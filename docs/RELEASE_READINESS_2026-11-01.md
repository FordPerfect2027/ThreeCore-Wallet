# ThreeCore release preparation — November 1, 2026

The next development target is a release candidate for the **read-only ThreeCore
Wallet and offline operation rehearsal**, with DAT, EMA and CAWELON checked
separately. The user's planning target is 90% or higher. The earlier 60% artwork
was a provisional planning indicator; it is not a measured starting score.

Work is organized around the release gates below. More test invocations, more
checklist rows or the completed 600-item worklist do not advance a gate by
themselves. An unresolved essential gate cannot be offset by many small fixes.
This page does not extend the product to signing, transfers, approvals, custody,
swaps, bridges, or autonomous spending.

## Acceptance gates and current evidence

| Gate | Completion evidence needed | Current assessment |
| --- | --- | --- |
| Fixed source and regression | A named commit with successful unit, HTTP, real Chrome fixture, and compiled-token CI jobs | The latest inspected public PR head is `07041f00efdb503cb76a06fbe12e5531cb380930`; [run 41311235726](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/runs/41311235726) completed all five jobs successfully. PR #4 remains open and draft. Subsequent history/retention/collection-guide changes are local only, with separately recorded local checks and no new remote CI result |
| Public evidence and reproducibility | All referenced files present in a fresh checkout and hashes/record invariants verified | Local audit at `f81c600`: 242 manifests / 2,183 entries matched. The separate evidence CI gate passed on the same revision, checking the development manifests and the October 28 historical evidence on a fresh checkout |
| Real wallet acceptance | Three prepared distinct accounts in the intended wallet/browser; permission UI, exact balances/block, save/reload/restore, explicit reconnect and invalidation observed | Incomplete. The [existing acceptance criteria](LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md) remain applicable. One Account 2 historical scan is not three distinct real-account acceptance |
| File recovery on the intended PC | Actual downloaded bytes, verified re-import, confirmed restore, preserved originals, and a stopped/cancelled operation recorded | [Rehearsal recovery](OPERATOR_RECOVERY_2026-11-01.md) passed for six fictional records / three cases. [Real balance-history recovery](HISTORY_RECOVERY_2026-11-01.md) passed for one permitted EMA account with two observations. [Archive/vault recovery](VAULT_RECOVERY_2026-11-02.md) now includes retained archives after disconnect/protective stop, saved-list survival across reload, duplicate-free collection re-import, cancelled/reviewed bundle import and byte-identical exports. The final three-account candidate and empty-database collection restore remain pending |
| Read-only and input protection | No write/signing RPC reachable through the supported controls; malformed input, stale provider responses, wrong identity/network and cancellation reviewed and tested | Existing guards and regression are present. A [bounded developer source review](OPERATOR_RECOVERY_2026-11-01.md#connection-guidance-and-bounded-source-review) traced connection/read dispatch, request filtering and stale-result protection. This does not replace review of the final candidate or independent review |
| Reproducible distribution and rollback | A fixed-source archive that starts from a fresh directory; integrity checks and safe replacement/return instructions; no reliance on the developer's untracked files | [Source package verification](SOURCE_CHECKPOINT_2026-11-01.md): 4,227 / 4,227 files match the selected commit and seven fresh-directory startup/boundary checks pass. The operator procedure is documented; real-wallet migration/return remains to be exercised |
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

## Current real-wallet observation

On November 1, Microsoft Edge recognized MetaMask in the application. The EMA
card was configured with the previously authorized Account 2 public address
`0xcfae42798e867968c60fedf38d7ee401120072c8` on Base Mainnet and Connect was pressed.
The page displayed a wallet-permission wait and a MetaMask window appeared.
The UI tool then could not establish the extension window's current URL and
stopped computer control. No successful reconnection, new balance, or permission
approval is claimed from that attempt.

The operator subsequently reported that **Account 1** had been connected and
selected it as the current target. The application still showed a protective
stop, while its card retained the earlier Account 2 expected address. Account 1's
public address has not yet been independently observed or supplied; it must not
be inferred from its display name or substituted with the historical address.
The extension-control attempt again stopped because the UI tool could not
establish its current URL. No new on-chain read is claimed. The earlier Account 2
records remain historical records, separate from the requested Account 1 check.
That earlier blocker was subsequently resolved through the supported application
UI: a new permitted-account preview obtained the currently exposed address
without changing extension permissions. EMA reconnected, the canonical metadata
and balance read completed, and actual settings-file/checkpoint preservation,
page reload, reviewed restore, Stop/Resume and explicit reconnect were observed.
See the [resumption record](ACCOUNT_RECONNECTION_2026-11-01.md). The full address
and balance are retained locally. This one Base Mainnet account does not close
the three-distinct-account public-testnet acceptance gate.

## Next work order

Evidence CI, the fresh-directory source/startup check and the intended-PC
rehearsal file cycle have passed on their named revisions. Account 1 resumption
and a two-observation EMA balance-history round trip have now been observed on
the intended PC. Collect subsequent development and verification locally before
any combined GitHub publication. One-account saved-collection persistence and
re-import are also observed; empty-database recovery remains a separate check.
Continue the distinct-account public-testnet acceptance, then complete
independent review before a release decision. Record each material
finding with its source revision, reproduction, fix and verification. Keep the
current 4231 server and the user's open rehearsal data intact. New test servers
must bind loopback on unused ports and be closed only by their own test process.
