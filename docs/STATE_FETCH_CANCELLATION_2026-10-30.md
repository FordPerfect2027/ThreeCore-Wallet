# State-read header cancellation — items 148–153

Source: `78d9e3c` (local only). The previous [body-cancellation update](RPC_DIAGNOSTIC_HARDENING_2026-10-30.md) explicitly retained a limitation while waiting for initial fetch headers. This update closes that local waiting gap in the same-origin state provider and relay.

## Completed work

148. Add an abort-aware header reader that stops awaiting an uncooperative fetch, handles later rejection and cancels a late response body.
149. Apply it to the browser state provider so its existing deadline covers both header and body waits.
150. Apply it to the relay so client closure releases request capacity while upstream headers remain unresolved.
151. Reject a response marked redirected even when an injected transport ignores the requested redirect policy.
152. Explicitly suppress referrer transmission in the relay's upstream request, matching its existing omitted-credential/no-cache settings.
153. Verify header/body lifecycle cleanup, deadlines, late completion and real local relay-slot reuse with retained evidence.

## Verification

**56 tests passed, zero failed**, including nine added tests. [Test log](evidence/2026-10-30-state-fetch/state-fetch-tests.log), [checksums](evidence/2026-10-30-state-fetch/SHA256SUMS.txt).

```powershell
node --test --test-concurrency=2 test/base-state*.test.js test/state-rpc-http.test.js integration/base-state-rpc-server.test.mjs integration/demo-server.test.mjs
```

The additional HTTP integration test opens twelve local client requests with unresolved upstream fetches, confirms the thirteenth is refused, closes the twelve clients, then confirms twelve new requests succeed. Only afterward does it release the original fetch promises; all twelve late bodies are cancelled. Another test confirms redirected upstream success returns the local generic error. Upstream fetch is mocked; no public RPC or real wallet is contacted.

Unit tests cover pre-aborted input without a fetch call, listener cleanup after success/failure, late rejection after abort and a provider deadline using controlled virtual time. Existing canonical block selectors, request allowlists, origin checks and response bounds remain in force.

## Limits

The application can stop awaiting an uncooperative injected transport, but cannot force that transport's underlying network activity to stop. Its abort signal is requested; late completion cannot produce a successful result. The concurrency limit bounds active relay handlers, not indefinitely running operations inside a custom transport that ignores cancellation.

The currently running rehearsal process was started before this source change. Its server-side transport is not represented as updated merely because these isolated integration tests passed. No live-server restart, deployment, signatures, transfers, approvals or private-key retrieval occurred in this batch.
