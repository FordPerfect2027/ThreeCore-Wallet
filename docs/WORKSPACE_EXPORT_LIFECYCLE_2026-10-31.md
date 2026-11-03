# Workspace export cancellation and diagnostics

Continuation items **289–290**, source `3640a54`.

289. Give each plain workspace export an owned checksum signal. Cancel, staged replacement, invalidation and disposal abort the old wait; its late completion cannot clear a replacement export's handle or offer a download.
290. Capture own diagnostic codes without evaluating accessors, use only own entries of the message table, and recheck generation after diagnostic capture. Error callbacks cannot rewrite a disposed or superseded panel.

The event wrappers now return their action result so local tests can observe settlement. Those three forwarding-only changes were present for the reproduction run; cancellation and diagnostic fixes were not. The 12 new cases produced **11 failures** and one passing replacement-ownership control. All **88 focused tests** then passed. Workspace and secure-backup integration passed **956 tests**, zero failures, cancellations or skips (50884.1427 ms).

Evidence: [before](evidence/2026-10-31-workspace-export-lifecycle/before.log), [focused](evidence/2026-10-31-workspace-export-lifecycle/fixed.log), [integration](evidence/2026-10-31-workspace-export-lifecycle/integration.log), [SHA-256](evidence/2026-10-31-workspace-export-lifecycle/SHA256SUMS.txt).

Checks use fictional records, synthetic DOM handlers and test crypto adapters. They do not establish a new live-browser connection. Underlying native hashing can still drain after local cancellation. No real signing, transfer, approval, private-key access, publication or deployment occurred.
