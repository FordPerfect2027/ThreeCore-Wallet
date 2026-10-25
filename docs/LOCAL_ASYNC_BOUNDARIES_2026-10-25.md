# Local security callback and cancellation review — 2026-10-25

This change is kept in the PC-only `local/async-boundaries-20261025` branch.
Its starting point is `faf0c2c1a30f1a95b5c83788c0ea0374b718fdf3`.
The previous development checkout and published snapshot remain preserved.
No remote is configured in this checkout.

## Reproduced behavior

The prior deadline fix protected the encrypted backup lifetime, but the related
RPC, file, export, tab-coordination and access-lock services used different
rules for callback results. Fault injection identified the following cases:

* A missing or asynchronous timer handle could be treated as a completed
  registration. RPC or file work could start before a usable handle existed.
* Export and lock paths could reject a promise but release the promise object
  instead of the timer handle it eventually returned.
* A rejected clock or cleanup promise could become an unhandled rejection.
* Several synchronous callback checks read a mutable `then` getter twice.
* File reads relied on abort notification, without checking the state again at
  each work boundary. A missed notification could allow returned bytes through.
* Native abort state could be hidden by a shadowing instance property.
* Asynchronous listener registration could occur after local refusal and leave
  an unnecessary listener attached. Crypto listener cleanup rejections also
  needed explicit observation.

These are adapter and lifecycle boundary defects under controlled fault
injection. The evidence does not demonstrate compromise of a real wallet,
private-key access, theft, or a remote network exploit.

## Implementation

`security-callback.js` captures a result's `then` method once and classifies the
result synchronously. Async settlement is used only to observe failure or to
release a resource; it never authorizes a save, dispatch, resume, or retry.
An invalid timer is refused before protected work is dispatched. A late timer
handle is released through the captured cleanup path. Valid numeric zero and
opaque synchronous handles retain compatibility.

Clock callbacks must return numbers synchronously. Numeric range, rollback,
deadline and permanent-fault policies remain with each service. A promise is
not coerced into a time value and its rejection is observed.

Timer and pending-operation references are detached before invoking cleanup,
so a callback cannot overwrite a newer reference when the old cleanup returns.
Existing generation and stop guards still prevent stale timers from reviving
an operation. RPC and crypto native work continue to retain capacity until the
actual work settles, even when local waiting has already stopped.

`security-abort.js` reads the native AbortSignal state using its native getter
where available. Host adapters remain supported with a synchronous boolean.
The file reader checks cancellation before opening a source, around each read,
and before accepting data. Crypto checks before dispatch and result acceptance.
Listener registration must be synchronous; delayed registration is refused and
its late completion triggers another removal attempt with the original listener.

No persistence schema, contract, transaction method, signing method, or public
network permission was added. Browser test fixtures are available only with
the existing `--ui-test` mode. The two runtime modules are explicit static
allowlist entries protected by the existing response headers and request policy.

## Verification and evidence

Evidence is in the sibling `wallet-async-boundaries-verification-20261025` folder.
The logs retain failed pre-fix cases; they are not replaced by passing results.

| Check | Reproduction | After correction |
| --- | --- | --- |
| Seven-service timer/clock matrix | 39 passed, 45 failed | 84 passed |
| Abort and listener boundaries | 5 passed, 23 failed | 28 passed |
| Callback handling review | 35 passed, 6 failed | 41 passed |
| Native-browser focused cases on original runtime | 1 passed, 9 failed | 10 passed |

The callback review includes tests of the new shared helper during development;
it is not wholly a baseline-only test suite. A failed test count is not a count
of independent vulnerabilities. Multiple cases exercise the same defect under
different return values, services and interruption timings.

The browser cases use actual File, ReadableStream, AbortController and DOM APIs
with synthetic wallet providers and synthetic content. They cover all three
token cards, the file stop button, delayed cleanup, export refusal and the
cross-tab stop status. They do not request a real wallet signature or send funds.

Full results and physical line measurements are recorded in
`verification-final.json`, `measurements.json`, `unit-final.log`, `http-final.log`
and `browser-final.json`. Repeated focused runs are not added to full-suite totals.

One intermediate HTTP run identified static test manifests and dependency-count
expectations that omitted the two new modules. Those expectations were updated
to include the exact new dependencies, and the complete HTTP suite was rerun.
An intermediate browser fixture duplicated DAT's account on another card;
the existing account-uniqueness guard correctly stopped it before the intended
timer test. The fixture now uses distinct synthetic card inputs.

## Remaining acceptance

Three separate real-wallet addresses are still awaiting user preparation.
The three-wallet connection, balance, save and reload acceptance step therefore
remains open. This review does not assign an overall completion percentage.
It does not replace the independent security audit already under discussion.

The server is loopback-only and can be opened at
`http://127.0.0.1:4221/test/browser/` while the local verification process runs.
The original saved files and earlier checkout backups remain available.
