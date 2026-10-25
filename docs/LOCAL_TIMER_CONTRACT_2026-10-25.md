# Local timer adapter and credential cleanup hardening

This is a local continuation of `0ff296591a3107c3bdb0234ba2f6f2cb73d14cce`.
No remote is configured in this checkout. Publication was not requested.

## Failure reproduced

The protected deadline previously accepted a Promise or thenable returned by an
injected `schedule` function as a valid timer handle. A handle must be available
synchronously: accepting a pending registration could authorize crypto work,
backup restoration, or a database open without establishing a cancellable timer.
An early timer callback could accept the same invalid replacement registration.
Rejected promises returned by `schedule` or `unschedule` could also escape as
unhandled rejections. Isolated Node child processes reproduced that behavior
under `--unhandled-rejections=strict`.

This is a defect in the internal adapter contract. It is not evidence that an
external website can supply these callbacks, bypass encryption, or steal funds.
The production default continues to use synchronous native timer handles.

The browser checks additionally found that, after a timer fault was latched,
later password input could remain in the DOM with no active credential lifetime.
The same boundary applies to autofill that does not emit an input event.

## Changes

- `createSecureDeadline` rejects asynchronous handles with `SECURE_TIMER` before
  granting authority. The fault remains latched for the lifetime of that object.
- The adapter's `then` is captured once. Its resolution/rejection is observed;
  a late resolved handle is passed to cleanup, never installed as an active timer.
- A throwing `then` accessor fails closed and attempts cleanup of the handle.
- Timer cleanup observes rejected asynchronous results. A failed cleanup does not
  restore authority or imply that a native timer was physically removed.
- Existing revision checks continue to invalidate stale callbacks after stop,
  disposal, or an unsuccessful replacement timer.
- The backup screen clears subsequent password input and autofill-at-use while
  the credential deadline has a latched fault and shows the existing timer error.
  Opening a fresh screen creates a new deadline; the failed object cannot recover.

The adapter functions remain trusted application dependencies. They must follow
their documented synchronous scheduling contract. This code does not sandbox
arbitrary JavaScript, forcibly stop pending computation, or guarantee zeroization
of JavaScript strings. Native timer handles, including zero, remain supported.

## Regression evidence

The final 14 new API cases, applied to the unmodified baseline runtime, produced
13 failures and 1 compatibility pass. These are variations of the same adapter
boundary, not 13 independent vulnerabilities.

Three new browser cases use the real backup screen, native File/DataTransfer,
synthetic account data, and browser cryptography. All three failed on the baseline
and passed after the fixes. A runtime-only intermediate run exposed the remaining
credential re-entry problem before the screen fix was added.

Coverage includes initial/replacement registration, delayed resolution after
clear/dispose, thenable rejection and throwing accessors, crypto work admission,
encrypted-file selection, database read/write admission, asynchronous cleanup
rejection, opaque synchronous handles, repeated input, autofill, stale callbacks,
and absence of unintended writes or downloads.

Full unit, HTTP isolation, and browser results are recorded separately in the
sibling `wallet-timer-contract-verification-20261025` directory. Repeated focused
runs are not added to the full-suite total. The unchanged contract EVM suite is
not rerun or included in this iteration's count.

## Preservation and remaining acceptance

The preceding local checkout and the published snapshot are retained unchanged.
This checkout has a before-development bundle; final bundles, ZIP, checksums,
source-line measurements, and the Japanese report are in the evidence directory.
Test-only database names and synthetic data are used; user backups, wallet keys,
transaction signing, remote RPC, and real accounts are not used in these tests.

Acceptance with three distinct real wallet accounts remains deferred at the
user's request. Automated test counts are not a measured completion percentage
or a substitute for that acceptance step.
