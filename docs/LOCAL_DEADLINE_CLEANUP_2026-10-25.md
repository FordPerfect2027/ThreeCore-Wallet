# Backup cleanup and deadline interruption — 2026-10-25

This local checkpoint closes reentrant cleanup boundaries in the read-only
ThreeCore Wallet prototype. The starting commit is
`f338fdb89899bba97293464bbea619b459c46964`. No remote publication or dependency
installation is part of this change.

## Reproduction

Thirteen targeted cases failed against the previous runtime:

- Four deadline cases showed that clearing or disposing during timer removal
  could be overwritten by an outer rearm, or that timer cleanup could itself
  rearm a deadline being cleared or expired.
- Nine controller cases exercised cancel, invalidation and disposal during
  staging, candidate replacement and failure cleanup. Old operations could
  overwrite the newer stopped phase. Staging could invoke its plaintext handoff
  callback even though a stop had changed the operation generation.

Three browser cases used the actual workspace and encrypted-backup panels,
native File inputs and native WebCrypto with synthetic accounts and data.
Before the fix, protection and invalidation during timer removal left decrypted
text in the workspace input. The disposal case already passed because the
workspace panel separately rejected handoff after disposal. All three cases pass
after the fix. No wallet extension, external RPC or user backup was used.

These timing cases identify shared lifecycle bugs. They are not a count of
independent vulnerabilities, and do not demonstrate an external attacker or a
change to stored wallet data.

## Changes

The deadline now blocks nested arming while removing a timer or performing
another arm operation. Timer removal returns the generation it invalidated.
The outer arm checks that generation and the disposed/fault state after the
adapter returns, before assigning new authority. Thus a newer clear or dispose
wins even when the adapter subsequently throws. Returned timer handles that
must be removed use the same cleanup guard.

The backup controller clears candidate references before calling timer cleanup.
It sets transition/error state before callbacks can reenter, and an older
failure emits no replacement state after its generation is superseded. Staging
closes its recursive entry point, removes the old lifetime, then checks the
operation generation again immediately before invoking the plaintext handoff.

Normal later actions remain available: a new explicit selection/decryption can
stage once after cancellation or invalidation. Disposal stays terminal. Old
timer callbacks cannot affect the new lifetime. Existing elapsed-time checks,
clock-fault handling, crypto algorithms, resource reservations and confirmation
requirements remain in place.

## Verification

The new unit tests cover the thirteen reproductions plus cleanup exceptions,
stale timers, returned-handle cleanup, later explicit recovery, recursive
staging and candidate access during cleanup. Assertions observe results outside
callbacks whose exceptions the production cleanup intentionally consumes.

The full unit, HTTP isolation and browser suites are run against the final
runtime. Focused runs and deliberate baseline failures are not counted twice.
Logs, exact line measurements and verified recovery archives are stored in the
sibling `wallet-deadline-cleanup-verification-20261025` directory.

Acceptance using three distinct real-wallet accounts is still deferred until
the user has them ready. This checkpoint does not assign a new overall
completion percentage or represent an independent security audit.
