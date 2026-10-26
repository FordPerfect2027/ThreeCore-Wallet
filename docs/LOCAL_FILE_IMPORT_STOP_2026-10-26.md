# Local file import stop and error boundary review

Date: 2026-10-26. Baseline: `6efde66071f3f77ef553747e4e750e5a9921e0ea`.
Branch: `local/file-import-stop-20261026`. No Git remote is configured.
Existing local iterations and the published checkout remain unchanged.

## Reproduced defects

The settings, workspace and history file readers cleared accepted plaintext only
after invoking AbortSignal listeners. A cleanup callback could observe the old
ready snapshot during cancellation or replacement. The readers now install a
cleared stopped/reading state before calling cleanup. New file operations from
the stop notification are refused, while a later explicit selection still works.
History reset follows the same rule. Disposal retains its existing no-notification
contract and clears retained state before cleanup.

Direct state notifications could recursively trigger cancellation, and a rejected
promise returned by an observer escaped as an unhandled rejection. Readers now
use the existing bounded notifier. Its deduplication key contains only generation
and phase; imported account/history/backup content is not serialized into that
key. The application callback still receives the intended current import state.
The stop admission guard also covers delayed notification delivery, so a stopped
view queued by a reading callback cannot reopen a file when the queue drains.

Error inspection could invoke an accessor, reject the load promise instead of
recovering the UI, or publish an old error after inspection itself cancelled or
replaced the read. Settings and workspace readers could also expose arbitrary
strings carried by a typed error's code. A shared own-data-property code reader,
static per-format allowlists and a post-inspection generation check now contain
these failures. The existing provider error behavior is unchanged; local import
adapters use the new stricter helper. A hostile proxy can run its reflection trap,
but its exception is caught and any newer stop/dispose/replacement wins.

After reading the filename, readers now check cancellation before accessing the
next metadata property. A stop in filename lookup therefore prevents both size
lookup and file IO. Existing size, encoding, schema, checksum, stale-result and
explicit restore consent rules remain in force.

These are local application lifecycle defects, not evidence that a live wallet
or private key was compromised. Stop revokes the use of a result; it does not
promise to immediately terminate native work that has already started.

## Verification

The initial 24-case subset ran on unchanged baseline code: 23 failed and one
passed. The existing history unknown-code fallback already passed. These counts
include variations across three readers and are not independent vulnerability
counts. Three further cases exposed a delayed-notification gap in the first fix;
all three failed before that follow-up correction. The final regression file
contains 43 passing cases, including fresh
selection, disposal/replacement during error inspection, hostile reflection,
bounded notifications and strict unhandled-rejection subprocess checks.

Five added in-app-browser cases use native File objects and the real shared file
reader. Three exercise stop/retry for each format; two verify that an inaccessible
error cannot wedge the settings/workspace panel, overwrite an unfinished draft,
or authorize a restore. The focused 30-case browser suite passed, followed by the
full application suite. Test data are synthetic; no existing user database was
read or changed, and no real wallet permission or transaction was requested.

| Final suite | Passed | Failed |
| --- | ---: | ---: |
| Node unit | 11,455 | 0 |
| HTTP routing and isolation | 397 | 0 |
| In-app browser | 827 | 0 |
| Total, focused reruns excluded | 12,679 | 0 |

This is 48 additional cases relative to the previous local total of 12,631.
No cases were skipped or cancelled; no unexpected browser errors occurred.
Contracts, RPC/balance readers and transaction/signing implementations were not
changed. Earlier local-EVM results were not rerun or counted in this total.

```powershell
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4229'
node examples/dev-server.js --ui-test
```

Full browser suite: `/test/browser/`. Focused suite: `/test/browser/?suite=file-read`.

## Readiness and preservation

The scope remains the read-only three-token testnet prototype described in
`LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md`. Separate real DAT, EMA and CAWELON
wallet acceptance is deferred until the user's three accounts are available.
Passing tests do not establish a numerical overall completion percentage or a
new 90% milestone. This iteration is local only and has not been pushed to GitHub.

The adjacent `wallet-file-import-stop-verification-20261026` directory holds
before/after results, browser evidence, a Japanese report, and verified Git
bundle/ZIP recovery copies. Earlier source checkouts and backups are preserved.
