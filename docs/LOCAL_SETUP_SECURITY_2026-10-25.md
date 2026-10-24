# Wallet configuration restore boundaries — 2026-10-25

This PC-only change starts from `1a943ca0480faec92df3fc2f761603effcf5cc60`.
The preceding checkout is unchanged; the new checkout has no Git remotes.
No real wallet, public RPC, transaction, signature or GitHub publication is
needed for this iteration.

## Reproduced behavior

The settings-only restore used to interleave disconnection callbacks and form
writes for each card. A provider's listener cleanup can synchronously invoke
application code. Cancelling the review, editing a destination or disposing the
application during that cleanup did not stop subsequent form assignments. This
could overwrite configuration after a cancellation, or update only part of a
multi-card operation before a later interruption.

Three actual DOM cases reproduce the problem on the unchanged implementation:
cancel, edit and dispose from provider cleanup. The baseline browser run has
23 passing existing cases and 3 failing new cases, with no unexpected browser
errors. These are variants of a lifecycle boundary defect, not evidence of a
fund transfer or three separately exploitable vulnerabilities.

The initial unit regression run is also retained. Some of its failures concern
the newly introduced preparation adapter contract, so its 15 failures must not
be described as 15 pre-existing vulnerabilities.

## Implementation

- Serialize review operations. A callback cannot start another preview or apply
  while the current one is inspecting or applying settings.
- Capture the operation revision before reading the preview destination. Check
  that revision after callbacks and validation so a cancelled preview cannot
  become a new approval.
- Consume an approval before applying and recheck cancellation/disposal after
  every externally supplied preparation step.
- Run all disconnections and panel invalidations in `prepareApply`. Check for
  cancellation after each step and stop processing subsequent cards if it ends.
- Recapture the destination after preparation. Preserve edits made during
  cleanup instead of overwriting them with an earlier reviewed plan.
- Only after that final check, assign the native form fields synchronously in
  `applyPlan`. This writer has no provider calls, notifications or awaited work.
- Reject asynchronous adapters as an invalid synchronous contract and observe
  rejected promises. Do not report a completed restore after cancellation.
- Expire a retained preparation guard after the operation returns. A removed
  panel does not display a new error or success message after disposal.

Preparing a restore can disconnect a changed card even when the restore is
subsequently cancelled. That disconnection stays effective; it must not restore
permission automatically. Input settings and previously saved histories remain
intact in the tested cancellation/disposal paths. A destination edit is retained.

This API does not promise rollback for an arbitrary custom `applyPlan` that
performs callbacks, returns a promise, writes remotely or throws partway through
its own writes. Such an adapter violates the local synchronous writer contract.
The production example separates those callbacks into the guarded preparation
phase. Whole-workspace history restoration retains its separate transactional
rollback and emergency recovery mechanism.

## Verification and reproducibility

Focused unit tests cover preview cancellation/disposal, stale destination edits,
recursive callbacks, rejected adapters, one-use approval, and normal completion.
Browser cases exercise the real application with synthetic local providers,
including interruption during the second wallet's cleanup. They verify all
three cards, retained histories, disabled stale approval, and no new RPC calls.

Run the server with `THREECORE_DEMO_PORT=4211` and `--ui-test`; the focused route
is `/test/browser/?suite=setup`. It contains 27 tests. The complete application
suite is `/test/browser/`. The focused Node suite is:

```powershell
node --test test/wallet-setup*.test.js
```

Final, non-duplicated full-suite counts, backup hashes, commit and preservation
checks are in the adjacent `wallet-setup-guard-verification-20261025` directory:
`verification-final.json`, `report-ja.txt`, `unit-final.log`, `http-final.log`,
`browser-final.json`, `browser-baseline.json`, and `setup-checks-proof.png`.

## Acceptance status

The existing read-only testnet acceptance scope still applies: connect, inspect
balances, save/restore observations and stop safely. The settings restore
cancellation gate now has direct regression evidence in the complete UI.
No line-count target or test-count ratio is used as a completion percentage.

Three separate real-wallet accounts are still unavailable, as the user reported.
Their permission dialogs, public-testnet balances, saved histories after reload,
explicit reconnect and interrupted reads remain a pending acceptance gate.
This iteration does not mark that gate complete or claim 90% overall readiness.
The earlier token-contract EVM checks are retained as historical evidence;
unchanged contract/session code does not require them to be counted again here.
