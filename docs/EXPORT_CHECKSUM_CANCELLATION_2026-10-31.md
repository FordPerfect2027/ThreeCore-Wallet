# Cancel checksum work during history and report exports

Continuation items **277–279**, source `422724b`.

277. Connect transfer, archive, vault and vault-collection output preparation to their owning cancellation signals. Cancel/dispose ends the local wait without producing a download; cleanup cannot clear a newer operation's abort handle.
278. Connect period-checkpoint and reconciliation exports to their owning signals, including the period-to-reconciliation export branch. Existing generation checks still guard delivery and saved-state updates.
279. Carry existing operation signals through library, report-history, period-report and report-set JSON exports, including selected report exports. Existing storage freshness checks and synchronous delivery requirements remain in force.

All **20 corrected pre-fix regressions failed**: ten output paths, each cancelled and disposed during hashing. The initial run omitted the required requiresNewPlan option in the period fixture; that log is preserved, and the corrected pre-fix run reached the intended cancellation assertion in all cases. The focused run passes **20 tests**. The controller/lifecycle/panel integration run passed **609 tests**, zero failures, cancellations or skips (101872.873 ms).

Evidence: [initial fixture attempt](evidence/2026-10-31-export-checksum-cancellation/before-fixture.log), [corrected before](evidence/2026-10-31-export-checksum-cancellation/before.log), [fixed](evidence/2026-10-31-export-checksum-cancellation/fixed.log), [integration](evidence/2026-10-31-export-checksum-cancellation/integration.log), [SHA-256](evidence/2026-10-31-export-checksum-cancellation/SHA256SUMS.txt).

Native crypto may remain draining after cancellation; the bounded shared checksum service retains its admission reservation until settlement. Tests use synthetic records and memory adapters, without changing the user's browser collection. No signatures, transactions, approvals, private-key retrieval, publication, deployment or server restart occurred.
