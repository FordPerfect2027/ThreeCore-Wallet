# Guidance for a saved file opened in the wrong rehearsal panel

Continuation item 376. Source revision `6655a56`.

When an existing decoder rejects a file with a recognized simulation format belonging to another panel, the page now names the appropriate section. This covers single-record files, workspace backups, combined sessions, comparison collections, expected outcomes and six reviewable report formats. A review receipt instead asks for its original source report. File and paste workflows retain the current records and do not automatically move data or restore anything.

Hints inspect a bounded JSON declaration only after failed validation: maximum 2 MiB, depth 24, 150,000 nodes and bounded keys/strings. Unknown, malformed, ambiguous, unsafe-key and non-simulation inputs receive no guessed route. A recognized declaration is not proof that the rest of the document is valid. Existing decoder validation and per-panel file limits remain authoritative. Fixed destination titles are used rather than imported prose or paths; successful decoding is unchanged.

## Validation

- Initial targeted feature checks: **36 passed**.
- Final tests use real output from all 12 supported exporters, preserve live data across every wrong-panel file/paste workflow, and exercise bounded rejection.
- First integration: 1,109 passed, one failure because an existing test still expected the former generic error wording. The assertion was updated to the intended destination title; its other history/undo preservation checks remain.
- Final rehearsal, file-status/panel, JSON and server/navigation integration: **1,110 passed**, zero failed/skipped/cancelled; **35,917.3449 ms**.
- Native Chrome at fixed source: **837 passed**, including a wrong-format paste in the native rehearsal DOM, disabled restoration and unchanged existing rows.
- Evidence and SHA-256 checksums: `evidence/2026-10-31-rehearsal-file-target/`. The initial failed integration log is retained.

Latest full-wallet checkpoint remains 14,181 tests at `a4d6952` through item 360. No new full-wallet run is claimed. Synthetic local data only; no wallet signatures, transfers, approvals, secret retrieval, external RPC, publication, deployment or existing-server restart.
