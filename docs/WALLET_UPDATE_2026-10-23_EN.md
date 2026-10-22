# ThreeCore Wallet source publication — October 23, 2026

This publication brings the locally developed DAT, EMA and CAWELON wallet workflows
into the public source repository. It builds on commit
`60b0bc4c95e12eefd1b7a22f9625e6771f8db024`, the October 22 portfolio release.
It publishes accumulated development across several local iterations, not one
new coding session. Source publication does not deploy a website or a contract.

## Included workflows

- Review, filter, compare and import historical balance observations. Preview
  changes before applying them; distinguish failed reads from zero balances.
- Prepare public wallet settings for the three cards with explicit review.
  Imported settings never grant wallet permission or reconnect a session.
- Download and restore three-card workspace backups. Review merges/replacements,
  detect changes after preview, and retain recovery information on storage failure.
- Explicitly save browser-local checkpoints, inspect and archive them, and export
  or import their collection. Revision checks prevent stale tabs overwriting data.
- Read registered token identity, exact decimal balances and metadata at a pinned
  block. Detect account, chain and canonical-block changes while a read is pending.
- Inspect existing ERC-20 allowances for reviewed spender addresses, including
  unknown results, unlimited amounts and historical comparisons. Save individual
  observations or a combined DAT/EMA/CAWELON file with nested checksums.
- Inspect downloaded backup, checkpoint, identity and allowance files offline.

## Reproducible verification

On the publication candidate, the local unit suite passed **3,534 cases** and the
HTTP suite passed **33 cases**, with zero failures, cancellations or skipped cases.
The complete synthetic browser suite contains **289 cases**. GitHub Actions runs
the unit and HTTP suites, two intentional browser-error detection controls, and
three fresh-profile runs of that browser suite. Repeated browser runs are not
counted as additional unique tests.

The CI runner waits for a bounded, nonce-scoped completion receipt after actual
IndexedDB and file tasks finish, rather than ending on a virtual-time budget.
Synthetic session fixtures use shorter explicit real-clock deadlines; normal
application timeout defaults are unchanged. File-selection tests await completion
before selecting another file. The receipt endpoint exists only in the isolated
test runner and is not added to the normal demo server. The test page permits
same-origin completion requests; its policy continues to block external RPC.

```sh
node --test test/*.test.js
node --test integration/*server.test.mjs
# Linux with Google Chrome installed:
node scripts/test-browser-ui.js --verify-error-detection
npm run test:browser-ui
# Other platforms: start the isolated local test routes, then open /test/browser/
npm run demo -- --ui-test
```

Three additional CI jobs run the existing local-EVM compatibility harness against
pinned DAT, EMA and CAWELON contract repositories. Their status is reported by
GitHub Actions for the actual published commit. A local test result alone does
not certify a completed CI run.

## Size and preservation

The wallet repository's `.js`, `.mjs` and `.html` files total **42,355 physical
lines**, including comments and blank lines, compared with **15,911** at the
previous public commit: **26,444 net additional lines**. This includes test
fixtures, browser demonstrations, developer tools and preserved migration tests;
it is not a count of production-only or executable statements. Prose, JSON,
workflow configuration, logs and screenshots are excluded from this measure.

The latest local allowance iteration accounts for 4,633 of those additional
lines. The rest accumulated in preceding local development iterations. The
previous source snapshot and the final development files were backed up and
checked with SHA-256 before preparing the publication. Local test logs, user
downloads and browser-saved wallet data are not included in this publication.

## Practical limits

These are read-only development workflows. This update adds no transaction,
signing, approval, revocation, custody, swap, bridge or autonomous-spending method.
Synthetic fixtures do not prove live-wallet or production-dApp compatibility.
Three separate real-wallet accounts have not been established by these tests.
No new deployment, external game integration, AI model connection or independent
security audit is claimed.

Saved files and browser checkpoints contain public addresses and historical
balances, not keys, seed phrases or permissions. Browser storage is unencrypted
and scoped to that browser/origin. Checksums detect corruption; they do not prove
authorship, ownership, current balances or contract safety. Keep a separate file
backup before clearing browser data or changing the development server's origin.
