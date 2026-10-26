# Local encrypted backup library lifecycle review

Date: 2026-10-26. Baseline: `a9f1eaff00a770e51e5820716f84bd6831c1bd81`.
Branch: `local/library-lifecycle-20261026`. No Git remote is configured.
The previous local iteration and the published checkout remain unchanged.

## Reproduced behavior and correction

The encrypted library controller captured a deletion review before calling its
clock adapter. If that synchronous callback cancelled the operation or changed
the selected record, the captured review could still be submitted to storage.
Review generation could also publish a new review after its clock callback had
cancelled or disposed the controller. Reviews are now tied to the current action
generation and checked again after the callback, before storage or publication.
Selection changes invalidate old authority; expired or revoked consent is not
reused by a later request. Review expiry must remain within safe integer bounds.

Cancellation previously notified synchronous AbortSignal listeners before clearing
the inventory. A cleanup listener could observe old record metadata and start a
replacement read. Cancellation now revokes and clears state first, blocks new
requests during cleanup, then aborts pending work. Disposal follows the same
ordering and observes rejected cleanup promises.

The asynchronous wrapper previously chose a successful return value before the
final state observer ran. An observer could then cancel while the caller still
received true. The return value now checks the final action generation after
notification. Export and selection results use the same final-lifetime rule.
A stop after an IndexedDB transaction has already committed cannot undo that
transaction. Tests explicitly distinguish this case from pre-commit revocation;
the latter preserves the complete stored document and revision.

Status uses the existing bounded notifier to prevent recursive stop notifications
and observe asynchronous callback failures. Callback results are classified using
the shared helper, reading a then accessor only once. Asynchronous open/clock
results are refused and rejected promises are consumed. Storage errors always
pass through the existing safe mapper; accessor-backed and unknown codes cannot
leak private diagnostic text into visible status. Notifications contain bounded
metadata, never backup payloads or passwords.

## Evidence

An initial 15-case reproduction subset ran against the unchanged baseline: one
passed and 14 failed, with no skipped or cancelled tests. The passing dispose
confirmation case was an existing protection, not a newly fixed bug. These are
scenario counts, not 14 independently exploitable vulnerabilities. The initial
fixture run is retained separately; its pending-read timeout was corrected before
the final baseline reproduction. The final regression file has 26 passing cases.

Five added native-browser cases exercise the mounted panel and actual isolated
IndexedDB stores: protection/reselection during confirmation, protection during
review creation, cancellation during completion, and a reentrant abort listener.
They verify intact stored ciphertext, cleared controls and successful fresh
explicit consent after revocation. The focused 23-case library browser suite
passed before the full application run. Test databases are disposable fixtures;
the user's saved wallet database was not accessed or modified.

| Final suite | Passed | Failed |
| --- | ---: | ---: |
| Node unit | 11,412 | 0 |
| HTTP routing and isolation | 397 | 0 |
| In-app browser | 822 | 0 |
| Total, focused reruns excluded | 12,631 | 0 |

There are 31 additional cases compared with the previous local total of 12,600.
None were skipped. No unexpected browser errors occurred. Earlier local-EVM
cases were not rerun or included: contracts, provider connections, balance reads,
signing and transaction implementations were unchanged by this iteration.

```powershell
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4228'
node examples/dev-server.js --ui-test
```

Full browser suite: `/test/browser/`.
Focused library suite: `/test/browser/?suite=encrypted-library`.

## Readiness and preservation

The scope remains the read-only three-token testnet prototype described in
`LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md`. Separate real DAT, EMA and CAWELON
wallet acceptance remains deferred until the user's three accounts are available.
No numerical overall completion or 90% milestone is inferred from passing tests.
There were no real-wallet transactions, account permission changes or external
publication. GitHub has not received this iteration.

The adjacent `wallet-library-lifecycle-verification-20261026` directory contains
the reproduction logs, full results, browser evidence, a Japanese report, the
before-development Git bundle, and verified final bundle/ZIP recovery copies.
