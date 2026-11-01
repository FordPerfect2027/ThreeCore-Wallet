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
| Fixed source and regression | A named commit with successful unit, HTTP, real Chrome fixture, and compiled-token CI jobs | Commit `f81c600918360daee77c1736915ac8878f02cb65` passed [run 41305306004](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/runs/41305306004): 15,962 unit tests, 431 HTTP tests, 1,001 synthetic browser cases on each of three consecutive runs; all three compiled-token jobs and the new evidence job passed |
| Public evidence and reproducibility | All referenced files present in a fresh checkout and hashes/record invariants verified | Local audit at `f81c600`: 242 manifests / 2,183 entries matched. The separate evidence CI gate passed on the same revision, checking the development manifests and the October 28 historical evidence on a fresh checkout |
| Real wallet acceptance | Three prepared distinct accounts in the intended wallet/browser; permission UI, exact balances/block, save/reload/restore, explicit reconnect and invalidation observed | Incomplete. The [existing acceptance criteria](LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md) remain applicable. One Account 2 historical scan is not three distinct real-account acceptance |
| File recovery on the intended PC | Actual downloaded bytes, verified re-import, confirmed restore, preserved originals, and a stopped/cancelled operation recorded | Local and synthetic regression evidence exists; repeat the complete real-wallet recovery using the release candidate |
| Read-only and input protection | No write/signing RPC reachable through the supported controls; malformed input, stale provider responses, wrong identity/network and cancellation reviewed and tested | Existing guards and regression are present; the release review must cover the final candidate and any material remaining findings |
| Reproducible distribution and rollback | A fixed-source archive that starts from a fresh directory; integrity checks and safe replacement/return instructions; no reliance on the developer's untracked files | [Source package verification](SOURCE_CHECKPOINT_2026-11-01.md): 4,227 / 4,227 files match the selected commit and seven fresh-directory startup/boundary checks pass. The operator procedure is documented; real-wallet migration/return remains to be exercised |
| Operational support | Supported browsers/networks, bounded RPC behavior, failure/retry instructions, backup procedure, and troubleshooting records for the candidate | Documentation exists across features; consolidate and exercise the operator path before closure |
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

## Current real-wallet observation

On November 1, Microsoft Edge recognized MetaMask in the application. The EMA
card was configured with the previously authorized Account 2 public address
`0xcfae42798e867968c60fedf38d7ee401120072c8` on Base Mainnet and Connect was pressed.
The page displayed a wallet-permission wait and a MetaMask window appeared.
The UI tool then could not establish the extension window's current URL and
stopped computer control. No successful reconnection, new balance, or permission
approval is claimed from that attempt. This observation does not close the real
wallet acceptance gate. Development and offline verification can continue while
the wallet screen is clarified.

## Next work order

Evidence CI and the fresh-directory source/startup check have passed. Resolve
the real-wallet screen and run the account-specific acceptance and recovery path; then review
the final supported controls and operational limits. Record each material
finding with its source revision, reproduction, fix and verification. Keep the
current 4231 server and the user's open rehearsal data intact. New test servers
must bind loopback on unused ports and be closed only by their own test process.
