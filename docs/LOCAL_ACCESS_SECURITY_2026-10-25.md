# Local access lifecycle hardening — 2026-10-25

This change was developed locally from `d9dae8ffc84a10118d8918c2a542c0b1e0b27e08`.
It has not been pushed to GitHub. The previous checkout is preserved separately.

## Reproduced before the change

The reproduction scripts in the adjacent verification directory import the
preserved baseline, not the changed implementation. They use synthetic data.

1. A cleanup callback could call `unlock()` while `lock()` was still stopping the
   page. The old gate returned to `canRead: true`.
2. A clock sample could move backwards between two checks while remaining later
   than the last activity. The old clock comparison accepted that sample.
3. A timer installation exception after activity left the old gate open with no
   active idle timer.
4. Cancelling from the connecting-state observer still constructed a session,
   retaining an unnecessary object after the displayed state became disconnected.
5. Clearing a pending portfolio view suppressed its final display but did not end
   local waiting or stop its subsequent reads. The baseline reproduction made five
   subreads after starting with one blocked subread; the fixed scope stops at one.

These findings describe local control-flow bugs. They do not establish that any
wallet funds were lost or that an attacker exploited a deployed service.

## Read-access gate

`src/security-lock.js` checks a monotonic sample against the previous sample,
including across a manual stop and explicit resume. It checks idle expiry at use,
even if browser suspension delayed the timer callback.

Timer installation handles thrown errors, invalid handles, synchronous callbacks,
and asynchronous installation results. Replaced timer callbacks carry an obsolete
generation and cannot change the current gate. Removal exceptions do not restore
their authority.

Clock and timer faults stay closed for the lifetime of this gate. Changing the
idle policy or retrying cleanup does not remove those faults. The panel explains
that the user must open a fresh page and explicitly reconnect.

Cleanup and view callbacks run inside a transition boundary. They can request a
stop or disposal, but cannot reenter activity, configuration, cleanup retry, or
resume during another transition. The disposed flag is set before cleanup starts.
A repeated stop received during resume invalidates that resume attempt.

Cleanup is synchronous by contract. `false`, an exception, or a Promise/thenable
does not confirm cleanup. Eventual rejections are consumed. An explicit cleanup
retry must succeed before ordinary manual-stop resume becomes available.

View notification is bounded. A stop or disposal triggered while publishing a
resume is also delivered as the final restricted state, keeping the controls in
step with the gate.

## One visible read operation

`src/wallet-read-scope.js` owns local waiting for the current card operation.
Its session view forwards only seven named read methods and the read-only state.
It does not forward `connect`, `disconnect`, arbitrary RPC requests, signing or
transaction methods.

The scope checks ownership before calling a method, after the reply, and around
session-state or method access. Its methods retain the original receiver and are
captured at binding. A new operation, clearing results, disconnecting, or disposing
the card closes the previous scope.

Cancellation promptly rejects local waiters and prevents the next subread across
balances, spender inspection, identity, portfolio, allowances, transfers and period
collection. Both promise handlers remain attached to consume a provider's late
success or rejection. At most 32 waits are admitted by one scope.

An already dispatched provider RPC cannot be recalled by this wrapper. The RPC
supervisor continues to account for the provider's pending operation until it
actually settles. Cancelling a view is not a capacity reset or permission revoke.

A late authorization-loss response may still invalidate the same session. The
card clears that session's view when the underlying read settles. It never clears
a newer replacement connection merely because an older connection failed.

## Card ownership and disposal

`src/wallet-card-controller.js` checks generation after cleanup, state publication,
session creation and listener setup. A cancelled constructor result is disconnected
before it can be retained. Old listeners and abort references are detached before
their cleanup callbacks run. Reentrant cleanup cannot construct another session.

Observer failures do not interrupt listener removal or session disconnection.
Disconnect reports an unsuccessful synchronous cleanup to the protection panel,
which keeps resume disabled until cleanup is confirmed. Repeated notifications are
bounded to prevent recursive disconnected-state observers.

## Panel and compatibility

The panel displays clock/timer recovery guidance in Japanese, keeps the resume
button disabled for a gate fault, and requires explicit cleanup retry if needed.
A newer stop during the resume eligibility check wins over that resume click.

The finite protection journal adds the `timer` event. It contains neither wallet
addresses nor balances, private keys or provider error text. Journal state remains
page-local and is not an independent security-audit report.

No IndexedDB database names, schemas, stored histories, token contracts, chain
selection, account permissions or wallet secrets are changed by this work. The
existing DAT/EMA/CAWELON read-only restrictions remain in force.

## Verification

New deterministic tests cover clock boundaries, scheduler faults, callback
reentrancy, cleanup retry, session construction/disposal, all seven composite read
families, and late RPC results across all three agents. Seeded state-machine traces
compare the implementation against an independent event model; each trace is
counted as one test, not as one test per generated event.

The native browser suite exercises real DOM controls with synthetic sessions.
The test-only preview is at `/test/browser/access-lifecycle-demo/` when the local
server is started with `--ui-test`. It uses no real wallet, fetch, or saved database.
Normal server mode does not expose these synthetic routes.

The adjacent verification directory contains exact final counts, logs, baseline
reproduction scripts, screenshots, line measurements, and verified local backups.
Line counts exclude unchanged line-ending conversions and distinguish additions,
deletions and net growth. The requested 7,000 lines is a guide, not a security metric.

This is internal regression and lifecycle verification. It is not an independent
audit, production penetration test, or real-money end-to-end wallet certification.
