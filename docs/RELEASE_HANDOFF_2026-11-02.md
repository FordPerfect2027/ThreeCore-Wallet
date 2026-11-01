# ThreeCore candidate review handoff — November 2, 2026

This is a prepared review package, not a completed independent review, an
approved release, or a measured completion percentage. No reviewer has been
contacted by this workflow. Publication remains deferred at the operator's
request. A reviewer should report findings against an exact commit and state
which parts they did and did not examine.

## Source and evidence to review

- Last observed public PR #4 head: `07041f00efdb503cb76a06fbe12e5531cb380930`.
  [Its existing CI run](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/runs/41311235726)
  passed five jobs. The PR remains draft; this does not cover later local changes.
- Current application source: `97dae0f43104ec80ae387e671a86389db9156aad`.
- Current test/operator-guide changes: `c36ce33f16bfb42dc099324382281300ba9c9f30`.
- Consolidated local evidence: `380c132bc3acedeba069ccf39726c1decf2200b8`.
  This handoff is a documentation-only addition after that evidence checkpoint.
  The delivered package receipt identifies the exact commit that includes it.

Read the [readiness gates](RELEASE_READINESS_2026-11-01.md) and
[latest regression record](RELEASE_REGRESSION_2026-11-02.md) first. The latter
links to the initial failures as well as the successful reruns. The current
local results are 16,445 Node/HTTP cases, 1,019 synthetic browser cases and 150
local token-artifact compatibility cases. Focused runs overlap those totals.
The token build checks reused existing compiled artifacts. The public token
jobs' pinned source and fresh-build commands are in `.github/workflows/ci.yml`.

The implementation delta from the public head to `380c132` is ten files,
103 insertions and 26 deletions, excluding tests and documentation:

| Change | Files | Important review question |
| --- | --- | --- |
| Compare a verified workspace backup with the current settings and full histories | `examples/workspace-panel.js`, `src/workspace-overview.js` | Can stale, cancelled or changed input produce a false match? Are retained additional observations represented accurately? |
| Retain accepted transfer archives when the connection stops or its context changes | `src/transfer-archive-controller.js`, `examples/transfer-archive-panel.js`, `examples/transfer-panel.js`, `examples/wallet-demo.js` | Are pending operations/previews invalidated while accepted context-bound data stays exportable? Can a different account or chain contaminate the old archive? |
| Recognize the saved-list backup and navigate to its reviewed restore control | `src/file-read-status.js`, `examples/file-read-panel.js`, `examples/transfer-vault-panel.js`, `scripts/inspect-wallet-saved-file.js` | Does the strict collection decoder run? Are counts references rather than invented independent observations? Does navigation avoid implicit import, storage write or provider calls? |

## Review the capability boundaries

The supported scope is the read-only browser Wallet and offline rehearsal.
Signing, transaction submission, approval transactions, custody, swaps, bridges,
automatic network switching and autonomous spending are outside that scope.
The supplied package does not establish browser-extension security or token
contract safety. Test/provider fixtures are not evidence of real wallet access.

Review these boundaries in the complete candidate, not only the ten-file delta:

| Boundary | Source starting points | Required finding/evidence |
| --- | --- | --- |
| Permission and account identity | `src/wallet-session.js`, `src/provider-registry.js`, `src/provider-event-gate.js` | Permission is explicit, pending requests are bounded, and account/network changes invalidate stale reads. A saved address never restores a permission. |
| Read-only RPC | `src/security-rpc.js`, `src/wallet-session.js`, `src/base-state-provider.js` | Every dispatch stays behind the method/parameter guard. Unsupported signing/transaction methods and write selectors are rejected before provider execution. |
| Local HTTP entry and proxy | `examples/security-http.js`, `examples/dev-server.js`, `src/state-rpc-http.js` | Host, exact Origin, Fetch Metadata, frame protection and route limits hold. Refused navigation remains a passive 403 guide. Do not add a bypass to make automation pass. |
| Bounded input and storage | `src/security-file.js`, `src/file-read-service.js`, `src/security-json.js`, `src/transfer-vault-collection.js` | Size/deadline/cancellation limits survive delayed callbacks. Checksums detect corruption; they do not authenticate the writer or on-chain truth. |
| View and recovery | `examples/workspace-panel.js`, `src/transfer-archive-controller.js`, `examples/transfer-vault-panel.js` | Stop/cancel does not revive obsolete output or erase accepted records. Restores remain explicit and preserve required original data. |

Relevant existing tests include `security-rpc.test.js`,
`external-privileged-rpc-boundary.test.js`, `connection-boundaries.test.js`,
`provider-event-*.test.js`, `view-stop-delivery.test.js`,
`file-read-deadline.test.js`, `file-read-formats.test.js` and the vault UI suite.
Review their assertions and coverage; green totals alone are insufficient.

## Reproduce from the offline package

The delivery contains a source ZIP, a Git bundle and a receipt with hashes.
The Git bundle preserves the exact candidate commit and its history without
copying a developer's Git configuration, credentials or untracked local files.
Previously published historical verification records are part of the tracked
repository; new private account backups and screenshots in Downloads are not
added to this package.

In a new directory, restore the bundle without contacting a remote service:

```powershell
git init threecore-review
git -C threecore-review fetch ../ThreeCore-Wallet-review.bundle HEAD
git -C threecore-review checkout --detach FETCH_HEAD
git -C threecore-review rev-parse HEAD
```

Adjust the bundle path to its actual location. Compare the resulting full commit
ID with the receipt. From that checkout:

```powershell
node scripts/verify-evidence-collection.js .
node docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js integration/*-server.test.mjs integration/local-navigation-help.test.mjs
node scripts/test-browser-ui.js
```

Node 22 or newer is required. The browser command needs an installed supported
Chrome/Edge executable and runs disposable profiles without extensions or real
wallet access. The full evidence-collection command requires a Git checkout;
it cannot discover the index from the plain ZIP alone. Individual SHA256SUMS
manifests can be checked in the ZIP extraction with
`node scripts/verify-evidence-manifest.js <manifest-path>`.

Use an unused loopback port for an actual browser exercise. Keep any existing
Wallet/rehearsal server and unsaved tabs intact. A different port has different
browser storage and wallet permission. Follow the
[operator procedure](OPERATOR_ACCEPTANCE_JA.md); never remove the original
database to manufacture an empty recovery target.

## Outstanding acceptance and review response

These items remain open even if all automated checks pass:

1. Three distinct real accounts on Base Sepolia: confirm the intended allocation,
   observe the wallet permission UI, record exact balances/block, save/reopen/
   restore, reconnect explicitly, and exercise invalidation. Only two historical
   real identities and one current Mainnet permission have been established.
2. Actual-account saved-collection recovery into an empty persistent store on the
   intended PC. The separate-database synthetic case passed; actual-file import
   into an existing list also passed. The new empty-store real-PC attempt reached
   the passive navigation guide, then native browser control stopped because it
   could not establish the active URL. No actual restore is claimed from it.
3. Candidate migration/return with the intended real wallet, preserving the
   previous working version and its files.
4. Independent findings and remediation review, followed by an explicit release
   decision and deployment plan. The present developer review is not independent.

For each finding, record the candidate commit, affected file/path, trigger,
expected/observed behavior, reproducible evidence, impact, proposed fix and
retest status. Separate verified defects, untested assumptions and unavailable
environment steps. Do not sign or transact to obtain evidence for this scope.
No release should be described as approved while these essential gates remain
unproven. Do not turn test counts or time spent into a completion percentage.
