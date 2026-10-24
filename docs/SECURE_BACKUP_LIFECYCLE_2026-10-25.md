# Backup lifecycle and local restore hardening — 2026-10-25

This development snapshot builds on `f14ba98` in a separate local checkout.
It has not been pushed to GitHub. The preceding release checkout is preserved.

## Problems reproduced before this change

The pre-change reproduction in the sibling verification directory demonstrates:

1. A synchronous slow crypto adapter could finish after its deadline but before
   the event loop delivered the timeout callback. Its late result was accepted.
2. An abort-listener registration failure rejected the caller, but work could
   still be invoked in the following microtask.
3. Cancelling from the initial controller notification could be overwritten by
   the remainder of initialization, allowing encryption to proceed.

These reproductions use synthetic fixtures only. They do not demonstrate theft,
contract compromise, a bypass of AES-GCM, or an exploit of a wallet extension.

Further review found gaps around reentrant download/stage callbacks, unsupported
async restore adapters and the lifetime of decrypted data passed to the parent
workspace screen. These paths are covered by new regression tests.

## Operation deadline

`src/secure-deadline.js` provides an absolute elapsed-time boundary. Timer delivery
is a cleanup aid; access is separately checked before work and before using data.

- The default operation timeout remains 60 seconds.
- Selected, encrypted and decrypted candidates have a maximum 120-second lifetime.
- The upper configurable lifetime is 120 seconds; callers cannot extend it beyond
  that cap through a larger option.
- The default clock is `performance.now()`.
- A rollback, nonfinite reading, throwing clock or unrepresentable deadline
  fails closed. A clock fault remains latched for that object.
- Timer setup failure, a synchronous timer callback and a missing handle fail
  closed. Repeated old callbacks cannot grant access or cancel newer work.
- Early timer callbacks retain the original deadline.
- Cleanup exceptions cannot turn cancelled or expired access into valid access.

A browser or OS may suspend JavaScript completely. No code can clear memory while
it is not executing. The checks prevent reuse after an observed elapsed deadline;
cleanup runs when execution resumes. The application cannot securely erase all
JavaScript string copies or control the platform's memory allocator.

## Native crypto capacity and cancellation

`src/secure-backup-runner.js` still permits only one outstanding operation in its
shared JavaScript realm. There is no retry queue.

Cancellation and timeout settle the local caller promptly, but native WebCrypto
cannot be forcibly aborted. Capacity remains occupied until actual settlement.
The UI calls this state **waiting for cancelled crypto to finish**. It does not
claim that native computation has already stopped.

Signal setup is completed before dispatch. A failed or partial listener install
prevents backend work. Captured cleanup methods retain their original receiver.
The runner checks silent signal aborts and elapsed time at dispatch, stage guards
and result acceptance. It consumes late rejections without accepting their data.

A bounded subscription interface provides frozen aggregate status to the UI.
There are at most 16 observers. Observer failures cannot break peer observers or
leak secrets. Status includes counts, phase and fault flags, not passwords,
addresses, filenames, backend errors, ciphertext or decrypted contents.

Other browser tabs have separate JavaScript realms. This is a per-page resource
limit, not a global operating-system CPU limit or a sandbox against same-page
malicious JavaScript.

## Controller ownership and handoff

`src/secure-backup-controller.js` establishes operation identity and cancellation
before invoking observers. It checks ownership again after external callbacks.

- Cancelling during an initial notification prevents dispatch.
- A late old result or failure cannot replace a newer selection.
- Reentrant download callbacks cannot create duplicate download offers.
- A failed old handoff cannot erase the next operation's state.
- Encryption results are reconstructed with canonical filename, MIME type and
  byte length. Mutable backend metadata is not retained.
- Text is read from an own data property, without ordinary accessor invocation.
- Decrypted content remains subject to the existing workspace schema validation.
- Both encrypted and decrypted ready results expire at use as well as by timer.
- Expired, cancelled and failed results clear content references and summaries.

Restoration still requires an explicit stage, preview and confirmation. A
checksum and successful password authentication do not establish token ownership
or the author of an imported file.

## UI and workspace write boundary

The backup screen uses separate lifetimes for entered passwords and staged
plaintext. Editing a new password cannot extend a previous decrypted result.
The existing page-hide protection also runs on page-show to prevent stale page
state from restoring a sensitive handoff.

The parent workspace checks staged-data validity before preview and apply. A
final authorization hook is also checked immediately before the local write,
after validation and copy preparation. Expiry during validation therefore cannot
silently authorize the write. Cancelling the encrypted restore clears its JSON
field and review controls.

The workspace coordinator now prevents nested operations during draft inspection
and authorization. Cancellation invalidates the review being inspected. Expected
write state and rollback state are isolated from the adapter using validated,
frozen copies. Native adapter error prose is not copied into rollback messages.

If a local write fails, rollback remains permitted even if the original restore
lifetime has elapsed. If rollback cannot be verified, the pre-write recovery draft
is retained. This is a local form/history transaction, not a blockchain transfer.

Adapters must remain synchronous. Promise-returning writers or authorizers are
rejected and rejection outcomes are observed. The coordinator cannot undo future
side effects inside arbitrary third-party async code; such adapters are not
supported. The production wallet adapter remains synchronous.

## Tests and reproducible checks

The new suites cover absolute deadlines, timer/signal faults, reentrant callbacks,
result ownership, decrypted-data expiry, rollback preservation, status privacy,
real native crypto stages and browser DOM behavior.

Twenty deterministic model traces additionally exercise 2,432 operation steps:
12 shared-panel traces of 96 actions and 8 deadline traces of 160 actions. These
are counted as 20 tests, not as 2,432 independently passing tests.

Run the normal checks from this checkout:

    node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
    node --test --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs

For browser verification, start the loopback server with `--ui-test` and open:

- `/test/browser/` for the full native browser suite.
- `/test/browser/secure-lifecycle-demo/` for the synthetic expiry walkthrough.

The walkthrough makes no extension requests, transactions or external network
calls. It demonstrates an expired restore being refused with zero workspace
writes. Its short virtual clock exists only in test fixtures. Production screens
use the normal elapsed-time clock.

The additional test routes remain unavailable without `--ui-test`. Runtime
modules retain the existing exact loopback Host/Origin checks, CSP, no-store and
nosniff headers. No upload, database or signing endpoint was added.

## Verification record and scope

Exact final test counts, changed-line measurements, hashes and the browser proof
are in the sibling `wallet-backup-lifecycle-verification-20261025` directory.
Repeated focused runs are not added to the unique test total.

The final local run passed 9,818 unit/native-crypto tests, 284 HTTP integration
checks and 626 browser tests: 10,728 unique checks, zero failures and zero
unexpected browser errors. The baseline had 10,382 checks; this change adds 346.
The deterministic model's 2,432 internal steps remain included in its 20 tests.
The screenshot walkthrough also confirmed that an expired restore clears its
staged plaintext and leaves the workspace write counter at zero.

This change does not alter token contracts, the backup file schema, the chosen
PBKDF2 parameters or AES-GCM algorithm. It does not add send, approve, permit,
signing or key-custody capabilities. Existing saved files remain compatible.

No real wallet or real funds were used for these tests. Independent security
audit, production hosting review and platform security remain separate work.
