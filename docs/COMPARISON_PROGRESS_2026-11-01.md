# Visible progress through both comparison source groups

Item 572. Source: ef2256f.

Portable comparison preparation and review now announce the current source group and processed/selected file count in both wallet and rehearsal screens. Separate messages cover parsing, comparison, whole-package hashing and serialization. Counts represent completed processing, including negative source results; they are not passing-file counts or a readiness percentage. Final verification retains its existing separate verdict.

The optional onStage observer receives frozen metadata without source names or contents. Existing onProgress callbacks retain their previous payloads. Observer failures and rejected promises cannot change evidence or verdicts; callback time is included in the shared deadline, and cancellation prevents the next group or completion from being reported. Source replacement and disposal suppress old UI updates. A cancelled rehearsal always leaves a cancellation message, including when interrupted after an intermediate stage.

30 selected tests passed (8638.6087 ms). 130 focused native browser file-read cases passed, including live status mutations and cancellation from the first group's progress. [Captured traces](evidence/2026-11-01-comparison-progress/capture.json) identify reproducible item-567 inputs and SHA-256 values, demonstrate identical outputs with/without observers and preserve original negative source classifications. UI tests also cover saving with progress, source replacement and empty stale-result views. These are local synthetic/native-browser checks, not an OS picker or user-wallet connection confirmation.

Last full browser checkpoint: 5b34eec (968 cases). Last full-wallet checkpoint: d253e8d (15,720 tests). No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred. This is one progress-reporting capability across both comparison workflows.
