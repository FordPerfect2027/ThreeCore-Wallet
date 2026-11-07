# Caller-owned proposal composition for the wallet demo

`mountWalletDemo` in `examples/wallet-demo.js` can optionally connect the normal
proposal panels to the existing same-origin proposal client. The caller retains
the returned application handle and explicitly supplies each agent's capability.
Mounting, reading a context, accepting a capability, and revoking a local
capability do not send proposal requests or perform wallet reads.

This is an application composition seam. It does not implement identity
authentication, a login session, a browser registration route, or capability
delivery over HTTP. The ordinary `examples/wallet-entry.js`
does not enable proposal transport or publish its application handle globally.

## Optional mount configuration

The other `mountWalletDemo` dependencies retain their existing behavior. Its new
`proposalTransport` option defaults to `null`:

```js
const app = mountWalletDemo({
  document,
  eventTarget: window,
  siteOrigin: location.origin,
  getLegacyProvider: () => window.ethereum,
  proposalTransport: {
    origin: location.origin,
    enabled: true,
  },
});
```

This example creates an unavailable proposal client until a trusted caller
delivers a valid grant. It does not register a server session, acquire a grant,
connect a wallet, select a policy, or activate a model.

| Field | Contract |
| --- | --- |
| `proposalTransport` | `null` or an own-data record with exactly the supported fields below. Omission or `undefined` uses the `null` default. |
| `origin` | Required when the record is present. Must exactly equal the validated `siteOrigin`, without a trailing slash or URL path. The existing origin validator permits HTTPS origins and HTTP `localhost` / `127.0.0.1` origins. |
| `enabled` | Optional boolean, default `false`. A configuration record with transport disabled shows unavailable controls but cannot accept a grant or send a request. |
| `fetchImpl` | Optional function, defaulting through the existing client to native `fetch`. This is an explicit trusted dependency, useful for controlled tests. |
| `timeoutMs` | Optional safe integer from 1 through 60,000. The existing client default is 15,000 milliseconds. |

The configuration must have a plain or null prototype and own data properties;
accessor properties, unknown fields, arrays, and malformed values are rejected.
The supported values are captured and frozen before document access or export
resource setup. Later mutation of the caller's configuration cannot retarget the
client or replace its captured transport function. Invalid configuration throws
an error with the fixed code and message `INVALID_PROPOSAL_TRANSPORT`.

The endpoint is fixed by the existing client to
`origin + "/api/agent/proposal"`. There is no configurable registration endpoint,
capability field, credential forwarding setting, or cross-origin fallback in
this mount configuration. Native requests retain the client's
`credentials: "omit"` and `referrerPolicy: "no-referrer"` behavior.

## Application handle

The returned handle is frozen. It exposes only `readProposalContext`,
`acceptProposalGrant`, `revokeProposalGrant`, and `dispose`. The agent argument
must be exactly `"DAT"`, `"EMA"`, or `"CAWELON"`; there is no case conversion or
fallback agent. Invalid agents return `null` or `false` before grant input is
examined. The handle exposes no controller, policy registry, provider, or stored
grant.

### `app.readProposalContext(agent)`

Returns `null` unless the current card has an eligible connected read-only
session, an explicitly registered read policy, matching configured target
addresses, and an open application security gate. It also refuses an invalidated,
changing, or disposed context. When valid, its result has exactly this shape:

```js
{
  policyText,  // Exact current serialized policy, including its local revision.
  sessionState: {
    agent, account, chainId, siteOrigin, connected, connectionEpoch,
    canSign, canSendTransactions, canBridge,
  },
}
```

Both objects are frozen copies. The three capability flags must be `false`.
The panel captures and validates context and policy before publication, then
rechecks them for invalidation or callback reentry. Reading the snapshot does not
connect a wallet, set a policy, stage a proposal, or execute a read. A valid local
context may be inspected even when optional transport is disabled.

Use the exact policy text when coordinating an independently authorized binding:
the registry's revision reflects its local generation, so rebuilding an identical
configuration elsewhere does not reproduce that revision. A returned snapshot
is only a point-in-time copy and does not update after settings or connection
changes.

