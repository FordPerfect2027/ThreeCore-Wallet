# Optional browser proposal client

Implementation: `src/agent-proposal-client.js`; optional UI integration:
`examples/agent-proposal-panel.js`. The standard demo remains unconnected to a
model service. No endpoint, credential bootstrap or paid provider call is enabled
by importing this module or mounting the normal panel.

## Host contract

Construct the client with a fixed agent/origin, synchronous application-owned
`readContext` and `stageProposal` functions, and explicit `enabled: true` only
inside an authenticated host integration. The context contains the server-bound
read policy and current connection. `stageProposal` must synchronously validate
and stage data, returning true; it must not execute wallet actions.

Pass a host-issued `{agent, token, expiresAtMs, endpoint}` to `acceptGrant` through
an authenticated channel. Never obtain a grant from a URL, model output, imported
record or localStorage. Acceptance validates the exact origin/path, agent,
expiry, policy, account, chain, epoch and read-only permission scope. It does not
send a request. Invalid replacement preserves an otherwise usable current grant;
valid replacement cancels pending delivery. Expiry or changed scope prevents use.

The optional panel takes `proposalTransport: {origin, enabled, fetchImpl?,
timeoutMs?}` and exposes `acceptProposalGrant(grant)`. It never presents a secret
input or exports the grant. The default panel has no proposal-service controls.
The authenticated host/bootstrap is still a deployment requirement, not supplied
by this browser client. Do not expose a registration endpoint merely to satisfy
the client API.

## Explicit requests and duplicate prevention

The client reserves the active operation before invoking clock or context
validation callbacks. A synchronous reentrant request returns CLIENT_BUSY and
does not consume an attempt. Cancellation, revocation, disposal or grant
replacement during validation prevents the original request from dispatching;
its cleanup cannot clear the replacement operation or its state.

Only `request({requestId, objective})` sends a POST to the fixed same-origin
`/api/agent/proposal`. Browser-generated Origin, omitted cookies, bearer header,
redirect rejection, no-store and no-referrer apply. The body contains only agent,
request ID and objective. No policy, wallet account or API key is submitted.

The panel reuses its previous request ID when the objective has not changed,
including after failure or cancellation. Editing the objective creates a distinct
intent and ID; it does not refund server quotas or establish spending authority.
Request IDs use `crypto.randomUUID()` by default. A synchronous host override is
available for deterministic tests. Async, malformed or reentrantly cancelled ID
callbacks do not send requests.

HTTP 202 shows pending status without automatic polling. Rechecking is explicit.
The server's idempotency cache prevents repeated generation. If a service restart
has lost the response while the durable journal records an attempt, the request
is refused rather than regenerated. This client stores IDs only in memory; it is
not a cross-browser or reload-resilient request ledger. The host must preserve a
durable budget/journal and must not treat a new UI instance as a refund.

## Response and lifecycle defenses

- Bound response bytes to 131,072, validate UTF-8 and strict JSON, and reject
  duplicate keys, extra response fields and capability reflection.
- Re-assess proposal data against current local scope and time; server-provided
  review data does not authorize the proposal.
- Stage a valid proposal only. A separate existing explicit read action is
  required; no connection, signature, transaction or permission grant occurs.
- Bound each attempt by a deadline and AbortSignal. Ignore late responses after
  cancellation, disposal, replacement, expiry or context changes.
- Recheck scope after synchronous delivery and state callbacks, including
  callbacks that revoke or cancel reentrantly.
- Keep old historical results and downloads available after failure. Grant or
  proposal reception does not overwrite a saved observation.
- Keep credentials and arbitrary server/provider errors out of status events.
  The `attempts` state counts reserved local transport attempts, including a
  cancellation before dispatch; it is not proof of billing or a monetary limit.

Late transport completion is owned explicitly: if a transport ignores its abort
signal and returns a response after cancellation, revocation, disposal, grant
replacement or timeout, the response body is cancelled without staging data or
publishing another status. Cleanup errors and rejected/hung cleanup promises do
not restart work, delay the already-settled request, or expose diagnostic prose.
An earlier request's cleanup cannot clear a newer completed request's status.

Adapter exception classification uses private error branding rather than
prototype traversal. A revoked Proxy or throwing prototype trap cannot leave
the published client status stuck requesting. The panel's stop callback is
best-effort and its returned asynchronous rejection is observed without delaying
the stop. Neither recovery path initiates retries or removes historical records.

## Verification boundaries

Unit tests cover all three agents and both chain IDs, hostile responses,
timeouts, scope changes, reentrancy, no automatic polling, duplicate request IDs,
and preservation of historical records. Local HTTP tests exercise the actual
optional panel button, browser client, service, mock model adapter, pinned
synthetic wallet reads and export/disconnected restoration. A Node-only transport
wrapper supplies Origin in those tests; production browser code does not forge it.

The Node DOM and wallet fixtures are synthetic, model transport has no external
network, and HTTP uses ephemeral loopback only. Additional isolated NEC Chrome
runs now cover native DOM/Promise behavior; see
`PROPOSAL_CLIENT_RECOVERY_2026-11-07_EN.md` and
`PROPOSAL_PANEL_STOP_2026-11-07_EN.md` for revision-specific results. Neither kind
of test is active-PC installation, real-chain evidence, live-model authentication,
a financial budget or permission to spend. No `.env.local` content is read.
