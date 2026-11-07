# Explicit local proposal HTTP host and application composition

`server/proposal-http-host.mjs` supplies the Node HTTP adapter previously present
only as a test bridge. The browser client, panel and service can be exercised
through the production adapter in loopback integration tests. Its API-only
factory is unchanged; an opt-in application factory can also serve an explicit
public asset map from the same owned listener.

This is a server library, not an automatically installed application. It does not
start on import, read environment files, select a model, create an API key, issue
a wallet permission, expose the application on a LAN, or load the user's page.
The existing demo on port 4230 is not replaced or reloaded.

Exception isolation was strengthened on November 7, 2026: module-private error
branding avoids prototype/getter evaluation while handling adapter failures.
Branding now occurs only in a private factory: an adapter cannot manufacture a
recognized host error by obtaining the constructor of an earlier host error.
Outward codes/statuses come from private metadata, including when an actual host
error's public fields have been changed.
Three-agent concurrent recovery and failed-request replay protection are covered
in `PROPOSAL_ERROR_ISOLATION_2026-11-07_EN.md`. This does not add login/bootstrap
or automatically connect the existing page.

## Lifecycle and host-owned configuration

`createProposalHttpHost({enabled, createService, port, maxConnections,
maxConcurrentRequests, requestTimeoutMs})` returns an inert API-only object. Defaults:
disabled, ephemeral port, 16 connections, six concurrent requests, 35-second
request deadline. It binds only `127.0.0.1` after explicit `start()`. No arbitrary
interface/hostname option exists. Fixed-port collision fails without killing,
replacing or reconfiguring another process.

After binding, a synchronous `createService({origin})` callback supplies the
application-owned service exposing `handle`, `register`, `revoke`, and `dispose`.
The actual bound origin must also be used by the service, policy and session.
Registration with internally consistent policy/session data for a *different*
origin now fails at both service and browser-client boundaries.

`register` and `revoke` are host methods only, never HTTP routes. The returned
capability must still be delivered over an authenticated host channel. Neither
factory implements login, capability bootstrap, a proxy, filesystem serving or a
page with secrets in its URL. The application factory below supplies shared-origin
asset/API routing. A real deployment still needs an authenticated session mapping
and capability-delivery channel; running a separate listener beside the existing
demo does not make that demo's browser client connected.

Multiple `start()` calls share one start/listener; an explicit `close()` aborts
pending requests, disposes the service once and closes accepted sockets. Closing
during startup does not construct a service. An asynchronous or malformed factory
is rejected, with best-effort disposal of late resources. Closed/failed hosts do
not silently restart. Import or shutdown never starts another process.

## Opt-in same-origin public application

`createProposalApplicationHost({publicAssets, ...hostOptions})` accepts the same
host options and returns the same `start`, `register`, `revoke`, `close`, and
read-only `state` interface. It starts disabled by default. Both factories use
one private runtime that owns the Node server, its connection limits, admission,
timeouts, cancellation, and shutdown. No listener or raw request callback is
exported for attachment to an independently configured server.

`publicAssets` is a nonempty array of exact own-data records with these fields:

| Field or bound | Contract |
| --- | --- |
| `path` | At most 256 printable ASCII characters. `/`, or slash-separated segments beginning with a letter or digit and continuing with letters, digits, `.`, `_`, or `-`; one optional final slash. |
| Reserved namespace | `/api` and `/server`, including subpaths, are reserved case-insensitively. |
| `contentType` | Exactly `text/html;charset=utf-8`, `text/javascript;charset=utf-8`, or `text/css;charset=utf-8`. |
| `body` | A string captured as UTF-8 bytes; at most 131,072 bytes per asset. |
| Count and aggregate size | At most 256 assets and 4,194,304 bytes combined. |

Duplicate paths, accessors, extra record fields, sparse arrays, invalid path/type
values, and oversized maps fail synchronously with `INVALID_PUBLIC_ASSETS`
before binding or invoking `createService`. The host captures the array, records,
and bytes during construction; later caller mutation cannot change responses.
Assets are public application code/content. They must contain no capability,
private configuration, or user-specific data. The runtime accepts neither
filesystem source paths nor dynamic asset callbacks, caller-defined response
headers, or cookies.

Only an exact declared `GET` target enters the public branch. There is no query,
index, HEAD, path-decoding, or filesystem fallback. Every other request goes
through the existing API inspector, including its Origin requirement and fixed
POST route. An unknown target with a valid Origin receives `NOT_FOUND`; a missing
or foreign Origin is rejected before route classification.

