# Checkpoint lifecycle and callback ownership

Continuation items **283–285**, source `122e84d`.

283. Capture refreshed or saved documents before admitting them into live state, and recheck operation ownership after external callbacks. Disposal during document validation, ID/clock generation, commit checks or the post-save draft read cannot revive status or begin another write.
284. Read diagnostic codes from own data properties without executing getters. Recheck ownership after diagnostic capture so a reflective adapter cannot rewrite disposed status.
285. Bound recursive change notifications with the shared notifier. A terminal callback that disposes or supersedes an operation revokes its successful return; disposal removes its observer.

The original seven tests reproduced six failures and one existing control. A further post-save callback test reproduced one additional failure after the initial patch. The final checkpoint integration run passed **343 tests**, zero failures, skips or cancellations (7177.3904 ms). This is local synthetic adapter and fixture validation, not a live browser session or a new full-wallet result.

Evidence: [initial reproduction](evidence/2026-10-31-checkpoint-lifecycle/before.log), [additional reproduction](evidence/2026-10-31-checkpoint-lifecycle/expanded-before.log), [final integration](evidence/2026-10-31-checkpoint-lifecycle/final-integration.log), [SHA-256](evidence/2026-10-31-checkpoint-lifecycle/SHA256SUMS.txt).

Own string diagnostic codes remain supported; this change does not establish an allowlist for arbitrary storage adapters. Cancellation cannot undo a committed storage transaction. No real signatures, transfers, approvals, private-key access, publication or deployment occurred.
