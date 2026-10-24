# Import cancellation and disposal — 2026-10-25

PC-only work based on `52280c9b78be82dadd8cde744debec3751786a23`.
The previous checkout remains unchanged and the new checkout has no remotes.
This change covers settings, whole-workspace backups, individual histories and
checkpoint-collection file readers. It changes no contract or wallet RPC code.

## Problem and reproduction

Each reader used a mutable abort-controller slot. Cleanup called `abort()`
before clearing that slot. Abort listeners are synchronous: a callback could
start a nested read, replace the slot, and have its controller lost when the
outer cleanup returned. A subsequent cancel could no longer signal that read.
Disposal also set its terminal flag after invoking cleanup, allowing new byte
access to begin during disposal. Some outer operations published a stale
`reading`, `idle` or `cancelled` state after a callback had already disposed them.

Metadata validation was another callback boundary: `name` and `size` accessors
could cancel the operation, yet byte access would still be requested afterward.
Settings/workspace readers also returned a successful result after a synchronous
ready observer had cancelled it. The settings reader retained accepted text in
its state after disposal.

The initial baseline run is retained as `baseline-reproduction.log`. The final
regression source and final baseline run are stored separately and cover the
additional history-reset path. Failed cases are variants across formats and
events; they must not be reported as that many independent vulnerabilities.

## Corrected behavior

- Detach the old abort controller before invoking its callbacks.
- Refuse reentrant read starts while cleanup is executing. A separate later
  file selection remains allowed after cancellation.
- Set disposal and its empty terminal state before cleanup, and make repeated
  disposal inert.
- Recheck the generation after cleanup before allocating/publishing a new read.
  Cancel/reset publication likewise cannot overwrite a newer terminal state.
- Capture each metadata field once and check cancellation before requesting
  byte access. Existing size, UTF-8, schema and checksum checks remain in place.
- After a ready notification, the boolean-returning readers verify that the
  operation is still current. History continues returning the actual current
  state, including a cancelled state.
- Contain synchronous display-observer exceptions consistently in settings and
  workspace readers, as the history reader already did. Observers do not grant
  read authority or alter file validation.

Underlying native IO may already be in progress. The shared file-read service
continues keeping its reservation until that native operation settles; stale
data is not accepted and a cancellation does not falsely free those resources.
The change does not claim that JavaScript can forcibly interrupt every native
array-buffer read or that a checksum authenticates the author of a file.

## Validation

`test/file-import-lifecycle.test.js` exercises all four reader adapters with
native AbortController signals, deferred results, cancellation/disposal during
cleanup and metadata access, retention of abort authority, and explicit later
reads. It also checks history reset, clearing disposed data and observer errors.

Two new browser cases mount the production settings and workspace panels with
native File/DataTransfer events. During cancellation an injected reader attempts
to trigger another file selection from its abort listener. The tests check that
no second byte read starts, the user's unfinished JSON remains, settings/history
are never automatically applied, and a separate later selection succeeds while
still requiring review. Existing cases cover native streams, byte budgets,
deadlines, malformed UTF-8 and saved data preservation.

Run the local server on port 4212 with `--ui-test`. The focused browser route is
`/test/browser/?suite=file-read` (25 cases); the full suite is `/test/browser/`.
Final full-suite counts, logs, screenshot proof and backup verification are in
the adjacent `wallet-import-lifecycle-verification-20261025` folder.
Repeated focused/baseline runs are not added to the passing full-suite total.

## Readiness gate

This closes another local interruption/data-preservation check in the read-only
testnet prototype. The existing acceptance scope and the still-pending real
DAT/EMA/CAWELON wallet checks remain as recorded in
`LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md`. Three distinct real accounts have not yet
been supplied. Test counts are not treated as a percentage; this iteration does
not mark that real-wallet gate complete or claim 90% overall completion.
