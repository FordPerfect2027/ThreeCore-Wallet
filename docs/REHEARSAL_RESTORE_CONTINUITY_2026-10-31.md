# Rehearsal restore continuity and outcome focus

Continuation items 417–418. Source revision `47341e0`.

417. Confirmed single-record imports now focus the recomputed result heading. Confirmed combined recovery and comparison-case changes focus their completed outcome message, including an emptied case collection. Preview alone does not move focus to a completed outcome. Workspace recovery already focuses its stage and retains that behavior. Focus runs last so a new edit triggered by a focus listener retains its own message.

418. A completed combined restore no longer overwrites a newer preview, newer input or changed records entered during its view callback or commit notifications. Finalization is bound to the original user interaction and the exact restored contents. The session exposes a read-only identity check for its own current review, so a queued notification from an older cancellation cannot erase a newly created, still-valid preview. Forged, foreign, cancelled, committed or disposed reviews do not pass that check. Observer exceptions and thenable callbacks remain contained; successful data restoration with an ordinary view failure is still reported accurately.

## Validation

- Initial outcome-focus checks: **126 passed**, zero failed/skipped/cancelled; **5,004.9502 ms**.
- The existing stale-finalization bug was reproduced before repair: **15 passed / 5 failed**, **1,667.564 ms**. The first correction exposed one remaining queued-notification case: **111 passed / 1 failed**, **4,067.3805 ms**. Both failure logs are retained.
- Corrected restore/page/observer checks: **126 passed**, zero failed/skipped/cancelled; **4,338.5282 ms**.
- Final related rehearsal/server checks, including review identity and save-checkpoint compatibility: **1,176 passed**, zero failed/skipped/cancelled; **38,319.5365 ms**.
- Native Chrome at the same source: **851 passed**. The added case uses real browser focus, synthetic file selection, case confirmation, combined restore and single-record restore.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-restore-continuity/`.

The ledger is **418 / 600**. Tests, failure reproductions and reruns are not extra development items. The most recent full-wallet checkpoint remains 14,512 tests at `0cd49b6`; later changes have separate scoped validation. Local fictional data only. No real wallet signatures, transfers, approvals, private keys, external RPC, publication, deployment or restart of the existing servers.
