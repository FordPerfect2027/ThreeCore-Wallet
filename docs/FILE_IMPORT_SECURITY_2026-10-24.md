# Local file import boundary

This update adds a shared resource and cancellation boundary to ThreeCore
Wallet's local file readers. It continues from the local RPC supervisor snapshot
`9aaec26b89a612a1030bd120ea1894175958a956`.

The source repository remains local. No GitHub remote is configured in this
working copy. Publication is a separate action requiring the user's instruction.

## Behavior

All production file-reading entry points use one default `walletFileReadService`
within a page. Plain text import and byte-preserving import share the same
capacity. Each format continues to apply its own smaller input limit, JSON
schema, checksum validation, review and explicit application steps.

The main screen displays aggregate file-read state and provides an explicit
button to stop currently waiting reads. The existing three-token protection
stop also cancels file reads before cleaning backup and report views and
disconnecting DAT, EMA and CAWELON sessions.

Neither button deletes or overwrites saved files. Reading a file does not itself
authorize a connection, signature, token approval or transaction.

## Enforced limits

| Boundary | Value | Scope |
| --- | --- | --- |
| Outstanding workers | 4 | One service instance, shared by production readers on the page |
| Reserved declared input | 128 MiB | Sum of unresolved workers' declared input sizes |
| Maximum single input | 96 MiB | Formats usually impose a smaller limit |
| Default read deadline | 30 seconds | Metadata, stream acquisition, reads and final assembly |
| Accepted custom deadline | 1–120,000 ms | Integer milliseconds |
| Stream chunks | 100,000 | Includes zero-length chunks |
| Status observers | 64 | Unique observer identities |

Input-byte reservations are not measurements or upper bounds of JavaScript heap
usage. Copies, decoded strings, decoder state and per-chunk overhead consume
additional memory. A selected file can require more memory than its byte size.

There is no queue. A rejected input is not retried automatically. A UI must ask
the user to repeat a file selection after capacity becomes available.

## Separate lifetimes

A read has two distinct lifetimes:

1. The caller waits for either a value or a fixed error code.
2. The actual native or adapter read may remain outstanding after that wait ends.

Cancellation or expiry ends the caller's wait promptly and clears accumulated
application buffers. The service attempts captured stream cancellation and lock
release. It continues to reserve a slot and declared input bytes until the
worker's actual awaited operation settles.

An `arrayBuffer()` fallback cannot be forcibly interrupted. Its late fulfillment
or rejection is consumed, discarded, and then releases the reservation. Repeated
local cancellation cannot manufacture extra capacity while work remains pending.

A native stream normally settles its pending read when cancelled or when the
reader lock is released. A custom adapter may ignore those operations. Tests
cover both behaviors without assuming that cancellation succeeded upstream.

Cleanup promises are best-effort and are not awaited as additional file data.
Their errors do not replace the established read outcome. This boundary accounts
for read work; it does not claim to supervise arbitrary work inside an adapter's
cleanup implementation.

## Source validation

- The service captures declared size and the chosen reader methods before use.
- It prefers the stream method and never falls back after a broken stream.
- An unused `arrayBuffer` getter is not evaluated when a stream is available.
- Stream methods retain their original receiver and captured identity.
- `done` and `value` must be own data fields, not getters or inherited fields.
- A terminal packet cannot carry a non-undefined payload.
- Stream chunks must be branded `Uint8Array` values.
- ArrayBuffer fallback output must have the exact declared byte length.
- Shared memory, detached buffers, proxies and other typed-array types are rejected.
- Each chunk is copied before another await, so buffer reuse cannot rewrite prior chunks.
- Text mode uses fatal UTF-8 decoding across chunk boundaries.
- Byte mode preserves original bytes, including a BOM, for established format decoders.
- Actual size must match the declaration; oversize input stops further reads.

Size and type checks use captured built-in buffer accessors. Shadowing a view's
`byteLength`, `byteOffset` or `buffer` property does not alter those checks.

## Deadline and cancellation checks

Monotonic time is checked before dispatch, after each await, during stream
setup, during chunk acceptance, and before a completed value is returned.
The exact deadline is rejected. A delayed timer cannot turn an expired result
into a success. An early timer is rearmed for the remaining duration.

A non-finite, negative, rolled-back or numerically unsafe clock value latches
`FILE_CLOCK`. Current waiters fail and the instance refuses new input. The
aggregate UI explains that the page must be reloaded.

