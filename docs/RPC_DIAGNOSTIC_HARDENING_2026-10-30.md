# RPC diagnostic bounds and cancellation — items 121–130

Source: `2932b41` (local only). This work fixes the existing public Base diagnostic and the shared HTTP response reader used by the wallet's read-only state path. It does not add signing or transaction methods.

## Completed work

121. Reject inherited network-property names and coercion objects before selecting a public endpoint.
122. Replace unbounded diagnostic response parsing with the existing two-MiB streaming limit.
123. Apply strict UTF-8 and duplicate-key JSON validation and reject mixed result/error envelopes.
124. Bound canonical hexadecimal quantities and contract-code result size.
125. Explicitly omit credentials, block redirects and disable cache/referrer transmission in the diagnostic.
126. Enforce a hard per-request deadline even if an injected fetch implementation ignores its abort signal; discard late results.
127. Cancel stalled response-body reads without waiting indefinitely for cancellation, and clean up listeners/reader locks.
128. Apply body cancellation to the browser state provider and relay, return timeout status on abort, and release relay slots on client closure.
129. Request optional contract code at the observed block number and return that code-query block number explicitly.
130. Verify failures, deadlines, late results, stream cleanup and actual local HTTP relay behavior with saved test evidence.

## Verification

**71 tests passed, zero failed**, including 19 new tests. All upstream responses were controlled fixtures; no public RPC endpoint, wallet extension or real account was contacted.

```powershell
node --test --test-concurrency=2 test/base-rpc-probe*.test.js test/base-state*.test.js test/state-rpc-http.test.js integration/base-state-rpc-server.test.mjs integration/demo-server.test.mjs
```

[Log](evidence/2026-10-30-rpc-diagnostic/rpc-tests.log), [checksums](evidence/2026-10-30-rpc-diagnostic/SHA256SUMS.txt).

The HTTP integration test holds all twelve relay slots with stalled response bodies, verifies the next request is refused, closes all twelve clients, then verifies twelve new requests succeed. This exercises real local sockets with mocked upstream bodies, including cancellation promises that never resolve.

Deadline tests use virtual time, including a fetch that resolves only after the timeout and a stream that never finishes. They establish control-flow behavior, not a measured production latency guarantee. Successful streaming also verifies a multibyte UTF-8 character split across chunks and listener/lock cleanup.

## Behavior and limits

The standalone diagnostic still uses only `eth_chainId`, `eth_blockNumber` and optional `eth_getCode` against its fixed Base endpoints. The code request uses the canonical hexadecimal representation of the observed block number. Its result includes `contractCodeBlockNumber`; it does not claim a canonical block hash or reorganization-proof observation.

Response text is limited to two MiB, with depth/node/string limits before parsing. Contract-code output has the existing separate 128-KiB bytecode limit. Malformed values, RPC errors, non-OK HTTP, redirect indications and timeouts never become empty successful results. Unexpected transport exception text is replaced by a local diagnostic message.

The diagnostic hard deadline is per request, not for the entire multi-request check. The existing browser provider and relay still rely on the native fetch abort signal while awaiting initial fetch headers; this change explicitly makes their later body-reading stage abortable. No new retries or alternate endpoints are added. Cancellation of an uncooperative custom implementation is best effort; its late completion cannot create a successful diagnostic result.

These checks concern local software behavior, not live endpoint availability, contract safety, mainnet readiness or an external audit. No signatures, transfers, approvals, private-key retrieval, publishing or deployment occurred.
