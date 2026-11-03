# Shared public diagnostics — items 131–138

Source: `472d3b2` (local only). Existing holdings/allowance and Classic-pool inspections used unbounded JSON parsing and relied on transport cancellation alone. They now share the bounded public Base reader with the connectivity diagnostic.

## Completed work

131. Extract one shared public diagnostic reader and preserve the three callers' public result/error types.
132. Apply bounded streaming JSON and contract-code validation to the holdings/allowance inspection.
133. Apply the same bounded reader to Classic-pool discovery, including reads of discovered pool contracts.
134. Restrict diagnostic call data to the six existing read selectors, canonical address words and the pool-type boolean; reject approval/transfer selectors and extra transaction fields before transport.
135. Require explicit canonical block-number parameters for all shared state reads; reject `latest` and overlong quantities before transport.
136. Enforce deadlines for both Aerodrome inspections through stalled headers or bodies, and cancel late responses without waiting indefinitely.
137. Preserve failure outcomes across the complete inspection: an error on the final read discards earlier observations instead of returning an apparently complete or zero-valued report.
138. Verify these integrations and Base-probe compatibility with controlled responses, including exported error classes, transport privacy settings and saved test evidence.

## Verification

**78 tests passed, zero failed**, including 23 added tests. No live public RPC, wallet extension, account connection or transaction was used.

```powershell
node --test --test-concurrency=2 test/aerodrome-readonly.test.js test/aerodrome-pools.test.js test/aerodrome-rpc-security.test.js test/public-base-rpc.test.js test/base-rpc-probe*.test.js test/state-rpc-http.test.js
```

[Test log](evidence/2026-10-30-public-diagnostics/public-diagnostic-tests.log), [checksums](evidence/2026-10-30-public-diagnostics/SHA256SUMS.txt).

The new shared reader accepts only the two fixed public Base HTTPS endpoints. Its RPC methods are chain ID, block number, code and the restricted read calls already used by these inspections. Read selectors cover balance, existing allowance, Classic pool lookup, token identities and reserves. It does not expose a wallet transport or execute signed transactions.

Both inspectors retain their existing schemas, fixed contract manifests, block-number pinning and unknown-reserve distinctions. Tests cover rejection before network access, byte limits with and without a declared size, malformed UTF-8, duplicate keys, mixed result/error envelopes, redirected/non-OK responses, noncanonical quantities, oversized bytecode, sanitized transport failures and final-read failure. Deadline tests use controlled virtual time; they are not production latency measurements.

The deadline is per request, not for a complete multi-request inspection. Contract identities and live deployment state were not revalidated in this change. Block-number pinning does not establish a canonical block hash or prevent reorganizations. No reserve result, token safety, mainnet readiness percentage or real account balance is inferred from these tests.
