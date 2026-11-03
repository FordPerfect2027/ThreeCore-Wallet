# Rehearsal cancellation preserves newer work

Continuation items 421–425. Source revision `ec2c7c4`.

421. Expectation checks retire the old review before cancelling its file read. A cancellation observer can start a new pasted review or file read without the retired handler clearing it. Disposed panels reject late reads.

422. Scenario-case collections carry the owning revision through cancellation, store notifications, comparison callbacks and follow-on actions. A superseded select, preview, apply, undo or file handler stops before it can alter a newer review.

423. Combined-session recovery binds cancellation to both the user interaction and the panel revision. A new recovery preview created during cancellation or view rendering survives the older operation; disposal closes admission before callbacks run.

424. Main rehearsal workspace operations propagate revision ownership through ledger cancellation, scenario refresh, restore rendering and undo. Older file/paste/clear/restore handlers cannot erase a newer preview or overwrite its guidance. This includes single-record import cancellation and undo finalization.

425. Report review detaches old checksum work and clears obsolete UI before cancelling readers, checking ownership after each callback. A newer report or checksum selection survives old file, text, reset and disposal handlers.

## Validation

- Initial cancellation reproduction: **2 passed / 18 failed**, **29,979.1513 ms**. The additional undo reproduction: **5 passed / 1 failed**, **699.3686 ms**. Failure logs are retained.
- Final dedicated regressions: **33 passed**, zero failed/skipped/cancelled; **1,066.716 ms**. Tests cover all five panels, disposal, checksum cancellation, old single-record reads and workspace follow-on actions.
- Page/session/checksum checks: **143 passed**, zero failed/skipped/cancelled; **3,775.2117 ms**.
- Final related rehearsal/server checks: **1,254 passed**, zero failed/skipped/cancelled; **31,461.9061 ms**.
- Native Chrome: **858 passed** at the same source. Five new cases use real file-input selection and immediate cancellation, start a newer pasted review from the cancellation observer, and compare combined-session exports before and after to confirm no data was applied.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-panel-read-cancellation/`.

The ledger is **425 / 600**. Tests, reproduction cases and follow-up corrections within these five fixes are not extra development items. The latest full-wallet checkpoint remains 14,650 tests at `18fa5d5`; this batch has the scoped and native validation above. Local fictional data only. No real signatures, transfers, approvals, private keys, external RPC, publication, deployment or restart of existing servers.
