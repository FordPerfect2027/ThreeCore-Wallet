# Local Wallet response protection — 2026-10-24

This change protects the PC-local ThreeCore Wallet reader against unresolved
provider requests, delayed responses and malformed or excessive provider events.
It has not been pushed to GitHub or deployed to a production website.

## User-visible behavior

The protection area now contains **Walletの応答保護**.
It shows how many operations this page is waiting for and how many remain
unresolved after the page stopped waiting. No wallet address, balance, provider
name, request parameters, passphrase or raw error is included in these counters.

Stopping a card or the whole page ends local waiting immediately. An already
issued extension request can still be running. The counter remains until that
request settles, and its late result is discarded. Resuming permits another
explicit connection action; it does not reconnect, retry or restore a balance.

If the outstanding request limit is reached, another attempt is refused before
calling the extension. Replacing a controller or session does not reset the
shared page budget. A normal settlement frees its slot. There is no UI control
to clear the outstanding count while the extension is still working.

The status panel itself cannot request accounts or perform RPC operations.
It does not provide signing, transfer, approval, network switching or retry
controls. It only reads aggregate snapshots from the supervisor.

## Scope

The default supervisor is a module singleton shared by the sessions loaded in
one page. DAT, EMA and CAWELON using the same provider object share that provider's
limit. Distinct provider objects also share a page-wide limit.

This is not a cross-tab quota. Another tab, browser profile or page reload has
its own JavaScript execution context. The previous stop-notification feature
still has its separate documented scope and limitations.

The budget protects this application from issuing more work through its own
adapter. It cannot prevent an extension, a compromised same-origin script or
another application from issuing requests directly. A provider that blocks the
JavaScript event loop synchronously cannot be interrupted by a JavaScript timer.

## Fixed production boundaries

| Boundary | Default / maximum |
| --- | --- |
| Outstanding requests per provider object | 32 |
| Outstanding requests across this page | 96 |
| Local session waits | Existing maximum of 32 retained |
| Normal read deadline | Existing default of 30 seconds retained |
| Connection identity check deadline | Existing default of 30 seconds retained |
| Permission request deadline | Existing default of 120 seconds retained |
| Supervisor status subscribers | 16 |
| Diagnostic cumulative counter | Saturates at 1,000,000,000 |
| Provider event payload inspections | 256 per observer per 1,000 ms |
| Accounts in one event | 128 |

Test fixtures can use smaller capacities and shorter deadlines. The main demo
uses the production defaults. Limits are not stored in localStorage or accepted
from imported workspace files or provider metadata.

## Two lifetimes for one request

A request has a local consumer lifetime and a provider execution lifetime.

1. A slot is reserved before the dispatch microtask. Same-turn bursts cannot
   reserve an unbounded number of requests while waiting to dispatch.
2. The caller receives a cancellation handle before any extension code runs.
3. Cancelling before dispatch releases the unused slot and calls no provider.
4. After dispatch, local cancellation closes the local promise and marks its
   slot abandoned. The native request remains charged.
5. Native fulfillment or rejection releases that slot exactly once.
6. If its local consumer already ended, the result is consumed and discarded.

Releasing an old lease twice cannot release a newer lease. Provider identity is
tracked in a WeakMap without inspecting or modifying provider properties.
Aggregate snapshots cannot enumerate provider identities.

There is no waiting queue, automatic retry, timed eviction or manual reset that
would allow reconnecting to bypass a still-unresolved request. A request that
never settles retains its slot for the lifetime of the loaded page context.

## Deadline decisions

The supervisor uses monotonic elapsed time, not wall-clock dates. The deadline
is checked before dispatch, when the timer runs and when a result arrives.
A result at or after the deadline is rejected even if the browser delayed the
timer callback. An early timer re-arms only the remaining interval.

Old timer callbacks carry a generation token and cannot terminate a replacement
wait. Timer setup failure refuses dispatch. Timer cleanup failure does not
reopen a completed wait. An unusable or backward clock closes current local
waits and refuses new requests through that supervisor.

In the integrated page a validated clock fault also closes all three cards,
including idle cards that were not making the failing request. Existing protection
cleanup clears backup passphrases and restoration candidates. The resume control
checks the supervisor again on click and remains disabled for a terminal fault.
A raw provider error or malformed diagnostic snapshot cannot forge this signal.

Provider rejection messages are replaced with fixed application text. Inspecting
a provider error can itself reenter application code, so the deadline and local
completion state are checked again after error classification.

Timeout codes from the supervisor are converted into the existing
WalletConnectionError interface. A provider cannot forge a trusted local timeout
by returning an error with the same string code. Existing authorization-loss and
account/chain checks continue to disconnect the session where appropriate.

## Provider event boundary

The session and card controller now share the same event observer implementation.
Each observer captures the provider's registration and removal functions once.
Later replacement of those properties cannot redirect its cleanup.

The observer registers only accountsChanged, chainChanged and disconnect.
It remembers every attempted listener before registration, so a function that
installs a listener and then throws can still be cleaned up. Removal is attempted
for all listeners even when one removal throws. The local disposed flag and
owner generation make retained extension callbacks inert.

