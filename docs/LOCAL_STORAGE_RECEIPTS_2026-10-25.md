# Local storage and export receipt review — 2026-10-25

This PC-only change starts at `319776268b57b54e7d35efd167b4d1178a80481d`
on `local/storage-receipts-20261025`. The previous checkout is preserved.
The development checkout has no Git remote. No publication is part of this work.

## Reproduced defects

The review follows an operation from its stop registration through native storage,
file preparation, delivery acknowledgement and disposal. Fault injection found:

* Storage could continue after an abort-listener adapter returned `false` or an
  asynchronous result. A registration finishing after refusal could retain a listener.
* Asynchronous results from IndexedDB adapter methods were not consistently
  rejected. In particular, a promise returned by `put` could be treated as a queued
  write even though the required synchronous request object was unavailable.
* Rejected clock, cleanup and malformed async-then callbacks could escape as
  unhandled rejections. Some checks read a changing `then` accessor more than once.
* Several export controllers ignored a download adapter's explicit `false`.
  They could show success, or mark the current data as exported, despite refusal.
* Reconciliation could publish success after its delivery callback cancelled or
  disposed the operation. There was no ownership check after that callback.
* The checkpoint controller ignored both export and restore-input handoff
  receipts. An unsuccessful handoff could be described as completed.
* Some dispose paths invoked abort listeners before setting the disposed flag,
  or retained a busy state while notifying them. A throwing close callback could
  interrupt disposal; a rejected asynchronous close was not always observed.

These are application and adapter-boundary defects reproduced with synthetic
records. The tests do not demonstrate a stolen key or a remote wallet exploit.

## Corrections

The existing shared callback observer captures `then` once. Promise rejection
is observed without making later settlement authoritative. Storage clock values,
native request objects and listener registration results must be synchronous.
Late listener completion performs only cleanup with the originally captured
listener. It cannot open a database, write data or restart an operation.

Native work whose completion is unknown retains its admission slot. A rejected
adapter result is not evidence that the underlying native work has finished.
Existing transaction abort, terminal-event and uncertain-result handling remain
in place; no timeout is treated as proof of rollback.

Export controllers refuse explicit `false` and asynchronous receipts. Their
existing synchronous `undefined` callbacks retain compatibility. Success means
the handoff was accepted, not that the operating system finished saving a file.
The checkpoint UI now explains refused downloads and refused restore staging.
It preserves the stored backup and allows a fresh explicit retry.

Disposal establishes a terminal, non-busy state before invoking abort listeners.
Generation checks prevent stale responses from adopting records or publishing
success. Close failures are contained; disposal remains idempotent.

No persistence format, migration, account permissions, contract or transaction
method changes are included. No original user data is loaded for fault injection.
Browser fixtures create uniquely owned test databases and clean up only those
databases. The new fixture routes are explicit allowlist entries under `--ui-test`;
normal mode continues returning 404 for them, local files and upload requests.

## Reproduction and verification

Evidence is in the sibling `wallet-storage-receipts-verification-20261025` folder.
Failed baseline logs are retained alongside successful corrected runs.

| Check | Original runtime | Corrected runtime |
| --- | --- | --- |
| Storage, export and disposal boundaries (147 cases) | 61 passed, 86 failed | 147 passed |
| Checkpoint handoff and disposal (35 cases) | 12 passed, 23 failed | 35 passed |
| Native storage and export UI (37 cases) | 2 passed, 35 failed | See final browser evidence |

Failure counts are test scenarios, not a count of independent vulnerabilities.
Multiple conditions exercise the same problem. Strict Node child processes
verify that rejected callbacks do not escape as unhandled rejections.

The browser cases cover five actual IndexedDB storage formats, native
AbortSignal registration, late completion, stored-record preservation, native
Blob content and checkpoint/reconciliation DOM status. The export matrix covers
all supported file formats of seven controllers. Checkpoint staging and export
are verified separately, with a fresh explicit retry after refusal.

An early browser fixture used a plain object instead of a native AbortSignal.
The existing type check correctly refused that object before registration.
The fixture was corrected to wrap a real AbortController signal and now asserts
that registration was reached exactly once. The baseline then reproduces all
20 targeted native-storage failures. Earlier fixture-only failures and route
allowlist expectation failures are preserved, not counted as product defects.

The full unit result is 11,243 passed. The HTTP server result is 395 passed.
Browser totals, any focused rerun provenance, physical line changes and backup
hashes are recorded in `verification-final.json`. Repeated runs are not added
to the distinct-case total. The separate token EVM suite was not rerun or counted;
it requires its token repository, not the wallet repository as working directory.

## Remaining acceptance

Distinct DAT, EMA and CAWELON real-wallet accounts are still awaiting preparation.
Their connection, balance read, save and reload acceptance remains open.
PC-side tests cannot substitute for that step. No new overall percentage is
assigned, and 90% completion is not claimed by this change.

The approximate 8,000-line target is reported separately from verified fixes.
The final measurements include actual additions, deletions and net lines,
including blank lines; test count and line count are not completion percentages.

Local test page: `http://127.0.0.1:4223/test/browser/`.
Focused checks: `http://127.0.0.1:4223/test/browser/?suite=storage-receipt`.
