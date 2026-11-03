# Captured saved-report records, mutations and presentation settings

Continuation items **223–225**, source `0e8bcd9`:

223. Use the captured history entry/document and mutation operands. Compare tag ordering against the captured array, reject mutation-kind changes during capture, and map inaccessible mutation objects to a bounded public error.
224. Capture report-set source flags and export preferences. A live property trap cannot change an accepted includeNotes=false into true when producing a presentation export.
225. Use captured history and diagnostic filters so a live property read cannot broaden the selected archive scope or replace the requested severity filter.

All **13 new regressions fail before the fix**. The targeted **187-test** run and broader **592-test report-history/report-set suite** pass with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-report-record-capture/before.log), [targets](evidence/2026-10-30-report-record-capture/related.log), [integration](evidence/2026-10-30-report-record-capture/integration.log), [checksums](evidence/2026-10-30-report-record-capture/SHA256SUMS.txt).

The adversarial objects are synthetic tests, not evidence that user notes were disclosed. No external publishing, real-chain scan, signature, transaction or private-key operation occurred. The earlier full-wallet validation at `f239e04` predates this change.
