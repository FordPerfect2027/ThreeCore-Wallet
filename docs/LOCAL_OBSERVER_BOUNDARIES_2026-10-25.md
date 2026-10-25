# Local status delivery and stop boundaries — 2026-10-25

This checkpoint improves the read-only ThreeCore Wallet prototype's status
delivery and file cancellation. It is a local development checkpoint. No remote
publication, transaction, signature, live-wallet operation or new dependency is
part of this change.

## Reproduced problems

The previous runtime was tested before editing it:

1. RPC, storage, backup computation, file reading and export guards each captured
   a status snapshot before iterating listeners. If an early listener stopped
   work, a later listener could still receive the earlier snapshot. Five tests
   reproduced the same stale-delivery mechanism in the five services.
2. A file-read listener notified during `cancelAll()` could start another read.
   That read was not in the already captured cancellation batch, and its source
   callback could execute. One test reproduced the escaped read.
3. A storage listener calling `cancelAll()` on every notification could queue an
   unending chain of microtasks. A normal timer never ran. A child-process test
   reproduced this with a five-second parent timeout, preventing the test runner
   itself from hanging.

These are seven reproduction cases, not seven independently audited security
vulnerabilities. The inputs and observers are synthetic, application-level
fixtures. No external exploit or lost user funds were demonstrated.

## Runtime changes

`src/state-notifier.js` centralizes aggregate status delivery. It obtains a fresh
snapshot immediately before each callback, skips listeners removed during a
delivery, and remembers the last delivered aggregate state per listener using a
WeakMap. Identical state does not create repeated feedback notifications.

Reentrant invalidations receive at most two delivery rounds in one turn. This
allows an ordinary stop from a later listener to update an earlier display while
bounding callbacks that continuously change service state. It does not guarantee
that every pathological, continually mutating listener observes a final state.
The synchronous `state()` method remains authoritative. Callbacks are observers,
not a background work scheduler.

RPC, storage and backup notifications remain deferred and coalesced. File-read
and export notifications remain synchronous. Explicit initial subscriptions in
the latter two services retain immediate delivery, including repeated explicit
subscriptions outside an active notification. Nested subscriptions cannot recurse
indefinitely. Thrown errors, rejected promises and rejecting thenables from one
listener are consumed so later listeners continue to run.

The notifier is internal infrastructure: its state readers return bounded,
frozen, flat records of primitive counters and status flags. The equality key
never serializes wallet addresses, provider objects, file names or file content.
Future consumers must maintain this contract; it is not an arbitrary object
serializer or a general event bus.

File reads now reject reentrant admission with `FILE_BUSY` while `cancelAll()` is
running. Recursive cancellation is idempotent. Normal explicit admission after
the cancellation call returns remains available, subject to the existing budget.
Native reads already started retain their reservations until they settle; a
local stop neither forcibly terminates native work nor releases capacity early.

## Verification and compatibility

- Unit tests cover fresh delivery, listener ordering, removal, disposal, callback
  rejection, bounded feedback, reentrant cancellation and subsequent admission.
- Browser tests mount the five actual status panels with synthetic work. They
  check the DOM during notification, not only after eventual settlement. The
  file test also uses the actual stop button.
- HTTP tests check the new runtime module, test-mode-only browser fixture,
  security headers, foreign-origin/frame rejection, no mutation endpoints and
  local import resolution. Existing explicit dependency inventories now include
  the shared notifier, without relaxing network or filesystem access rules.
- Full unit, HTTP and browser suites are run separately. Focused reruns and the
  deliberate baseline failures are not added to the final passing-test total.

Reproduction logs, final logs, measured diff, verified Git bundle and ZIP are
stored outside this checkout in the sibling verification directory. The starting
checkpoint is `66d9a3fa36302c382c14259264b928fb3f1493c5`.

Acceptance with three distinct real-wallet accounts remains deferred until the
user has those accounts ready. This checkpoint does not assign an overall
completion percentage or substitute for an independent security audit.
