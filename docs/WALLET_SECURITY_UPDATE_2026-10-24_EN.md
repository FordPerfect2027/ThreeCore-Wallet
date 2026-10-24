# ThreeCore Wallet development and security publication — October 24, 2026

This source publication includes 15 locally preserved development commits after
the previous public commit `e01e7900967e3f0b5b381177e832533d7042503a`, ending at
`439b0080c923b60864820604da89caeff5b3e655`. It publishes accumulated work across
several iterations, including the latest security changes. Publication notes and
CI scheduling changes are added separately. This is not a website or contract
deployment.

## Development included

- Bounded ERC-20 transfer-history reads and reviewed JSON imports, with an
  explicitly saved history vault and restoration workflows.
- Balance/transfer reconciliation, resumable period collection, named period
  checkpoints and comparisons across DAT, EMA and CAWELON.
- Period reports, saved report history, continuity checks and multi-report
  review/export. Imported data is reviewed before application.
- Browser UI integration and offline inspection tools for these workflows.

## Security changes included

- Connection stop controls, idle/page-exit protection and cross-tab stop signals;
  explicit user action remains necessary to resume or reconnect.
- Read-only RPC enforcement, bounded request lifetimes and capacity, account and
  chain event validation, stale-response rejection and cleanup recovery.
- Optional passphrase-protected workspace backups using native WebCrypto
  PBKDF2-HMAC-SHA256 and AES-256-GCM. Authenticated decryption precedes a reviewed
  restore. Passphrases are not saved. Existing plaintext files and separate
  report collections are not automatically encrypted.
- An encrypted local backup library, validated archive handling, revision checks
  and recovery protections against stale or partial writes.
- Strict JSON/UTF-8 and file-size checks, bounded concurrent file imports,
  cancellation and rejection of results that arrive after a stop or timeout.
- A shared export guard used by 12 existing save/download paths. It validates
  filenames, extensions, MIME types and UTF-8 byte counts; limits concurrent
  temporary resources; and blocks new offers when cleanup is unresolved.
- Local-server response headers, explicit served-file routes and origin checks.

The latest export iteration added **3,319 lines**, removed **182**, and produced
**3,137 net additional lines** across 49 files: 569 added implementation lines,
2,607 added test lines and 143 documentation lines. These physical Git-diff
counts include comments and blank lines. They describe only that latest local
iteration, not the size of this entire publication or a security-quality score.

Across the complete accumulated publication, the repository's tracked `.js`,
`.mjs` and `.html` files grew from 42,362 to **97,321 physical lines**: **54,959
net additional lines** since the last public version. This includes application
code, tests, browser fixtures and tools, plus comments and blank lines; it excludes
prose, JSON, CSS and workflow configuration. These totals are reproducible from
the two source snapshots and are not a claim of production-only code.

## Verification evidence

The exact local development snapshot at `439b008` passed:

| Suite | Passed |
| --- | ---: |
| Node unit/regression tests | 9,508 |
| Local HTTP server tests | 256 |
| Synthetic browser UI cases | 609 |
| Total | 10,373 |

Final local runs had zero failures, cancellations, skipped cases or unexpected
browser errors. The total increased by 659 from the preceding local snapshot.
Repeated runs and individual assertions inside seeded traces are not counted as
additional cases.

Manual synthetic browser checks covered four active export leases, refusal of a
fifth, cleanup failure retaining all reservations, explicit recovery, invalid
filename rejection and expiry releasing a later lease. The normal application
also displays the shared protection status and cleanup controls.

CI runs these unit/HTTP checks, two intentional browser-error detection controls
and three fresh-profile browser runs. The regression job now has a 20-minute
upper bound and uses two concurrent Node test files, matching the successful
local execution settings for the larger suite. The three existing local-EVM jobs
continue to test pinned DAT, EMA and CAWELON repositories. Their actual results
must be read from GitHub Actions for the published commit; the local totals above
do not include those CI-only jobs or repeated browser runs.

```sh
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-concurrency=2 integration/*server.test.mjs
# Linux with Google Chrome installed, disposable synthetic browser profiles:
node scripts/test-browser-ui.js --verify-error-detection
npm run test:browser-ui
# Manual reproduction on other platforms:
npm run demo -- --ui-test
```

## Direct source files

- [RPC supervision](../src/rpc-supervisor.js)
- [Encrypted workspace backup](../src/secure-backup-crypto.js)
- [File import service](../src/file-read-service.js)
- [Shared export guard](../src/export-guard.js)
- [Transfer history reader](../src/transfer-reader.js)
- [Period report controller](../src/period-report-controller.js)

## Preservation and practical limits

The original local development copies, commit history and verified recovery
archives remain preserved. User downloads, wallet state, credentials and local
test logs are not part of this source publication. Earlier local design documents
remain historical records of their respective development snapshots; this note
describes the publication scope.

These remain read-only development workflows. The update adds no transaction,
signing, allowance approval/revocation, custody, swap or autonomous-spending path.
Synthetic tests do not establish real-wallet compatibility or production safety.
There has been no independent security audit. Export handoff success is not a
claim that a download has finished on disk. Resource limits are not a guarantee
about total browser memory, and stopping cannot cancel work already executing
inside a wallet extension or native cryptographic implementation.
