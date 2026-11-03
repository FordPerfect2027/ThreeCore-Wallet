# Inclusive history limit at the RPC boundary — November 2, 2026

Source `96b59459a0f593246c60f0bed4b52052211a464a` fixes a missing limit in
`guardRpcRequest`. The session and history UI already reject requests wider
than 2,000 blocks, but a direct call to the Base state provider, or a valid
same-origin HTTP request to its relay, could bypass that span limit. The relay
would forward the account- and token-bound query to its fixed upstream.

The common dispatch guard now uses `MAX_TRANSFER_BLOCKS` from the existing
transfer codec and rejects inclusive spans above 2,000 before dispatch. The
existing address, topic, Origin, timeout and response-size checks remain in
place. Block arithmetic uses BigInt, including near the uint256 boundary.
This does not enable another RPC method or change history routing.

## Reproduction and verification

Three new regression cases fail on parent `c2159aa` and pass with the fix:

- The dispatch guard accepts one block and exactly 2,000 blocks, and rejects
  2,001 blocks and the whole uint256 range without precision loss.
- A direct state-provider request is refused before the HTTP adapter runs;
  the valid 2,000-block request still reaches that adapter.
- An actual isolated loopback server rejects an oversized HTTP request with
  status 400 and no upstream call. A valid request reaches the stub upstream
  unchanged and returns status 200.

The complete related selection passed **585 cases**, including these three:
RPC filtering, provider capture, wallet sessions, account/network changes,
transfer codecs/readers, state transport and HTTP integration. This is a
focused regression, not a new full Wallet or real-wallet acceptance run.

```powershell
node --test --test-concurrency=1 --test-name-pattern='inclusive 2000-block|direct state-provider log|HTTP relay enforces the history span' test/security-rpc.test.js test/base-state-provider.test.js integration/base-state-rpc-server.test.mjs

node --test --test-timeout=60000 --test-concurrency=2 test/security-rpc.test.js test/base-state-provider.test.js test/base-state-session.test.js test/wallet-session.test.js test/connection-boundaries.test.js test/transfer-codec.test.js test/transfer-session.test.js test/transfer-reader.test.js test/transfer-data-capture.test.js test/rpc-array-capture.test.js test/rpc-provider-mutation.test.js test/rpc-read-phases.test.js test/rpc-session-integration.test.js test/external-privileged-rpc-boundary.test.js test/state-rpc-http.test.js test/state-rpc-native-signal.test.js test/state-rpc-byte-capture.test.js integration/base-state-rpc-server.test.mjs integration/transfer-server.test.mjs
```

[Before](evidence/2026-11-02-release-regression/rpc-range-before.log),
[after](evidence/2026-11-02-release-regression/rpc-range-after.log),
[related regression](evidence/2026-11-02-release-regression/rpc-range-regression.log),
[source patch](evidence/2026-11-02-release-regression/rpc-range-source.patch),
and [review receipt](evidence/2026-11-02-release-regression/rpc-range-review.json)
are retained with the existing evidence manifest. The before-log is an
intentional reproduction failure, not discarded or rewritten evidence.

## Deployment and review limits

All new requests used fictional accounts and injected local upstreams. No
public RPC, wallet permission request, signature or transaction was involved.
The original port 4231 process and tabs remain untouched; a running server
does not automatically replace its already-loaded Node modules. The new
source was exercised by separately started disposable servers only.

The verified `16a0d33` ZIP predates this fix. Do not describe that ZIP as
containing `96b5945`; collect this revision in the next combined delivery.
The bounded developer review also traced account-change cancellation and
workspace restore/rollback, but it does not constitute independent review.
Real-wallet acceptance and the previously recorded Zod finding remain open.
