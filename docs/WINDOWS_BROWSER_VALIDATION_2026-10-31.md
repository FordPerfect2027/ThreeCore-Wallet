# Windows native browser validation

Continuation item 335. Final runner revision `a49a6b9`; application and full-wallet checkpoint `5aa4a25`.

335. The existing real-DOM regression command now runs on this Windows host using an installed Chrome or Microsoft Edge executable. It creates an isolated temporary profile with extensions disabled and an ephemeral loopback server. It does not attach to an existing user profile or stop an existing demo server. Cleanup targets the child PID created by the runner, verifies canonical temporary-directory containment, and preserves the profile if process shutdown cannot be confirmed. Completion has a finite five-minute deadline. Failure output includes the browser summary and actual failed case names.

## Integration corrections

The first completed native run had 836 cases, 833 passing and 3 failing, with no unexpected browser errors. The failing cases showed that the earlier workspace generation guard suppressed necessary final guidance after a synchronous restore was cancelled. The final restore result now reports a fresh-review instruction or completed rollback, and a failed rollback exposes the original recovery copy while blocking unsafe retry. Cancellation does not overwrite newer input, and disposed panels are not revived. These corrections do not add development items.

Eight targeted mutation cases reproduced 5 failures and 3 passing controls before the correction. The combined focused set then passed 143 cases; the broader workspace, secure-backup and browser-support set passed 1,056 cases (92,213.4107 ms).

## Fixed-source validation

- Full wallet suite at `5aa4a25`: **13,948 passed**, zero failed/skipped/cancelled; 658,813.146 ms. This also independently verifies the earlier export dependency-inventory correction.
- Normal native Chrome run at `5aa4a25`: **836 passed**, with a synthetic provider and no external RPC.
- Final error-detection controls at `a49a6b9`: both deliberate browser-error and unhandled-rejection controls were correctly rejected despite **836 otherwise passing UI cases per run**.
- The final runner-only change preserves nested cleanup diagnostics and the isolated profile path instead of flattening the failure to one sentence.

An earlier error-detection attempt, run alongside the full suite, did not finish one browser cleanup cleanly and is retained as a failed attempt. Its exact nested cause was lost by the old error formatting; it is not attributed to a specific cause. The retained profile was removed only after confirming that no matching test-browser process remained and verifying its canonical temporary path. Both controls were then rerun successfully without the concurrent full suite. The initial Linux-only rejection and the earlier 90-second timeout are also retained as unsuccessful attempts.

Evidence, environment metadata, unsuccessful attempts, successful logs and SHA-256 checksums are in `evidence/2026-10-31-windows-browser-validation/`.

All browser data and providers were synthetic. This validates local UI behavior; it is not real-wallet compatibility or mainnet readiness. No signatures, transfers, approvals, secrets, publication, deployment or restart of the existing 4231 server occurred.
