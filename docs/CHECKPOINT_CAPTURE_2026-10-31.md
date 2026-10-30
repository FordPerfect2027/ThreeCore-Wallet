# Checkpoint captured records and storage revisions

Continuation items **291–294**, source `ae82834`.

291. Capture checkpoint document and slot fields from own data properties. Read bounded array length and slots through descriptors, reject accessors and normalize reflection failures. Validation and returned data use the same captured values.
292. Capture checkpoint operation fields once, including its kind; enforce the exact shape for save, import, rename, archive, unarchive and purge before mutation. Input getters cannot redirect the selected ID or replace a validated timestamp or payload.
293. Build import proposals and skipped-ID summaries from one validated incoming collection. No caller-provided array filter or later row reads participate in the summary.
294. Validate freshly read storage data before comparing its revision in inspection, restore staging and exports. The controller rechecks ownership after capture; a stale captured revision invalidates cached metadata and cannot be hidden by an ordinary property getter.

The model/import reproduction produced **20 failures among 21 tests**, with unsupported mutation as a passing control. Four additional controller cases all failed before the storage-read correction. The initial model/transfer run passed 143 tests; final checkpoint integration passed **368 tests**, zero failures, cancellations or skips (7327.4208 ms).

Evidence: [model/import before](evidence/2026-10-31-checkpoint-capture/before.log), [storage before](evidence/2026-10-31-checkpoint-capture/storage-before.log), [focused](evidence/2026-10-31-checkpoint-capture/fixed.log), [integration](evidence/2026-10-31-checkpoint-capture/integration.log), [SHA-256](evidence/2026-10-31-checkpoint-capture/SHA256SUMS.txt).

Reflection on a Proxy can still execute application code; stateful callers recheck ownership afterward. This does not make arbitrary adapters trusted or make a multi-object snapshot atomic. Existing five-entry, file-byte and aggregate-byte limits remain enforced. All fixtures are fictional and all writes local test storage. No real signing, transfers, approvals, key access, publication or deployment occurred.
