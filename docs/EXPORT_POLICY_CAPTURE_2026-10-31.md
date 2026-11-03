# Fixed export diagnostics and callback failures

Continuation items **309–310**, source `512c87d`.

309. Capture an export error's own data code once and check that captured value against the fixed allowlist. Code accessors, inherited values, inaccessible descriptors and a property getter that changes between reads cannot expose a different diagnostic. The existing ExportSecurityError instance check and foreign-error fallback remain in place.
310. Route best-effort export cleanup callbacks through the shared observer. A malformed asynchronous `then` method's separately returned native rejection is consumed without treating it as successful cleanup or recursively invoking arbitrary returned thenables.

Eight new cases reproduced **six failures** and two controls. Export, download, receipt and workspace-export integration passed **1,027 tests**, zero failures, cancellations or skips (78955.7265 ms).

Evidence: [before](evidence/2026-10-31-export-policy-capture/before.log), [integration](evidence/2026-10-31-export-policy-capture/integration.log), [SHA-256](evidence/2026-10-31-export-policy-capture/SHA256SUMS.txt).

This does not authorize asynchronous resource creation or establish browser download completion. All adapters and diagnostic payloads in these regressions are synthetic. The most recent full-wallet checkpoint remains the 13,597-test pass through item 300. No real signing, transfers, approvals, private-key retrieval, publication or deployment occurred.
