# Transfer panel callbacks and evidence ownership

Continuation items **311–314**, source `9855659`.

311. Consume synchronous and asynchronous notification failures from transfer-state and cancellation callbacks. Retained event handlers become inert after disposal.
312. Recheck panel generation after a period-window cancellation callback and diagnostic capture. A callback that invalidates or closes the panel cannot be followed by an old period status message.
313. Bind JSON, CSV and text download preparation to the current UI operation. A queued cancellation between preparation and delivery suppresses the old file. Require synchronous accepted download receipts; false, rejected or pending asynchronous receipts cannot silently pass or keep the handler waiting.
314. Check ownership around archive capture and caller-supplied staging permission. Reentrant invalidation cannot return stale evidence or open a disposed archive; asynchronous permission failures are consumed and not accepted as permission.

The 21 new cases reproduced **17 failures** and four existing controls. All **39 focused tests** passed after correction. Transfer and related panel/adapter integration passed **830 tests**, zero failures, cancellations or skips (11869.9515 ms).

Evidence: [before](evidence/2026-10-31-transfer-panel-lifecycle/before.log), [focused](evidence/2026-10-31-transfer-panel-lifecycle/fixed.log), [integration](evidence/2026-10-31-transfer-panel-lifecycle/integration.log), [SHA-256](evidence/2026-10-31-transfer-panel-lifecycle/SHA256SUMS.txt).

Archive selection remains an asynchronous preparation flow and is distinct from a download handoff. These tests use synthetic DOM elements and fictional Transfer records. The latest full-wallet checkpoint remains 13,597 passing tests through item 300. No real signing, transfer, approval, private-key retrieval, publication or deployment occurred.