**This context is not authentication.** Browser-selected public addresses, a
policy revision, a connection epoch, and read-only flags do not establish who the
caller is or what a server should authorize. The server owner still needs an
independent identity/session and scope policy before calling its private
registration API. Passing an unverified browser snapshot directly into server
registration is not a substitute for that policy.

### `app.acceptProposalGrant(agent, grant)`

Passes a grant to that agent's existing proposal client and returns a boolean.
The client validates the exact own-data grant fields `agent`, `token`,
`expiresAtMs`, and `endpoint`, including the matching agent, same-origin fixed
endpoint, bounded expiry, and current context binding. No grant is returned.

Grant delivery must be an explicit operation by the trusted caller that already
owns the application handle and has a separately authorized server capability.
This module supplies no delivery channel. Do not put grants in public assets,
URLs, logs, imported records, model output, or persistent browser storage.

Acceptance is passive: it does not send an HTTP request, ask for wallet
permission, or execute a proposal. A `false` result means the grant was not
accepted. Disabled transport, an invalid agent, a closed security gate, or a
disposed application returns `false`. Invalid grant data rejected before a
replacement preserves the previously accepted client binding; normal expiry,
context changes, cancellation, and disposal still enforce their own gates.

### `app.revokeProposalGrant(agent)`

Revokes only the selected agent's local proposal client and aborts its pending
proposal delivery. It preserves the card's local read policy, current draft,
recorded observation history, and other agents' clients. A late response from
the revoked operation cannot stage a new draft.

The method returns `true` when a live optional client accepts the local revoke,
including when it had no grant. It returns `false` for an invalid agent, a card
without an optional client, or a disposed application. Local revocation is
available for cleanup even when the application's security gate is closed.

**Local revocation does not revoke the server capability.** The trusted owner
must separately call the host's private `revoke` operation when it intends to
withdraw server authorization. There is no automatic HTTP revoke request or
browser registration/revocation endpoint. Conversely, a server rejection does
not silently rewrite the user's local read policy.

## Explicit request and read actions

After capability acceptance, the user still enters an objective and presses the
proposal request button. A valid response is checked and placed in the matching
agent's proposal draft. Staging performs no wallet RPC.

The user must separately press the panel's inspect/read button to validate the
proposal against the current policy and session and perform the existing
read-only inspection. The inspection uses the established block-hash pinning
and canonical-height recheck. It does not sign, send transactions, approve
tokens, bridge, or execute arbitrary model instructions.

Existing field, policy, connection, and protection invalidations remain active.
Changing a bound setting or losing a connection invalidates the relevant
capability and prevents delayed delivery. Historical observations remain records
of previous reads; neither a local grant revoke nor a new proposal turns them
into current state or authentication evidence. Loading historical records does
not restore grants, current policy, or wallet authority.

## Disposal and persistence

`app.dispose()` closes all three public hooks before invoking cleanup callbacks.
It then attempts each owned cleanup, so a failure in one injected cleanup cannot
skip the remaining proposal clients, controllers, listeners, and DOM cleanup.
Security-panel disposal likewise attempts its listener, lock, tab-guard, and
journal cleanup independently. Repeated disposal is inert, and delayed proposal
responses cannot restore the application or stage into an old draft.

Capabilities remain memory-only. There is no grant persistence, automatic grant
restore, reconnect, or renewal on reload. Local UI records retain their existing
explicit import/export behavior; keeping a record on screen does not mean a file
was saved. Disposal removes the mounted UI and does not constitute a saved
backup.

## Validation scope

The focused tests use the actual normal demo, panel, client, session and read
logic with a synthetic DOM, synthetic EIP-1193 providers, and injected proposal
responses. They check three-agent isolation, passive delivery, a separate pinned
read, immutable context, invalid grant handling, cancellation, preserved records,
and disposal reentry. These tests do not establish native-browser behavior, real
wallet ownership, real host authentication, or live model behavior.

For the server composition and its limits, see
[`PROPOSAL_HTTP_HOST_EN.md`](PROPOSAL_HTTP_HOST_EN.md). No real-account prerequisite
is needed to develop or test this caller-owned seam with isolated synthetic
inputs.
