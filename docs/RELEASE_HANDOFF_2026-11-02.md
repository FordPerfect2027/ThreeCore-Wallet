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
- Current application and test source: `34d173112d7f45475c52fb64553cfa8b369699d2`.
  This corrects the shared-account policy in connection, settings and workspace
  backup; it supersedes the application source at `97dae0f` and tests at `c36ce33`.
- Previous consolidated local evidence: `380c132bc3acedeba069ccf39726c1decf2200b8`.
  The initial handoff was documented at `a39b0996ee2cf9fe03d57b87f37451980d2328e6`.
- Evidence checkout policy and its regression test:
  `c53cb2628dc2b85e530d36b6f26248bf84acd013`. A real Windows checkout exposed
  460 hash mismatches from LF-to-CRLF conversion. The narrow evidence-directory
  policy fixes that without changing original artifacts or their hashes.
  See the [portability record](EVIDENCE_PORTABILITY_2026-11-02.md).
  The delivered package receipt identifies the exact final documentation commit.

Read the [readiness gates](RELEASE_READINESS_2026-11-01.md) and
[shared-account acceptance record](SHARED_ACCOUNT_ACCEPTANCE_2026-11-02.md)
first. The current source passed 16,451 Node/HTTP cases, 1,021 synthetic browser
cases and 150 local token compatibility cases using newly compiled artifacts.
Focused runs overlap those totals. Both Git portability round-trip tests are
included in the full Node run. Each pinned token source was compiled in a new
directory with no artifacts/cache; existing installed dependencies were reused.
The [previous regression record](RELEASE_REGRESSION_2026-11-02.md) and current
evidence preserve initial failures as well as successful reruns. The public
token jobs' pinned source and fresh-build commands are in `.github/workflows/ci.yml`.

The later [token dependency correction](TOKEN_DEPENDENCY_REVIEW_2026-11-02.md)
also passes the token projects' full checks and 150 Wallet compatibility cases.
Its new pins are still local: publish and verify the token commits before the
prepared Wallet workflow change. One Zod root advisory remains open across six
development-dependency audit entries. This is part of the outstanding review;
neither a clean production-only audit nor unchanged bytecode resolves it.

The implementation delta from the public head to `34d1731` is sixteen files,
120 insertions and 53 deletions, excluding tests, documentation and the
evidence-checkout policy:

| Change | Files | Important review question |
| --- | --- | --- |
| Compare a verified workspace backup with the current settings and full histories | `examples/workspace-panel.js`, `src/workspace-overview.js` | Can stale, cancelled or changed input produce a false match? Are retained additional observations represented accurately? |
| Retain accepted transfer archives when the connection stops or its context changes | `src/transfer-archive-controller.js`, `examples/transfer-archive-panel.js`, `examples/transfer-panel.js`, `examples/wallet-demo.js` | Are pending operations/previews invalidated while accepted context-bound data stays exportable? Can a different account or chain contaminate the old archive? |
| Recognize the saved-list backup and navigate to its reviewed restore control | `src/file-read-status.js`, `examples/file-read-panel.js`, `examples/transfer-vault-panel.js`, `scripts/inspect-wallet-saved-file.js` | Does the strict collection decoder run? Are counts references rather than invented independent observations? Does navigation avoid implicit import, storage write or provider calls? |
| Permit existing accounts to serve multiple token cards | `src/wallet-setup.js`, `src/wallet-setup-file.js`, `src/workspace-format.js`, `src/workspace-file.js`, `src/workspace-overview.js`, `examples/wallet-demo.js`, `examples/wallet-setup-panel.js`, `examples/workspace-panel.js`, `examples/index.html` | Are token histories kept separate, wallet and card counts accurate, restore permission-free, and account/chain changes invalidating every card using the provider? New shared-address backups may be rejected by older readers: preserve the original pre-upgrade files |

## Review the capability boundaries

The supported scope is the read-only browser Wallet and offline rehearsal.
Signing, transaction submission, approval transactions, custody, swaps, bridges,
automatic network switching and autonomous spending are outside that scope.
The supplied package does not establish browser-extension security or token
contract safety. Test/provider fixtures are not evidence of real wallet access.

Review these boundaries in the complete candidate, not only the sixteen-file delta:

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
The source must have complete history before bundling. `git bundle verify`
alone did not expose a missing parent in the initial shallow-source bundle;
the delivery procedure therefore also restores the bundle into a new empty
repository. The final receipt must confirm that actual offline restoration.
The candidate includes `.gitattributes` so checksummed evidence retains its
original bytes with both Windows CRLF conversion and unconverted checkouts.
Do not normalize old evidence or regenerate its expected hashes to make it pass.
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

1. The three token cards on Base Sepolia using existing accounts (sharing allowed): confirm the allocation,
   observe the wallet permission UI, record exact balances/block, save/reopen/
   restore, reconnect explicitly, and exercise invalidation by switching between
   the two existing accounts. The earlier requirement for a third real account
   is superseded by the [shared-account matrix](SHARED_ACCOUNT_ACCEPTANCE_2026-11-02.md).
   Public RPC reads now cover both recovered accounts and all three tokens at
   Base Sepolia block 53,169,113 (six zero-balance observations). They did not
   use MetaMask and do not complete this UI acceptance step. One current Mainnet
   permission was previously observed; it is separate from testnet permission.
2. The original-profile OS file-selection workflow remains separate from the
   completed [isolated actual-file recovery](ACTUAL_FILE_RECOVERY_2026-11-02.md).
   On the intended PC, two distinct actual downloaded collection contents now
   restore into empty native IndexedDB stores and survive a browser-process
   restart. Eight distinct workspace backups also restore exact full contents
   through the complete Wallet and its saved checkpoints. A normal browser
   download of the restored ten-observation workspace is byte-identical to its
   input. Those runs use new extension-free profiles and File/FileReader input;
   they do not establish real-wallet permission or exercise the OS chooser.
3. Candidate migration/return with the intended real wallet, preserving the
   previous working version and its files. The offline data-format preparation
   now passes for fourteen actual downloaded originals across `b2270b2` and
   `59b63ca`, including reading candidate exports in the prior version. A private
   return kit preserves originals. Isolated native-storage and full-screen
   recovery are now checked separately as above; intended real-wallet version
   return and reconnection remain open. See the shared-account record.
4. Independent findings and remediation review, followed by an explicit release
   decision and deployment plan. The present developer review is not independent.

For each finding, record the candidate commit, affected file/path, trigger,
expected/observed behavior, reproducible evidence, impact, proposed fix and
retest status. Separate verified defects, untested assumptions and unavailable
environment steps. Do not sign or transact to obtain evidence for this scope.
No release should be described as approved while these essential gates remain
unproven. Do not turn test counts or time spent into a completion percentage.

## Token canonical-read follow-up — November 2

The [canonical token identity correction](CANONICAL_TOKEN_IDENTITY_2026-11-02.md)
now pins all state reads by canonical block hash and rejects network/block
changes. All three token read-only suites passed 159 cases, and three public
Mainnet observations succeeded at block 53,389,236. CLI provider errors are
redacted. Browser Wallet code, real-wallet acceptance and the remaining Zod
finding are unchanged. The prepared token CI pins point to the new local
commits. The 7f92929 delivery remains an earlier checkpoint and does not include
this correction.
