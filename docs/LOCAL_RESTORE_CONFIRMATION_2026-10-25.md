# Local restore confirmation and provider cleanup review

Date: 2026-10-25. Baseline: `fb9cd5efc235e2b8e66d50e5f5a2cec532d69c58`.
Branch: `local/restore-confirmation-20261025`.
The preceding checkout is preserved. This checkout has no Git remote.

## Scope

Review the boundaries between preview, local writes, readback, recovery export,
and provider discovery. The application still connects only through separately
reviewed wallet operations. Importing settings does not connect a wallet or
authorize a transaction. No production account, key, or transaction is used in
these regression tests.

## Reproduced defects and corrections

### Preparation failure and negative write receipts

Both workspace restoration and the three-card settings review previously
ignored an explicit `false` from a synchronous preparation callback. The local
writer could therefore run even though the disconnect/preparation adapter had
refused the operation. Preparation now requires a synchronous, non-false result.
Void-returning native adapters remain compatible. Write authorization still
requires the existing exact `true`.

A negative write receipt is no longer counted as success merely because the
destination currently matches the candidate. Workspace restoration attempts its
existing synchronous rollback and verifies that result. Negative or invalid
rollback receipts retain the original recovery copy and block further restores.

### An unsettled writer cannot establish rollback

A writer returning a promise may mutate the destination after a second write
has apparently restored it. The controller now retains the pre-operation draft,
blocks another restore, and reports recovery required. It does not race that
unsettled writer with a speculative rollback or claim that the original state
has been restored. The settings-only controller similarly blocks new previews
after an asynchronous or unreadable write receipt.

This guard does not cancel arbitrary work already started by a nonconforming
adapter. It prevents further authorization and false success claims. Production
adapters must still perform their local writes synchronously.

### Verify all three settings destinations

The settings controller now reads DAT, EMA, and CAWELON back after applying a
review. It compares normalized public addresses and network identifiers with
the immutable reviewed plan. A no-op writer or a missing update on any one card
cannot produce an all-card success message. Whitespace, normalized address case,
and explicitly empty addresses retain their established semantics.

A partial synchronous result is left visible for review rather than silently
overwritten. The old approval is consumed; a subsequent explicit preview uses
the actual current fields and lists only the remaining changes. Cancellation
and disposal during readback prevent confirmation.

### Recovery exports and backup status

Workspace backup, overview, recovery-copy, and wallet-settings downloads now
inspect the delivery callback result. Explicit refusal, promises, and unreadable
receipts cannot set a successful download message or backup marker. Cancellation
or closing the panel from within delivery cannot restore a stale success message.
Failed delivery preserves data and the pre-operation recovery text for a fresh
explicit save attempt.

Successful delivery means the browser download was offered. It is not evidence
that the operating system completed the disk write.

### Discovery lifetime and cleanup

Provider discovery captures the event target's methods once. Failed or asynchronous
listener registration prevents discovery from starting. Failed initial dispatch
cleans up the listener before returning a bounded construction error. Late
registration completion performs another detach.

Disposal clears retained provider references before invoking external removal
code. Throwing removal and late announcements cannot revive the registry. A
failed refresh ends that registry's lifetime, and an observer disposing it during
dispatch prevents a success return. Discovery never calls the provider's account,
signing, or transaction methods.

### Callback failures

The existing shared callback observer is applied to restoration, encrypted backup,
provider notification, protection cleanup, and aggregate state notification.
It captures `then` once and observes rejected native promises returned by malformed
async `then` methods. Asynchronous source reads are rejected at synchronous
snapshot boundaries. Later settlement cannot turn a rejected receipt into approval.
Cleanup still attempts each configured protection step and reports bounded names.

## Regression evidence

New unit files cover 108 cases. In the baseline runtime, 92 fail and 16 pass.
These include negative receipts, partial writes for each token, cancellation,
late writes, cleanup failure, malformed callbacks, and positive compatibility.
The failures are scenario variants, not 92 independently exploitable vulnerabilities.

The 22 new browser cases run against real DOM elements, native `File`, `Blob`,
`DataTransfer`, and `EventTarget` objects. Baseline: 2 pass and 20 fail.
They exercise visible failure notices, one-use confirmation, explicit retry,
restoration into a new panel, and preservation of the original recovery copy.

Existing review tests were corrected to make successful fixture writers actually
update their fields. The previous async-write test now expects preserved recovery
data rather than an unproven rollback. These are changed expectations for the
documented adapter contract; regression cases for genuine synchronous rollback
remain in place.

Validation commands:

```text
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
THREECORE_DEMO_PORT=4225 node examples/dev-server.js --ui-test
```

The environment variable is set using the host shell. Browser verification is
performed in the existing in-app browser at `/test/browser/`. The
`?suite=restore-confirmation` filter selects the 22 added screen cases.
Test-only modules remain unavailable from the normal demo server; route isolation
is included in the HTTP checks. Logs, browser result lists, measurements, and
verified recovery archives are stored in the adjacent verification directory.

## Remaining acceptance work

Distinct real DAT, EMA, and CAWELON wallet acceptance remains deferred at the
user's request until the three addresses are ready. Synthetic tests and passing
checks do not establish a numeric percentage of real-wallet readiness. The
overall 90% milestone is not newly asserted by this change. No GitHub publication
or production deployment is included.
