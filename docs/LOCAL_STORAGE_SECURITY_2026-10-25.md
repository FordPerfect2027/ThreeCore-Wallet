# Local storage security update — 2026-10-25

This change is developed in a separate local checkout based on `4e36425`.
It is not published to GitHub. The previous checkout and its history are preserved.
The scope is the browser's local persistence boundary for ThreeCore Wallet.

## Problems reproduced before the change

1. A caller could edit an operation while IndexedDB was opening. The later
   transaction would use the changed label/content instead of the reviewed input.
2. Cancellation invoked inside `canCommit` could abort the transaction yet still
   reach `put`. The adapter relied on the browser's abort behavior instead of
   refusing the write request itself.
3. Error translation could evaluate a supplied `name` accessor. Such accessors
   can throw or expose arbitrary prose to downstream error handling.

The local verification directory contains the before-change reproduction script
and its three output records. Regression tests cover the corresponding behavior
at the new boundary, including native IndexedDB persistence and rollback.

## What now happens

### Capture reviewed input

`change` captures both the expected revision/document and the operation before
opening or awaiting storage. The captured tree is detached and recursively frozen.
An edit to the caller's objects cannot replace that operation later.

The capture accepts JSON-shaped plain objects, ordinary arrays, finite numbers,
strings, booleans and null. It refuses accessors, symbols, sparse arrays, cycles,
class instances, functions and prototype-sensitive property names. It does not
invoke `toJSON` or an object's iterator. Shared acyclic values are copied.

The default structural caps are 1,000,000 visited values, 128 Mi UTF-16 code units
of strings/property names and depth 64. These are input-tree caps, not a promise
about total JavaScript heap use. Each domain model retains its stricter record
count, text-size and schema limits. No limit was increased in a domain model.

### Admit a bounded amount of native work

All five production adapters share one page-level guard with four active slots:

| Saved information | Existing database name |
| --- | --- |
| Workspace copies | `threecore-workspace-checkpoints-v1` |
| Encrypted backup library | `threecore-encrypted-backups-v1` |
| Saved periods | `threecore-period-library-v1` |
| Report history | `threecore-report-history-v1` |
| Transfer history vault | `threecore-transfer-vault-v1` |

There is no automatic queue, retry, eviction, deletion or migration. A fifth
operation receives a static busy error before a native open or transaction.

A caller may stop waiting promptly. The native operation's slot remains occupied
until an actual open terminal event or transaction completion/abort is observed.
Throwing `abort`, a delayed open or a missing native terminal event does not free
capacity merely because the caller was rejected. This prevents repeated cancelled
operations from bypassing the concurrency cap.

These slots are per page/module instance. They do not impose a global quota across
tabs, browsers or ports. IndexedDB's native transaction serialization and the
existing revision checks still arbitrate competing writers in separate pages.

### Recheck authority at use

The adapter checks liveness before transaction creation, after validating stored
data, after calculating a mutation, after `canCommit`, immediately before `put`,
and before accepting the transaction's completion.

Opening and transactions have separate absolute deadlines. The normal defaults
remain 8 seconds for open and 30 seconds for a transaction. Delayed timer delivery
does not extend either deadline. Elapsed time is also checked at each use point.
Clock continuity is checked across phases and operations on the same adapter.
Invalid or backward elapsed time closes the shared page's storage admission.

Native AbortSignal state is read through the native getter, so a shadowed own
`aborted` property cannot mask cancellation. Listener setup and cleanup failures
are contained. Policy hooks must return synchronously; a Promise cannot keep a
transaction's authority alive or authorize a write later.

### Preserve commit semantics

A successful `get` or queued `put` is not reported as saved. Success requires the
transaction completion event, valid captured data and a still-live caller.

Cancellation cannot promise to undo a native transaction that already committed.
If a queued write completes after its caller was stopped, the operation remains
rejected and the status reports an uncertain result. The user is asked to reread
the relevant list. There is no automatic compensating delete or overwrite.

Repeated and late callbacks cannot settle an operation twice, authorize new work
or replace a later operation's result. Corrupt records are rejected and preserved
for investigation instead of silently rewritten as an empty document.

## Screen integration

The wallet's security area now includes “PC内保存の保護”. It shows aggregate counts,
the four-slot limit, active phases, cancellations, timeouts and uncertain results.
It can request that current storage work stop. The display contains no account
addresses, labels, filenames, database names, balances, ciphertext or error prose.

The main security stop includes storage cancellation before export cleanup,
file-read cancellation, backup cleanup, period cancellation and DAT/EMA/CAWELON
disconnects. A failure in one cleanup step does not skip the others. Failed
cleanup continues to block resuming wallet access under the existing policy.

Read cancellation now reaches the underlying storage adapter from the workspace,
period, report-history and transfer-vault controllers. The read-only period-report
and report-set consumers also forward their cancellation signal to storage and
file reads. Generation checks continue to discard late views and exports.

## Verification approach

- Controlled native-event tests distinguish queued writes from durable data.
- Deterministic deadlines cover expiry without timer delivery, rollback of elapsed
  time, stale timer callbacks and timer installation/cleanup failure.
- Seeded reference-model traces check admission, phase totals, stop callbacks,
  terminal release, counters, disposal and clock faults after every step.
- All five domain formats are exercised through the shared adapter boundary.
- Controller tests cover cancellation during loading, review revalidation and
  source inspection, plus view-observer reentry and late file-reader results.
- Native browser tests verify save/reopen/readback, cancellation rollback,
  deadline rollback, simultaneous stale writers, future database versions,
  aggregate-only UI status and integrated whole-wallet stopping.
- HTTP tests check explicit routes, normal/test separation, CSP, same-origin
  imports, foreign request refusal and absence of mutation/data endpoints.

The browser fixture uses only fresh random names beginning with
`threecore-storage-guard-test-`. It never enumerates existing databases. Cleanup
checks fixture ownership before deleting its own test database. Production
database names and records are not touched by this verification.

Run the local tests:

```text
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
```

For native browser tests, launch `examples/dev-server.js --ui-test` with
`THREECORE_DEMO_PORT=4207`, then open `/test/browser/` in the in-app browser.
The storage subset is `/test/browser/?suite=storage-guard`.
The interactive proof is `/test/browser/storage-guard-demo/`.

The proof page writes fabricated records to its own new test database. It shows
that cancellation and expiry leave the original record and revision unchanged,
then reopens that same database and checks the persisted record again. Its clock
is deliberately controllable for reproducible expiry; the production clock is not.

## Practical limits

- These changes do not introduce private-key custody, signatures, transfers,
  token approvals, live dApp integrations or automatic external communication.
- Browser profile deletion, operating-system compromise, storage eviction and
  device failure still require separate backups and operational precautions.
- Same-origin arbitrary JavaScript is not sandboxed by this adapter. A malicious
  Proxy trap can execute code while being inspected; thrown traps fail closed,
  but JavaScript cannot preempt an infinitely running synchronous trap.
- A browser/native implementation that never reports terminal state may leave
  slots occupied until the page is reopened. The code does not assume an abort
  exception proves completion.
- The status is a transient page aggregate, not an audit log or durable receipt.
- The native proof uses synthetic data. It is not an independent security audit
  and is not evidence of additional live-wallet or mainnet testing.

Final measured line counts, test totals, local commit ID and backup hashes are
recorded in the adjacent local verification directory after all checks complete.
