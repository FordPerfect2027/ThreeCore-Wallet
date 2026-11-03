# Bounded offline file inspection

Continuation items 361–364. Source revision `001ef8a`.

361. Shared offline reading validates a finite positive integer cap before opening a file, rejects non-regular or invalid-size inputs, allocates only the admitted file size, reads in bounded chunks and closes the handle on completion or failure. Vault inspection exposes a specific invalid-limit diagnostic.

362. Inspection checks for an extra byte and compares size, modification/change timestamps and file identity after reading. Observable same-length edits are rejected before interpretation. This is best-effort concurrent-change detection, not an atomic filesystem snapshot or an authenticity guarantee.

363. Identity, allowance, transfer snapshot/archive and historical vault/report CLI paths use the checked bytes while retaining existing format diagnostics. Transfer/identity/allowance inspection no longer allocates the entire format limit for every small input.

364. Rehearsal input and shared rehearsal report/session readers use the same stable-read checks before hashing or decoding, preserving strict UTF-8, existing BOM policy and existing byte-based checksums.

## Validation

- Original regression set: 23 cases, 20 failed and 3 passing controls. All 23 passed in the draft fix, including a real temporary file changed between reads. The test verifies closure and that the reader does not modify the replacement content.
- Existing CLI draft compatibility: 86 passed.
- Final explicit selection of 24 CLI/inspection test files: **345 passed**, zero failed/skipped/cancelled; **19,663.4046 ms**. Selected paths are retained with the evidence.
- An earlier test selector matched no paths because it did not account for Windows separators. Node then began default discovery, including archived migration tests and an integration test intended for other repositories. That run was interrupted, retained in `mis-scoped-attempt.log`, and is not counted as successful validation. The corrected run requires exactly 24 explicit test paths before invoking Node.
- Evidence and SHA-256 checksums are in `evidence/2026-10-31-local-file-inspection/`.

The latest full-wallet and native Chrome checkpoint remains `a4d6952` through item 360: 14,181 wallet tests and 836 native UI cases. This batch changes offline tools and does not claim a new full/browser run. Only synthetic fixtures and explicitly created temporary files were used. No signatures, transfers, approvals, secret retrieval, publishing, deployment or restart of an existing server.
