# Local restore cancellation and commit checks — 2026-10-25

This work starts from `0e8a6cae600dcf476018b0451a4a5e4d63597233` and remains
PC-only. The previous checkout is preserved. Three distinct real-wallet accounts
are not yet available; the user explicitly deferred that acceptance step and
asked for continued local validation. No GitHub push or wallet access is part of
this iteration.

## Reproduced issue

The workspace controller checked its review and authorization before calling the
synchronous form/history writer. It checked the resulting data afterward, but
did not check whether the operation had been cancelled during the write. A
provider cleanup callback can invoke application code while a configuration
restore disconnects an existing session. A cancellation from that callback could
be followed by a successful restore message and a newly accepted undo point.

Related tests showed that an authorization callback could change the current
draft before the first write, or lose authorization during a write, without
invalidating the proposed result. Restore and undo share this boundary.

The new regression suite has 14 cases. When imported against the untouched
baseline, 13 fail and the ordinary successful restore/undo case passes. These
are several reproductions of the same transaction-boundary problem, not 13
independent claims of exploitable vulnerabilities.

## Corrected behavior

- Check the operation revision before invoking authorization and again after it.
  A cancelled writer cannot trigger another authorization callback.
- Capture the live draft again after authorization and before writing. If it was
  edited during that callback, reject the stale proposal without writing or
  undoing the new edit.
- After the synchronous writer returns, check authorization and revision again.
  Verify the written data with the same operation revision, so cancellation in
  the verification reader also invalidates the write.
- If cancellation, expiry or verification fails after writing starts, use the
  existing rollback path to restore the exact pre-operation data. Rollback
  remains allowed even when authorization has ended.
- A failed second restore does not replace the prior successful undo point.
  If rollback itself fails, preserve the detached emergency draft and block
  further restore/undo actions until the user saves and inspects that recovery
  material. The recovery draft is page-local until explicitly downloaded.
- Even a no-change application checks the current revision before returning.

This preserves the synchronous adapter contract. It cannot recall an already
executed arbitrary callback or guarantee storage recovery if the writer is
broken. It does not restore wallet connection permission; the full application
requires a fresh explicit connection after a changed configuration is rolled back.

## Tests and evidence

`test/workspace-write-boundaries.test.js` checks both restore and undo, edits at
authorization, cancellation inside the writer and verification reader, expiry,
failed rollback recovery, preservation of an earlier undo point and asynchronous
authorization rejection. The existing security test now checks reentrancy at
both authorization boundaries.

Three new browser cases use actual DOM controls. Two attach a cancellation to
the selected synthetic provider's listener cleanup while the full application
restores or undoes all three cards. They check that all form/history data matches
the preceding state, the final message reports rollback, the old confirmation
cannot be reused, and no new wallet requests occur. A third case simulates failed
rollback and verifies the original recovery export and disabled retry controls.

The focused workspace browser suite is available at
`/test/browser/?suite=workspace` when the local server is started with `--ui-test`.
It contains 25 cases. The full browser suite remains `/test/browser/`.

Reproduction and final logs are in the adjacent
`wallet-restore-boundaries-verification-20261025` directory:

- `baseline-reproduction.test.mjs`, `reproduction-baseline-final.log`
- `restore-focused.log`, `unit-final.log`, `http-final.log`
- `browser-focused.json`, `browser-final.json`, `restore-checks-proof.png`
- `verification-final.json`, verified Git bundle and ZIP backup

Current test counts and backup verification are recorded in the final JSON and
Japanese report, rather than treating a test count as a completion percentage.
The token contracts and wallet RPC/session code were unchanged in this iteration;
the prior 150-case local EVM result is retained as historical evidence and is not
counted as a fresh execution here. Real-wallet public-testnet acceptance remains
explicitly deferred, not marked complete by the synthetic tests.
