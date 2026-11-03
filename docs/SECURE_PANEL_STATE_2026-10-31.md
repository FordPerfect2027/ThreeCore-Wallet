# Crypto status and encrypted-library handoff ownership

Continuation items 351–352. Source revision `afe5437`.

351. Crypto operation labels and counts use one captured status. A newer notification or disposal during capture retires the old render. Asynchronous state and subscription failures are consumed, invalid subscriptions stop delivering notifications, and late unsubscribe callbacks are released.

352. Encrypted-library save preparation captures and checks the current source handoff before beginning a review. Protection, cancellation, readiness changes and disposal during the source callback cannot start another storage review or revive its status. Asynchronous sources are consumed without authorizing storage. A new file selection is no longer cleared after a reentrant import callback. Ordinary accepted ciphertext still reaches a review and never writes before confirmation.

## Validation

- Original regression set: 14 cases, 12 failed and 2 passing controls.
- Focused crypto/library panel and status set: 130 passed.
- Secure backup, encrypted library/archive, workspace and shared callback integration: **1,355 passed**, zero failed/skipped/cancelled; 47,530.5753 ms.
- The source tree was fixed during integration. Evidence and checksums are in `evidence/2026-10-31-secure-panel-state/`.

The latest full-suite checkpoint remains 13,948 tests at `5aa4a25`. The latest native Chrome checkpoint remains 836 cases at `cc1e1c3` through item 350; this batch does not claim a new native-browser run. Synthetic encrypted fixtures and in-memory storage were used. No real wallet signatures, transfers, approvals, secrets, publication, deployment or restart of the existing demo server.
