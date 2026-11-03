# Preserve observations across sequential reads

Continuation items **206–207**:

206. Retain the accepted token-code result and metadata before subsequent awaits. A later native/token balance read cannot turn an earlier absent-code result into deployed code or rewrite the previously received supply. Metadata capture cancellation prevents the next balance request. Source `c404690`; all 5 new regressions failed before the fix and 193 targeted tests pass afterward.
207. Capture the adapter's two-field block observations before identity, transfer, allowance and resumed-period checks. Reject accessor headers without running them and preserve cancellation before the next anchor read. Capture spender-code fields as well; malformed code data is shown as an invalid partial response rather than a successful observation. Source `fdd3be7`; all 7 additional regressions failed before the fix.

The combined **335-test reader/session/provider/invariant run** passes with zero failures, skips or cancellations. [Initial read regressions](evidence/2026-10-30-read-observation-capture/before.log), [initial targets](evidence/2026-10-30-read-observation-capture/related.log), [header regressions](evidence/2026-10-30-read-observation-capture/headers-before.log), [combined validation](evidence/2026-10-30-read-observation-capture/headers-related.log), [checksums](evidence/2026-10-30-read-observation-capture/SHA256SUMS.txt).

These tests use synthetic adapters and the session class with synthetic providers. They do not establish that an external provider behaved maliciously, expand real-chain scan coverage or prove complete history. No real signature, transaction, approval or private-key operation occurred. The earlier full-wallet run predates these changes.
