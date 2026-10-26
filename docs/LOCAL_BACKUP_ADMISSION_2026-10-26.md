# Local encrypted backup admission and stop review

Date: 2026-10-26. Baseline: `1ea9e7acbbd726a927401f512c1d8afc8f58723e`.
Branch: `local/backup-admission-20261026`. No Git remote is configured.
The published checkout remains unchanged, and a before-development bundle is preserved.

## Reproduced problems

1. An observer stopping the secure backup controller during publication could
   leave the observer on its earlier encrypted, selected or decrypted snapshot.
   Internal state was restrictive, but its final notification was suppressed.
2. The panel prepared a new operation across external timer/parent cleanup
   callbacks without checking whether those callbacks had stopped or disposed
   it. Encryption or file reading could start after that stop. Recursive input
   could also reenter preparation. Credential inputs were cleared after calling
   the timer cleanup adapter, which could still observe them during that call.

These are application lifecycle and integration defects reproduced with local
fixtures. They are not evidence of stolen funds, exposed live credentials, or
19 independently exploitable vulnerabilities.

## Corrections

The controller uses the existing bounded state notifier, so a restrictive state
produced by a render callback is delivered after the callback returns. Duplicate
views and endless notification loops remain bounded. Notifications contain only
bounded status metadata, never passwords or backup payloads.

The panel captures an action revision before preparing encryption, file selection,
decryption or library opening. Stop, invalidation and disposal revoke that revision.
It rechecks after credential cleanup and parent notification before calling the
controller. Reentrant starts are refused, and old rejected promises cannot cancel
a newer operation. A hidden document cannot start a protected operation.

Credential fields and acknowledgements are cleared before external timer cleanup.
Dispose is guarded against recursive disposal. Parent cleanup continues to be
best-effort and rejected callback results are observed through the shared helper.
It does not grant write permission, and these changes do not add signing/spending.

A stop does not permanently disable a healthy panel: a fresh explicit action can
prepare, decrypt and stage a new backup. Returning to a visible page does not
automatically resume the stopped operation.

## Validation

The first 19 reproduction cases all failed on the unchanged baseline. The final
unit regression file contains 35 cases, including stopped dispatch, password
cleanup order, repeated callbacks, disposal, hidden documents and explicit retry.
Six added native-browser cases verify DOM controls, native File reading, real
WebCrypto, absence of writes/downloads, and successful fresh restoration.

| Final suite | Passed | Failed |
| --- | ---: | ---: |
| Node unit | 11,386 | 0 |
| HTTP routing and isolation | 397 | 0 |
| In-app browser | 817 | 0 |
| Total (focused reruns excluded) | 12,600 | 0 |

There are 41 added cases compared with the published local total of 12,559.
No cases were skipped, and there were no unexpected browser errors. Previously
verified local-EVM cases were not rerun or counted in this total; no contract,
RPC, balance-reader, signing or transaction implementation changed here.

Reproduction commands:

```powershell
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4227'
node examples/dev-server.js --ui-test
```

The browser suite is `/test/browser/`. The focused filter
`/test/browser/?suite=backup%20cleanup` runs six new plus three existing cases.
It uses isolated test data and does not request real wallet permissions.

## Readiness

The target remains the read-only three-token testnet prototype described in
`LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md`. The separate real DAT, EMA and CAWELON
wallet acceptance gate is still deferred until the user's three accounts are
available. No numerical overall completion or new 90% milestone is claimed.
Nothing from this iteration is pushed to GitHub or deployed to a live site.

The adjacent `wallet-backup-admission-verification-20261026` directory contains
the before/after logs, browser result list/screenshot, measurements, Japanese
report and verified Git bundle/ZIP recovery copies.
