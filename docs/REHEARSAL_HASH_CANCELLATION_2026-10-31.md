# Cancel obsolete rehearsal report hash waits

Continuation item **280**, source `4905dda`.

The report-review panel now owns a checksum cancellation handle. Clearing the selected report, changing the expected checksum or pasted text, starting another review, or disposing the panel cancels the obsolete local wait. The revision advances before cancellation callbacks; a completed old review cannot clear the newer review's handle, publish a receipt or initiate a download.

The pre-fix run had **four failures and one passing newer-review control**. The related panel, report-review and file-reading checks now pass **122 tests**, with zero failures, cancellations or skips (2361.6031 ms). These are synthetic DOM tests and do not claim a new live-browser interaction. Native hashing may continue draining under the shared checksum limit after cancellation.

Evidence: [before](evidence/2026-10-31-rehearsal-hash-cancellation/before.log), [related](evidence/2026-10-31-rehearsal-hash-cancellation/related.log), [SHA-256](evidence/2026-10-31-rehearsal-hash-cancellation/SHA256SUMS.txt).

The user's saved rehearsal session is unchanged. No signatures, transfers, approvals, private-key retrieval, publication, deployment or server restart occurred.

Full-wallet validation subsequently passed **13,494 tests**, zero failures, cancellations or skips, in 521502.2926 ms, with source frozen at `4905dda` (documentation HEAD `efdd322`). This covers continuation items 1–280. [Full log](evidence/2026-10-31-rehearsal-hash-cancellation/full-wallet.log).
