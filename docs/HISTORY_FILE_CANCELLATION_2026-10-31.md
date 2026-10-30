# History-file cancellation reaches the file reader

Continuation items **258–260**, source `48eb566`. Pre-fix reproduction was saved on October 30; implementation and validation resumed on October 31, 2026 (Asia/Tokyo).

258. Forward cancellation from single-token history and archive imports to the bounded file reader. Superseding actions detach the old abort handle, and cleanup cannot clear a newer import's handle.
259. Forward the existing vault operation signal through working-copy, legacy snapshot, legacy archive and collection imports. Cancel/dispose ends the local wait before an unresolved byte-read promise returns.
260. Bind reconciliation and period-checkpoint file imports to their owning cancellation signal. Token selection/disposal stops the old import, and cancellation during filename validation prevents file IO.

All **24 original regressions failed before the fix** and pass after it. Eight additional acquired-stream checks confirm cancellation reaches the stream reader without using the fallback byte method. The focused controller run passes **257 tests**; the panel/native-file integration run passes **156 tests**, including all **32 new tests**. Both have zero failures, skips or cancellations.

The first related run had one file-level failure: an old late-rejection test rejected a synthetic promise whose byte read was now correctly prevented. The test now waits for the byte read to actually start before cancelling; it still verifies that a late rejection cannot overwrite a newer review. Both failed and corrected logs are preserved.

Evidence: [before](evidence/2026-10-31-history-file-cancellation/before.log), [original 24 fixed cases](evidence/2026-10-31-history-file-cancellation/fixed.log), [first related run](evidence/2026-10-31-history-file-cancellation/related.log), [corrected related run](evidence/2026-10-31-history-file-cancellation/related-fixed.log), [integration](evidence/2026-10-31-history-file-cancellation/integration.log), [SHA-256](evidence/2026-10-31-history-file-cancellation/SHA256SUMS.txt).

Cancellation ends the caller's wait and requests stream cancellation when supported. A non-cancellable underlying arrayBuffer promise can continue draining; page-wide resource accounting still retains that work. No physical IO stop is promised for such adapters. The tests use synthetic files, not the user's saved browser collection. No wallet signatures, transactions, approvals or private-key operations occurred. The preceding full-wallet validation at `e50123f` predates this change.
