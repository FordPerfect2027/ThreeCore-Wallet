# Current operation ownership across wallet and protection panels

Continuation items 336–350. Fixed source `cc1e1c3`.

336. Portfolio progress captures bounded own event fields and the original token list once. Direct Proxy reads cannot replace checked values, and reentrant event capture cannot advance an obsolete outer event.
337. Portfolio results, progress and diagnostic text recheck their operation after source capture. A clear, invalidation or disposal during validation cannot restore stale balances, progress or a failure message.
338. Portfolio cancellation detaches the old request before aborting it. An abort callback cannot erase a newer request or release its busy controls; a retained duplicate read handler cannot start overlapping reads.
339. Portfolio owner-cancellation notifications consume synchronous and asynchronous failures. Removed controls and public invalidation cannot update a disposed panel. Token-plan application preserves its own ordinary receipt while a subsequent independent cancellation still retires it.
340. Token-plan export rechecks context after reading the source list. Preview and apply bind to the exact reviewed JSON, including input changes made during context capture.
341. Token-plan application reports confirmation only for an accepted synchronous receipt. Refusal, a promise or a throwing callback consumes the review and asks the user to inspect the current input rather than claiming successful application.
342. Token-plan source reads, error capture and retained handlers respect action retirement and disposal. Asynchronous source failures are consumed; diagnostic accessors are not executed.
343. File-read status notifications retain only the newest captured observation. Invalid/asynchronous subscriptions are retired and their late cleanup is released. Unavailable source state is shown as unconfirmed.
344. Export-guard labels and button availability use one captured aggregate. Retired notifications cannot revive a removed panel, and a missing initial observation leaves actions disabled with an unavailable explanation.
345. File-read and export cleanup actions require synchronous confirmed results. Reentrant actions own their final messages, disposed panels receive no late result, and asynchronous cleanup failures are consumed.
346. Protection journals capture their bounded event array before validation, without repeated length or direct source-value reads.
347. Journal summaries and visible export text come from validated, detached snapshots. Changed contents retire an open copy even when the total event count is unchanged.
348. Journal source failure clears the previously displayed copy. Source reentry is bounded, and close/dispose during capture cannot refill the cleared display.
349. Storage-guard status and stop actions respect notification/action ownership. They consume asynchronous sources and cleanup receipts, preserve newer stop results, and do not read or update a removed panel.
350. RPC labels and the one-shot clock-fault notification use the same captured state. Retired snapshots cannot notify a disposed owner; subscription and observer failures are consumed without reviving the display.

## Validation

The original reproduction batches contained 94 cases: 86 failed and 8 passed as controls. The final new regression coverage contains 96 cases, including the ordinary token-plan application path and its subsequent-cancellation control.

- Portfolio, token-plan, journal and file/export panel focused tests: **341 passed**.
- Storage/RPC focused tests: **219 passed**.
- Intermediate integration before the storage/RPC additions: **3,933 passed** (144,231.5023 ms).
- Final integration at `cc1e1c3`, including protected HTTP routes: **5,272 passed**, zero failed/skipped/cancelled (171,332.2529 ms).
- Native Chrome real-DOM verification at `cc1e1c3`: **836 passed**, with a synthetic provider and no external RPC.

The source tree remained fixed during each integration and native browser run. The earlier successful complete wallet suite remains **13,948 tests at `5aa4a25`**; the 5,272-case run is the related integration set for this batch, not a new full-suite claim. Before/focused/integration/browser logs and SHA-256 checksums are in `evidence/2026-10-31-panel-state-continuity/`. Draft-only checks were performed outside the repository while earlier fixed-source validation was running; final checks used the actual repository files.

All records, providers, storage adapters and callbacks were synthetic/local. No signatures, transfers, approvals, secret retrieval, external publication, deployment or restart of the existing 4231 server occurred. The item count is a development ledger, not a mainnet-readiness percentage.
