# Liquidity data capture — items 162–163

Source: `723042b` (local only).

162. Capture the root, token entries and consumed reserve fields through own data descriptors before calculation. Accessors and inherited values cannot supply changing observations during validation or formatting. Unused fields and stable-pool contents are not traversed.
163. Verify safe capture, error handling and interoperability through the actual diagnostic command path. **39 tests passed, zero failed**, including six added tests.

```powershell
node --test --test-concurrency=2 test/liquidity-target.test.js test/public-diagnostic-cli.test.js
```

[Test log](evidence/2026-10-30-liquidity-capture/capture-tests.log), [checksums](evidence/2026-10-30-liquidity-capture/SHA256SUMS.txt).

The tests cover getters at every consumed layer without execution, unused getters without traversal, ordinary property reads that would change/throw, inherited records, null-prototype records, unchanged source input and bounded errors from throwing reflection traps. Existing reserve bounds, canonical provenance and exact arithmetic remain covered.

Reflection on a Proxy can itself execute application code; capture is not a hostile-code isolation mechanism. It avoids invoking property getters and rereading values during calculation. A fabricated but well-formed observation is not authenticated by this process. All command tests use non-forwarding mocked RPC; no live account, signature, transfer or private key is involved.