Asynchronous listener registration is not treated as completed registration.
It fails closed and cleans attempted listeners; rejected registration and removal
promises are consumed. A throwing or absent removeListener remains compatible
with the prior adapter policy because retained callbacks have local disposal
and generation guards. This does not promise removal inside the extension.

Account events must be bounded arrays of own data properties containing complete
20-byte hexadecimal addresses. Sparse arrays, accessors, extra keys, symbols and
invalid addresses are rejected. Account accessors are not executed to obtain an
address. Accepted values are copied, normalized and frozen.

Chain events must be bounded hexadecimal strings within the safe integer range.
Objects are not coerced into strings. Disconnect event payloads are not inspected
or forwarded because they are not needed to revoke local access.

The owner generation is checked before and after payload validation. Proxy traps
can execute code during reflective inspection, so this is not a JavaScript object
sandbox. A generation change during inspection prevents delivery to the owner.

Before payload inspection, a small ingress gate checks the event count and clock.
The 257th notification within a default window closes that observer and signals
disconnect once. Retained callbacks cannot repeat this signal. A blocked gate
does not automatically reopen when time passes. An explicit new connection makes
new observers. Normal lower-frequency notifications continue to work.

The eventless adapter compatibility path remains available. Such adapters still
depend on the existing identity checks before and after reads. This change does
not certify a nonconforming provider as EIP-1193 compliant.

## Aggregate diagnostics

The status snapshot has a fixed schema and contains only numbers, booleans and
fixed codes. Its presentation boundary rejects unknown keys, accessor fields,
invalid capacities, inconsistent counts and unsupported fault values.

An invalid snapshot replaces old values with an unavailable message. It is never
rendered as trusted status, interpolated into HTML or persisted. The panel uses
textContent for every variable field. Its headline has a polite live region;
rapidly changing numeric details are not individually announced.

Observer exceptions cannot change the request outcome. Asynchronously rejected
observer promises are consumed. Unsubscription and disposal are idempotent.

The numbers describe this application's request handling. A zero pending count
does not prove that an extension is trustworthy, a chain is secure, a balance is
correct or a security audit has been completed.

## Files

| File | Responsibility |
| --- | --- |
| src/rpc-capacity.js | Actual outstanding-work leases |
| src/rpc-supervisor.js | Local deadlines, cancellation and aggregate counters |
| src/rpc-status.js | Strict status snapshot validation and Japanese wording |
| src/provider-events.js | Captured listeners and bounded event snapshots |
| src/provider-event-gate.js | Event ingress count and monotonic time boundary |
| examples/rpc-status-panel.js | Read-only diagnostic UI |
| src/wallet-session.js | Supervised requests and event invalidation |
| src/wallet-card-controller.js | Same event boundary for card state |

No dependency was added. The development server explicitly serves the new runtime
modules. Test harness modules and the manual fixture remain unavailable unless
the server was started with --ui-test. No RPC proxy or reset endpoint was added.

## Verification

The automated checks cover:

- default and reduced capacity boundaries;
- identity isolation and the aggregate limit;
- all permutations of three lease abandon/release pairs;
- seeded independent-model traces of acquire, abandon and release;
- independent whole-request traces interleaving deadlines, early timers,
  native results, queued cancellation, capacity denial, clock faults and disposal;
- queue cancellation before extension dispatch;
- cancellation and timeout at all five phases of verified reads;
- all four metadata calls for DAT, EMA and CAWELON;
- delayed and early timers, stale callbacks and clock faults;
- synchronous exceptions, hostile thenables and reentrant error classification;
- cross-session and cross-controller budget retention;
- permission-prompt exclusion remaining in force after local timeout;
- partial listener registration, captured removal and stale callbacks;
- asynchronously rejected event methods without unhandled promise errors;
- account/chain event validation and event storms;
- native browser status updates and no automatic reconnection;
- a clock fault clearing all three cards and preventing premature resume;
- local HTTP headers, explicit route exposure and cross-origin refusal.

These use synthetic providers. They do not involve a real wallet password,
private key, transaction, token approval or fee. Results from a previous real
wallet check do not count as new real-wallet validation of this change.

Run the final unit and server checks from this repository:

```text
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
```

For browser checks, start examples/dev-server.js with --ui-test and open
/test/browser/. The focused suite is /test/browser/?suite=rpc-supervisor.
The manual fixture is /test/browser/rpc-protection-demo/.

Final counts, screenshots, logs, source archive and Git bundle are recorded in
the sibling wallet-rpc-supervisor-verification-20261024 folder. Only final runs
are counted; a focused rerun is not added again to the all-suite result.

## Reference and remaining limitations

The provider API and event payload contract were checked against the primary
[EIP-1193 specification](https://eips.ethereum.org/EIPS/eip-1193).
The application-side cancellation distinction follows that API's request shape;
it does not claim to cancel an extension's internal transport or permission UI.

An attacker controlling this origin can replace application code. An extension
can lie about chain results or refuse to settle requests. The application cannot
undo a permission already granted or an on-chain transaction initiated elsewhere.
This update is a defensive implementation with regression checks, not an
independent audit or a guarantee against asset loss.
