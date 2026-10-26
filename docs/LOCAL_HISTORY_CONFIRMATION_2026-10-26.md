# Local history capture and import confirmation

Date: 2026-10-26. Baseline: `537dcfdb562995ebb964af7a75600344d696700b`.
Branch: `local/import-confirmation-20261026`. No Git remote is configured.
The source checkout and its pre-change Git bundle are preserved.

## Problems reproduced and corrected

Portfolio snapshot validation inspected property descriptors but subsequently
read the values again from the input object. A changing Proxy could supply
different data for those reads. The holdings array also supplied its own `map`
method and indexed values. A custom method could skip validation, and an indexed
accessor could run while importing a snapshot.

The new bounded data capture helpers copy own data descriptor values first.
Snapshot and holding validation use only those copies. Input array methods,
iterators, index accessors and species constructors are not used. Extra keys,
sparse arrays and out-of-bounds collections are rejected. Reflection on a Proxy
can still execute its traps; this is not a sandbox for arbitrary JavaScript.
These regression fixtures describe an in-process data/adapter boundary, not
executable code in a JSON file or an observed compromise of a user's wallet.

History batches now record the destination revision before capturing input and
check it again before committing. A clear, append or replacement made during
validation is retained; the obsolete outer batch cannot overwrite it.

Import confirmation now has a cancellation generation, an active-operation guard
and disposal. Every adapter read is checked before and after capture. A malformed
new preview invalidates the older proposal before reading options. Adapter methods
are captured once. Options accept only data fields; omitted/undefined mode retains
the existing merge default, while replacement requires the explicit boolean true.

An apply attempt consumes its proposal and checks the document, destination and
current merge/replacement mode. It rereads the destination after a synchronous
writer and verifies the expected contents and revision rather than trusting a
success-shaped receipt. A failed, asynchronous or mismatched write cannot claim
success and locks further import attempts until the host reconciles the actual
history and remounts the controller. It does not perform a speculative rollback
over newer edits, nor can it prevent a nonconforming asynchronous adapter from
finishing work it already started. Rejected asynchronous receipts are consumed.

The history panel validates and copies a snapshot before comparing its token
identity, and submits the currently displayed import mode at apply time. Silent
form-state changes therefore require a fresh review. Closing the panel disposes
its import controller. Existing reviewed replacement and recovery work for DAT,
EMA and CAWELON with exact archive preservation.

## Verification evidence

The first 33 targeted regression cases failed on the unchanged baseline.
They are variations across three tokens and failure modes, not 33 independent
vulnerability claims. The final new Node file contains 96 tests, including normal
roundtrips, cancellation/disposal, late writers, incomplete receipts, exact units,
malformed destination state and strict unhandled-rejection subprocess checks.
Nine additional in-app browser tests exercise actual mounted panels.

The initial whole-suite run identified a compatibility issue when merge mode was
explicitly undefined. That was repaired and given a regression case. The initial
HTTP run also hit three module-graph bounds; each bound was raised by exactly one
for `security-data.js`, with local dependency checks retained. The earlier failed
logs are retained beside the final results, not counted as passing evidence.

Final counts and the verified revision are recorded in the adjacent
`wallet-import-confirmation-verification-20261026/verification-final.json`.
Focused reruns are excluded from the overall total. The browser fixtures use
synthetic data and do not request wallet permissions or transactions.

| Final suite | Passed | Failed |
| --- | ---: | ---: |
| Node unit | 11,551 | 0 |
| HTTP routing and isolation | 397 | 0 |
| In-app browser | 836 | 0 |
| Total | 12,784 | 0 |

There are 105 additional tests relative to the previous comparable total of
12,679. No tests were skipped or cancelled and no unexpected browser errors
occurred. Code/tests: 613 lines added, 69 removed, net 544. The requested 8,000
lines were a guideline; this iteration records the actual necessary changes.

```powershell
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4230'
node examples/dev-server.js --ui-test
```

Browser suite: `/test/browser/`; focused history suite: `/test/browser/?suite=history`.

## Readiness and preservation

Scope remains the read-only testnet prototype in
`LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md`. This iteration strengthens history input,
consent and commit verification. It does not establish a new numerical overall
completion percentage. Separate real DAT, EMA and CAWELON account acceptance is
still pending the user's wallet availability: connection permissions, balances,
save/reload/restore, explicit reconnection and account/network change handling.

Only the new local checkout is edited. GitHub is not updated. Recovery artifacts
include the starting Git bundle, a final Git bundle and a ZIP checked against
every tracked file in the final local commit. Code/test line counts exclude this
document, generated logs, unchanged files and line-ending-only differences.
