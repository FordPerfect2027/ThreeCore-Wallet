# Bounded, cancellable checksums for evidence files

Continuation items **269–274**, source `7ebff6d`.

269. Add cancellation, a monotonic completion-time deadline, and bounded admission to shared SHA-256 work. Cancellation and timeout end the caller's wait; a native operation retains its reservation until it actually settles. Admission permits at most eight active/draining jobs and 128 MiB of reserved input bytes per JavaScript realm, with a 96 MiB individual input limit. These are input reservations, not a total heap limit. Shared, resizable or detached inputs cannot misstate the reservation.
270. Forward signals and optional deadlines through transfer, archive, vault and vault-collection encoding and decoding.
271. Forward those controls through period, library, report, report-history, report-set and reconciliation file checksums.
272. Carry the controls through workspace and checkpoint collections, including nested workspace verification. The workspace file reader now retains its cancellation signal during decoding after the byte read.
273. Carry the controls through identity and allowance evidence, including nested allowance-bundle files.
274. Accept cancellation and a deadline for rehearsal report-review hashing while retaining the existing receipt content and authenticity limits.

Default/maximum wait is 30,000 ms **per checksum**, not for an entire multi-file operation. File-read timeouts remain separate. Expired results are rejected even if a blocked event loop delays the timer callback. Native WebCrypto work cannot be forcibly stopped; repeated cancellation cannot free its reservation early. Busy/timeout/cancellation errors map to each file format's existing crypto diagnostic. Controller exports still need to supply their owning signal where they do not already do so; this record does not claim all UI actions have been wired.

The original primitive reproduction had **15 failures and one passing isolation control** across 16 tests. All 32 format propagation cases failed before signals were forwarded. Expanded validation passed **145 tests**, including 15 decoding cases, native-state shadowing, late rejection, byte/job admission, cleanup, detached inputs and the SHA-256 empty-message known answer. The final existing-format, file-reader and HTTP integration run passed **1,095 tests**, zero failures, cancellations or skips (53628.7446 ms).

Evidence: [primitive before](evidence/2026-10-31-checksum-cancellation/before.log), [initial primitive fix](evidence/2026-10-31-checksum-cancellation/fixed.log), [format propagation before](evidence/2026-10-31-checksum-cancellation/formats-before.log), [format propagation fixed](evidence/2026-10-31-checksum-cancellation/formats-fixed.log), [expanded](evidence/2026-10-31-checksum-cancellation/expanded.log), [integration](evidence/2026-10-31-checksum-cancellation/integration.log), [SHA-256](evidence/2026-10-31-checksum-cancellation/SHA256SUMS.txt).

No new HTTP route or dependency package is required. Tests use synthetic adapters and records. No signatures, transfers, token approvals, private-key access, publication or deployment occurred. The preceding full-wallet checkpoint remains the 13,304-test pass at source `48eb566`, through item 260.
