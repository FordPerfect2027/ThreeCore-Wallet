# Cancellation of saved-library file imports

Continuation items **261–262**, source `465865a`.

261. Pass the period library's current operation signal to its file reader. Cancelling or disposing ends the local wait, reaches an acquired stream, and preserves the previously loaded library.
262. Pass the report-history operation signal to its file reader with the same guarantees. Cancellation during filename validation prevents file IO and cannot stage an import review.

All eight new regressions failed before the fix. The corrected controller, panel and native-file integration run passed **248 tests**, with zero failures, cancellations or skips (31433.9159 ms). The files and storage adapters in these checks are synthetic; the user's saved collection was not changed. A non-cancellable byte promise may continue draining after the caller's wait ends, with resource accounting retained by the file service.

Evidence: [before](evidence/2026-10-31-library-file-cancellation/before.log), [related tests](evidence/2026-10-31-library-file-cancellation/related.log), [SHA-256](evidence/2026-10-31-library-file-cancellation/SHA256SUMS.txt).

The earlier 13,304-test full run covers fixed source `48eb566` through item 260. This subsequent change has the targeted/integration validation above. No signatures, transactions, approvals, private-key retrieval, publication or deployment occurred.
