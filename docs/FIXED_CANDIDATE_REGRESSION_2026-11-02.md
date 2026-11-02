# Fixed candidate full regression — November 2, 2026

The standalone review package at source `212601977bc6dad8da298f11ebb9e7a421052571`
now has a complete local Wallet regression from its restored, clean Git checkout.
The application is `8fa0ed2739482b8df415e46c6c45491955d4bfc4`. The checkout
remained at that exact commit with no tracked or untracked changes after both runs.
No implementation, test assertion or timeout was changed to obtain these results.

The previous complete regression was at `e5841f0`. Four implementation files
changed afterward: network/account guidance, the exact site-origin display,
requested-versus-observed network labels and address wrapping. Their focused
checks had passed; this run closes the gap in full-regression coverage of those
changes and exercises the independently restored package. Test sources and
runner scripts are unchanged between those two pins.

| Check | Result | Scope |
| --- | --- | --- |
| Node and local HTTP | 16,454 passed; zero failures, cancellations, skips or TODOs | Node v24.19.0, Windows, concurrency 2, per-test 60-second limit; 604633.0327 ms |
| Browser module routes | 261 passed | Local test modules available from the restored source |
| Synthetic browser | 1,021 passed in one run: 511 + 510 | Two disposable headless profiles, no installed wallet or external RPC; both profiles cleaned successfully |
| Fixed package | Original SHA-256 unchanged | 51,127,612-byte standalone ZIP; no replacement archive was produced |

These are regression cases, not new features, unique development tasks or a
completion percentage. The browser cases use synthetic providers; they do not
close actual MetaMask switching or native Windows picker acceptance.

Commands, from the restored fixed checkout:

```powershell
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 test/*.test.js integration/*-server.test.mjs integration/local-navigation-help.test.mjs
node scripts/test-browser-ui.js
```

[Structured summary](evidence/2026-11-02-release-regression/fixed-2126019-fixed-regression-summary.json),
[Node output](evidence/2026-11-02-release-regression/fixed-2126019-node-full.log),
[browser output](evidence/2026-11-02-release-regression/fixed-2126019-browser-full.log) and
[recording method](evidence/2026-11-02-release-regression/fixed-2126019-record-fixed-regression.mjs)
retain exact timestamps, commands and file hashes. The method contains the
original local paths as historical provenance; adjust paths when reproducing.
The source ZIP predates this result, so this record is a separate follow-up to
the unchanged package. Token tests/artifacts retain their prior toolchain-validation scope.

## Public and actual-wallet boundaries

The unauthenticated public GET recheck at 13:23 UTC still shows PR #4 open and
draft at `07041f00efdb503cb76a06fbe12e5531cb380930`, with five successful checks.
Those checks cover the earlier public source only. The repository's public
Releases endpoint returned an empty list; this does not establish whether
a service has been deployed elsewhere, nor establish a previous-release rollback.
[Public receipt](evidence/2026-11-02-release-regression/fixed-2126019-public-pr-and-release-status.json).

The preceding real-wallet follow-up restored six saved records and reconnected
all three cards to Account 2 / Sepolia. After the operator reported a switch to
Base and disappearance of the connected label, the controlled tab still showed
all three connected on chain 84532. Its ordinary DAT native-balance read completed
at Sepolia block 53,516,193. The operator then confirmed the same visible
`接続確認 1102-A` marker. Native inspection of MetaMask was stopped by the
Windows UI tool because it could not determine the current browser URL.
This narrows the investigation but neither proves a successful live switch nor
identifies a product event-handler defect. [Redacted follow-up](evidence/2026-11-02-release-regression/fixed-2126019-actual-switch-followup.json)
hashes the private screenshots/state records without publishing their full account details.

The original 4231 and candidate 4232 servers were preserved. No user-wallet
signature, transfer, approval transaction, private key, GitHub write or new
public RPC was involved in this fixed-source regression run. The preceding
actual-wallet read is explicitly separate. Live switching, native picker traversal,
the development Zod finding, independent review and release approval remain open.
