# Allowance bundle panel lifecycle

Continuation items **286–288**, source `7fa4dca`.

286. Retire the active byte-reading or checksum wait on cancel, clear, replacement review or disposal. Each operation owns its signal, and an old completion cannot clear the next operation's handle.
287. Recheck panel ownership after record capture and diagnostic reflection. Capture own diagnostic data without invoking accessors; disposed panels cannot receive late previews, status messages or downloads.
288. Require a synchronous accepted download handoff. False receipts and promises cannot claim a prepared download; asynchronous failures are observed and consumed. A successful handoff still asks the user to check browser completion.

The original 17 regressions produced **16 failures** and one passing refusal control. The initial focused run passed 29 tests. An additional replacement-operation ownership case was included in the final integration run: **1,339 tests passed**, zero failures, cancellations or skips (14261.3732 ms).

Evidence: [before](evidence/2026-10-31-allowance-bundle-lifecycle/before.log), [focused](evidence/2026-10-31-allowance-bundle-lifecycle/fixed.log), [integration](evidence/2026-10-31-allowance-bundle-lifecycle/integration.log), [SHA-256](evidence/2026-10-31-allowance-bundle-lifecycle/SHA256SUMS.txt).

The new UI tests invoke mounted event handlers through a synthetic DOM; they are not screenshots or live-browser validation. Native hashing can continue draining after the local task is cancelled. Import remains a historical display and does not change wallet cards. All records are fictional. No signing, transfers, approvals, private-key access, deployment or publication occurred.
