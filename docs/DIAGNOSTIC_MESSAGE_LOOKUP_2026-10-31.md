# Diagnostic message lookup boundaries

Continuation items **307–308**, source `89ecede`.

307. Message selection uses only a table's own entries. Inherited names such as `constructor`, `toString` and `__proto__` cannot become functions or objects presented as an error or issue explanation.
308. Require a primitive string code before table lookup. Boxed strings, hostile coercion hooks, proxies and other non-string values take the ordinary fallback without executing their conversion logic. The same rule covers identity, allowance, transfer, vault, period, library, report, history and report-set helpers (12 functions in nine files).

The final 109-case reproduction produced **64 failures** and 45 controls. All 109 focused cases passed after correction, including specific known-message preservation. View/message/panel integration passed **480 tests**, zero failures, cancellations or skips (64605.6723 ms).

Evidence: [before](evidence/2026-10-31-diagnostic-message-lookup/before.log), [focused](evidence/2026-10-31-diagnostic-message-lookup/fixed.log), [integration](evidence/2026-10-31-diagnostic-message-lookup/integration.log), [SHA-256](evidence/2026-10-31-diagnostic-message-lookup/SHA256SUMS.txt).

Existing known strings and Japanese explanations are unchanged. This is diagnostic input handling, not validation of the underlying wallet or token. The most recent full-wallet checkpoint remains 13,597 passing tests at `23eb408`, through item 300. No real signing, transfer, approval, key access, publication or deployment occurred.
