# Read observers and operation option ownership

Continuation items **214–216**:

214. Contain rejected asynchronous then methods returned by token identity, transfer, allowance and period progress callbacks, including period checkpoint callbacks. All 5 new process-level regressions failed before source `55166da`; 356 related tests pass afterward. Synchronous cancellation still reaches the existing guards.
215. Capture each reader's known optional settings as own data before starting. Reject option accessors without calling them, and avoid live property reads through proxies. Unrelated options remain ignored. Source `f239e04`.
216. Retain the accepted transfer/period progress callbacks, period checkpoint callback and original abort signal through completion. Mid-read mutation of the caller's option object cannot replace observers, leave the original abort listener registered, or turn cleanup into an unrelated error. Source `f239e04`.

The 25 option regressions exposed 21 failures before the fix. All **347 related reader/lifecycle/capture tests pass**, with zero failures, skips or cancellations. The full wallet command `npm run test:wallet` passed **13,073 tests** with zero failures, skips or cancellations in 530,732 ms at fixed source `f239e04`. Source and tests were unchanged during the run; only documentation and a read-only browser preservation check were updated. This suite does not replace separate compiled-token-contract acceptance or a real-wallet acceptance session.

Evidence: [observer regressions](evidence/2026-10-30-read-observers/before.log), [observer targets](evidence/2026-10-30-read-observers/related.log), [option regressions](evidence/2026-10-30-read-observers/options-before.log), [option targets](evidence/2026-10-30-read-observers/options-related.log). [Full wallet log](evidence/2026-10-30-read-observers/full-wallet.log), [checksums](evidence/2026-10-30-read-observers/SHA256SUMS.txt).

These are synthetic adapter checks. They do not add real-chain scan coverage or establish mainnet readiness. No real signature, transaction, approval or private-key operation occurred.

## Existing Edge rehearsal session

A read-only check of the existing Microsoft Edge tab confirmed the session save status still shows 6 committed fictional records and 3 comparison cases, matching the last download-start snapshot. [The visible page](evidence/2026-10-30-read-observers/rehearsal-connected.png) was captured without reloading or changing those records. This is a connection/preservation check, not an additional counted item or a browser execution of the modified wallet readers.

The existing 17,387-byte downloaded session file was also present and retained SHA-256 `22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c`, matching the previous save-checkpoint evidence.