Signal registration and removal methods are captured. Synchronous registration
failure, rejecting registration, abort during setup, and throwing cleanup are
handled without exposing the underlying exception text. A cancellation epoch
also prevents metadata callbacks from cancelling a batch and then starting an
older admission attempt afterward.

## Format compatibility

| Entry | Boundary | Later validation remains |
| --- | --- | --- |
| Wallet settings | Byte reader | Settings schema and account separation |
| Workspace backup | Byte reader | Workspace schema and SHA-256 checksum |
| Checkpoint collection | Byte reader | Collection decoding, limits and entry checks |
| Per-card history | Byte reader | History schema and token selection |
| Allowance file | Byte reader | Target/observation schema and checksum |
| Allowance bundle | Byte reader | Three records and bundle checksum |
| Token identity file | Byte reader | Identity schema and checksum |
| Transfer archive | Text reader | Archive schema and checksum |
| Vault collection | Text reader | Portable collection schema and checksum |
| Period and period library | Text reader | Existing period validation |
| Period report and report history | Text reader | Existing report validation |
| Report set | Text reader | Existing set validation |
| Reconciliation | Text reader | Existing reconciliation validation |
| Transfer and vault files | Text reader | Existing record validation |
| Encrypted backup and library | Text reader | Existing encrypted envelope validation |

The public format error vocabulary is preserved. Boundary refusal, cancellation
and timeout map to the format's existing read error. Size and UTF-8 errors map to
the existing size and encoding errors. No format version or cryptographic
algorithm changes in this update.

The settings, workspace, checkpoint and history reader controllers now pass an
AbortSignal and their format limit to the byte reader. Superseding input,
cancellation, reset where available, and disposal abort the previous read.
Existing generation checks still prevent stale decoded candidates from replacing
newer state. Injected readers remain supported for deterministic tests.

## Aggregate UI and privacy

The status schema contains counts, flags, and configured limits only. It carries
no filename, filesystem path, content, public wallet address or adapter error.
The UI rejects extra fields, getters, inconsistent counters and invalid types.
Descriptions are fixed application text rendered with `textContent`.

The display distinguishes active waiters from locally stopped but unresolved
workers. Removing a panel unsubscribes its observer; it does not dispose the
shared service used by other parts of the same page.

The service stores no diagnostic history on disk, in localStorage or IndexedDB.
It has no network, export, wallet, signing or transaction capability.

## Limits of the protection

This is not a sandbox for arbitrary JavaScript that already executes in the page.
A hostile adapter can allocate memory before returning, block the JavaScript
thread synchronously, or ignore cancellation. The guard bounds what the
application admits and accepts; it cannot preempt such JavaScript.

The read deadline ends when the read returns bytes or text. Later JSON validation,
checksum work, decryption, review and persistence retain their own existing
controls. Read completion is not proof of a successfully applied import.

A valid checksum detects accidental or unkeyed modification; it does not prove
authorship, current chain state, ownership, safety, or an independent audit.

Capacity and counters belong to this page. Other tabs and browsers have separate
instances. Reloading abandons this page's memory but does not modify saved files.

## Reproduction

Use the project's existing Node.js runtime. No package installation is needed.

```powershell
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4203'
node examples/dev-server.js --ui-test
```

- Full synthetic browser suite: `http://127.0.0.1:4203/test/browser/`
- Focused file suite: `http://127.0.0.1:4203/test/browser/?suite=file-read`
- Interactive synthetic checks: `http://127.0.0.1:4203/test/browser/file-boundary-demo/`
- Normal local application: `http://127.0.0.1:4203/`

Synthetic harness routes are unavailable without explicit `--ui-test` mode.
They use generated data and never access an installed wallet.

Verification logs, a machine-readable summary, and the preserved Git/source
archives are kept in the sibling `wallet-file-boundary-verification-20261024`
directory. Final counts are recorded there from actual completed runs rather
than inferred from the number of test definitions.

## Reference semantics

Native stream read and release behavior follows the
[WHATWG Streams specification](https://streams.spec.whatwg.org/#default-reader-read).
Browser Blob and File behavior is described by the
[W3C File API](https://w3c.github.io/FileAPI/#blob-section).
Custom adapter policy above is deliberately narrower than arbitrary JavaScript
objects; those restrictions are application policy, not claims about every
possible platform stream implementation.
