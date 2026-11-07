# Server-owned proposal delivery boundary

Implementation: `server/agent-proposal-service.mjs`. This is a disabled-by-default
service factory, not an installed route or a running AI. The normal demo does
not serve its source, issue capabilities, or mount `/api/agent/proposal`.

## Trusted host versus untrusted request

The host registers a connected agent using its own synchronous context reader,
proposal callback and expiry. Registration validates the existing read policy
and session, and returns a random 256-bit opaque capability. The server stores
only its SHA-256 hash. A browser cannot register a session through HTTP, submit a
replacement policy, choose a model, replace an endpoint, or enable signing.

One active grant exists per agent. A replacement revokes that agent's old grant;
DAT, EMA and CAWELON remain independent. The grant lasts at most ten minutes and
is invalid after server restart. Account, chain, origin, epoch, permissions and
policy remain bound to the host snapshot. Invalid/changed context, expiry,
revocation or clock rollback fails closed. The host must revoke on logout and
session changes; it must not derive its trusted context from client assertions.

There is no login/bootstrap implementation in this module. Secure capability
delivery through an already authenticated host channel remains a deployment
requirement. Capabilities belong in memory, never URLs, browser persistent
storage, logs, historical records or provider prompts. They authorize proposal
generation within the configured scope, not wallet access. XSS in the trusted
origin can still compromise an in-memory capability; this is not an XSS defense.

## HTTP-shaped contract

- Fixed path `/api/agent/proposal`, POST only, no query string or fragment.
- Exact configured URL origin and `Origin` header. Cross-site fetch metadata is
  rejected. Cookies alone cannot authorize a request. No permissive CORS headers.
- `Authorization: Bearer <opaque capability>` and JSON content type required.
- Only `{agent, requestId, objective}` is accepted. Duplicate keys, excess
  fields, invalid UTF-8, control characters and oversized input are rejected.
- Request body is bounded to 8,192 bytes; objective to 2,048 characters; request
  ID to 96 characters. Reads share a bounded deadline and cancellation signal.
- Responses use `no-store`, `nosniff` and `no-referrer`. Errors are fixed codes,
  never provider error messages or host configuration.

`handle(Request)` returns a Web `Response`. It does not start an HTTP listener.
The explicit loopback adapter in `proposal-http-host.mjs` now supplies bounded
HTTP handling, admission and shutdown; see `PROPOSAL_HTTP_HOST_EN.md`. It is not
enabled by default. Authenticated host mapping, TLS where applicable, UI hosting
and capability delivery are not supplied by this service or that adapter.

## Idempotency and unknown outcomes

The default quota is one attempted proposal per grant, configurable by the host
up to sixteen. It is an in-memory attempt cap, **not a durable financial budget**.
Restarting or explicitly replacing grants does not establish financial safety.

An optional host-owned `attemptJournal` now adds a committed, global attempt cap
across service/process restarts and grant replacement. See
`PROPOSAL_ATTEMPT_JOURNAL_EN.md`. The journal is not opened implicitly, is not a
client-provided configuration and is not a monetary budget. It reserves before
the adapter is called and records completion before reporting success. A prior
record without a live cached result is refused, not automatically regenerated.
With no journal configured, the original in-memory-only boundary still applies.

An identical request ID and objective returns the cached result; a pending
duplicate returns HTTP 202 without launching work. Changing the objective under
an existing ID is a conflict. Failed, timed-out and cancelled attempts remain
consumed and are not retried. A different ID cannot overlap the active callback.

Timeout/abort cannot prove that a provider did not receive or bill a request.
If the callback ignores cancellation, the session remains busy until it actually
settles. Late outcomes never replace the failed entry. Cleanup does not await a
potentially non-cooperative body cancellation. No automatic polling/retry occurs.

Before every delivery, including a cached response, current host scope and
proposal expiry are checked again. The review is recomputed locally, not trusted
from the callback. Abstention cannot carry a proposal. Output is captured as own
data, so accessors and extra fields cannot become a response serialization path.

## Acceptance and limits

An optional browser transport and panel integration now consume this contract;
see `AGENT_PROPOSAL_CLIENT_EN.md`. Grant receipt is inert, response delivery stages
data only, and same-objective rechecks reuse the request ID. The normal demo is
still not wired to a live service. Host authentication/bootstrap remains required.

```sh
node --test test/agent-proposal-service.test.js
node --test integration/agent-proposal-server.test.mjs
```

The unit suite covers the service boundary, three-agent isolation, cancellation,
late responses, idempotency, quotas, context changes and hostile input. The HTTP
suite uses the **production adapter on an ephemeral loopback port**, a synthetic model transport,
an in-memory DOM fixture and synthetic wallet providers. It passes delivery to
the actual panel/card/session code, explicitly reads pinned observations, exports
a record, and restores it in a disconnected fixture without restoring authority.

This proves local HTTP and application integration, not native-browser operation,
provider authentication, real-chain balances, PC installation or live AI service.
No test reads `.env.local`; no provider API, real wallet, paid call, signature,
transfer, token distribution, betting, swap, LP or B&B is performed.
