# Stable period checkpoints, library and report evidence

Continuation items **201–204**:

201. Capture the period plan and checkpoint envelope and a bounded dense completed-prefix array. A supplied map method can no longer remove an acquired window; a sparse array cannot count absent windows as completed. Source `5af6e24`; 195 targeted tests pass.
202. Capture library revisions, entries, names, flags and mutation operands. Reject changing operation kinds and preserve existing capacity, confirmation and compare-and-swap behavior. Query defaults merge only with captured input. Source `97b015a`; 182 targeted tests pass.
203. Capture report source selection, source slots and event queries before validation/use. Source `2dc7e96`.
204. Capture the exact three reconciliation slots, their evidence and queries. Reject decorated or accessor slot arrays; a validated page bound cannot change during the returned copy. Source `2dc7e96`; the combined report/reconciliation target run passes 253 tests.

Three new regression files each had **8 failures before** their corresponding fix. The combined **1,371-test period/reconciliation suite** passes at fixed source `2dc7e96`, with zero failures, skips or cancellations. [Plan/draft before](evidence/2026-10-30-period-capture/before.log), [targeted](evidence/2026-10-30-period-capture/related.log); [library before](evidence/2026-10-30-period-capture/library-before.log), [targeted](evidence/2026-10-30-period-capture/library-related.log); [report/reconciliation before](evidence/2026-10-30-period-capture/report-before.log), [targeted](evidence/2026-10-30-period-capture/report-related.log); [integration](evidence/2026-10-30-period-capture/integration.log); [checksums](evidence/2026-10-30-period-capture/SHA256SUMS.txt).

These are local synthetic tests, not additional real-chain block coverage or real-wallet acceptance. No signature, transaction, approval, key access or user-record deletion occurred. The earlier 12,960-test full-wallet result predates items 201–204 and is not presented as a full run of this source.