For a declared public GET, Host must exactly match the bound `127.0.0.1` origin.
Origin may be absent for normal navigation; a supplied Origin must match exactly.
Fetch-Site may be absent, `none`, or `same-origin`; same-site and cross-site values
are refused. Frame, iframe, object, and embed destinations are refused. Duplicate
security headers, including Fetch-Dest, receive `AMBIGUOUS_HEADERS`. Any transfer
coding or nonzero Content-Length receives `REQUEST_BODY_NOT_ALLOWED`; nonidentity
Content-Encoding receives `ENCODING_REJECTED`.

Public replies use fixed no-store, nosniff, no-referrer, DENY framing,
same-origin resource policy, restricted permissions policy, Content-Length, and
Connection-close headers. Their fixed CSP permits self-hosted external scripts,
styles, and connections. Default resources, inline scripts/styles, frames, forms,
objects, and workers are disabled. No custom CSP or CORS relaxation is accepted.
The protected API retains its original JSON response headers.

Public assets share request admission with the API. If a noncooperative service
holds the last slot, a public asset request also receives `HOST_BUSY` until that
service settles. Asset responses use prevalidated bounded bytes; they never call
the proposal service and remain subject to the owned socket and shutdown limits.

This composition does not modify or activate the normal demo. It supplies no new
browser hook, authenticated identity resolver, registration route, capability
bootstrap, or model activation. Those choices remain application responsibilities.

## Protected API and shared resource boundary

- Exact Host and Origin matching, with only same-origin Fetch Metadata accepted
  when present. Host aliases and different ports are not interchangeable.
- Exact POST `/api/agent/proposal`; no registration, runtime-source-file,
  environment-file, health-information, CORS, upgrade or CONNECT route is added.
  Application assets are available only at their declared public GET targets.
- Reject duplicate security-sensitive headers, non-JSON/compressed requests,
  malformed bearer headers, unsupported Expect handshakes and oversized bodies.
- At most 8,192 request-body bytes, including streamed/chunked uploads, and
  131,072 response-body bytes. Bounds apply before data is forwarded or delivered.
- Fixed JSON errors and security headers; never forward service cookies, CORS,
  stack traces or arbitrary exception text. No request logging is implemented.
- Deadlines bound partial uploads, service handling and response streams.
  Disconnect/close propagates cancellation. Late streamed responses are cancelled
  without being delivered. A non-cooperative service keeps its admission slot
  until it actually settles, even after the client has received a timeout.
- Only an already authenticated service grant permits proposal work. Loopback
  binding and origin checks alone are not authentication, nor a defense against
  other software acting as the same OS user or XSS in a trusted UI origin.

The service also rejects its own bearer capability in request IDs/objectives so
it cannot be reflected in request status or forwarded into a model prompt.
The browser client distinguishes fixed host-busy/timeout/unavailable/error codes
without automatically polling, reissuing or creating a new request ID.

## Verification and remaining gates

Run `node --test integration/proposal-host-server.test.mjs` for host lifecycle,
admission, duplicate-header, body-limit, deadline, disconnect and refusal tests.
`integration/proposal-host-stream-server.test.mjs` covers prompt response chunks,
elapsed deadlines and cancellation. Composition-specific coverage is in
`integration/same-origin-proposal-host-server.test.mjs`; error-constructor
provenance is checked in `integration/proposal-host-error-provenance-server.test.mjs`.
`integration/agent-proposal-server.test.mjs` now runs the actual panel/client,
this HTTP host, service, synthetic model adapter and synthetic wallet reads for
DAT, EMA and CAWELON on chain IDs 8453 and 84532. It also covers cache reuse,
record export/disconnected restoration and durable attempt limits after service
recreation. All listeners use ephemeral loopback ports and are closed by tests.

These integration tests use real local HTTP with synthetic DOM, model and wallet
data. Composition acceptance registers synthetic grants through private host
methods and hands them to the client out of band. This proves shared-origin
routing and capability enforcement; it does not prove real-user authentication
or implement a production capability-delivery channel. Native-browser execution,
real balances, intended-PC deployment, live-model authorization, and a spending
budget require their own evidence and authorization. No private key, API key,
funds, transaction, signing permission or open browser page is used by these tests.

HTTP implementation reference checked during development:
https://nodejs.org/docs/latest-v24.x/api/http.html (Node 24 documentation).
