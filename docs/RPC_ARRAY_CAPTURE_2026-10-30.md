# Bounded RPC array capture

Continuation item **195** closes a reproduced false-empty-history path at the RPC boundary. A provider array could report length 1 during validation and 0 during copying, causing its actual event to disappear. The shared RPC array copier now captures the own length and indexed data descriptors, including nested topics and request parameters. It never uses a live length or an input array method. Revoked result arrays receive a stable public error, and the existing session-level oversized-log error remains unchanged.

**9 of 10 new regressions failed before** the fix. **362 related tests** pass afterward, covering the new cases, security policy, provider mutation, read phases, adapter boundaries and the real session class with synthetic providers. No failures, skips or cancellations. [Before](evidence/2026-10-30-rpc-array-capture/before.log), [related](evidence/2026-10-30-rpc-array-capture/related.log), [checksums](evidence/2026-10-30-rpc-array-capture/SHA256SUMS.txt).

This is a local input-handling regression fix. It is not evidence that the user's provider actually returned such an object or that prior real blockchain results were false. No live wallet request, signature, transaction, approval or private-key operation was performed.

Source: 18ebafea5be0ccc135f6b487d1575532caed9ed3.
