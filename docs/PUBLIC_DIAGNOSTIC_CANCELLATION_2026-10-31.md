# Public diagnostic cancellation: items 445–448

Source: `2c7a03c`.

445. The fixed-endpoint public Base RPC reader accepts an optional AbortSignal. It rejects pre-cancelled work, aborts its in-flight transport on cancellation, ends local waiting even if a transport ignores cancellation, releases unread late bodies, consumes late rejection, and removes abort listeners after a completed request. The first stop reason distinguishes caller cancellation (RPC_CANCELLED) from timeout (RPC_TIMEOUT). Existing method/selector, block, response-size and endpoint restrictions remain.
446. Base connectivity and optional contract-code inspection forwards caller cancellation across its sequential reads and captures its supported options before validation.
447. Aerodrome contract/holding/allowance inspection forwards the same cancellation contract without initiating later subreads. This inspects existing allowance amounts only.
448. Aerodrome Classic pool discovery forwards cancellation across the bounded token/pool loop and captures supported options before use.

These APIs support application-supplied cancellation. This batch does not add a command-line interrupt handler or claim that a remote service stops work it already received.

## Validation

- Selected pre-feature cases: 11 failures, zero passes/skips, 516.4874 ms. The old APIs did not support caller cancellation or captured option accessors.
- Isolated draft: initially 16/17 passed. One test incorrectly assumed the Node runtime rejects a transparent Proxy around an AbortSignal. It was corrected to use a revoked Proxy, which is invalid. This test correction is not an additional item; both logs are retained. Corrected draft: 17 passed, 650.1411 ms.
- Final focused diagnostic/CLI checks: 115 passed, zero failed/skipped/cancelled, 6,034.0007 ms.
- Related diagnostic, bounded HTTP and local RPC server checks: 145 passed, zero failed/skipped/cancelled, 6,412.4241 ms. These runs validated the code later committed at the source above.
- Six captured synthetic runs show zero calls after pre-cancellation and exactly one call when cancellation happens at the first response, for each of the three inspectors. Every outcome is RPC_CANCELLED; every signal has zero remaining listeners.

[Evidence](evidence/2026-10-31-public-diagnostic-cancellation/) includes the captures, before/draft/final logs and SHA-256 checksums. All transport tests use fixtures. No external RPC, wallet signature, transaction, approval, secret, existing-server restart, publication or deployment occurred. The latest full-wallet and native checkpoint remains item 444 at b69f5e5 (14,836 full-wallet and 865 native Chrome cases). This API/CLI batch has scoped integration verification and does not claim a new full-wallet or native UI run.
