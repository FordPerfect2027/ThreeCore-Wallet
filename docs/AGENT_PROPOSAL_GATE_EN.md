# Agent proposals: a read-only foundation, not autonomous production

ThreeCore's product direction is independent DAT, EMA and CAWELON AI decision
makers using assigned wallets within explicit authority. A wallet is an account
and signing boundary, not the intelligence itself. This increment implements a
deterministic policy gate between a possible AI proposal and existing read-only
wallet inspection. The separate server-side adapter below adds bounded model
proposal generation, not strategy execution, revenue generation or buyback/burn.
No market specialization is assigned to an
agent by this change.

## Implemented boundary

`src/agent-read-proposal.js` exports:

- `assessAgentReadProposal(proposalText, policyText, sessionState, nowMs)`:
  pure, bounded JSON review with no wallet/network calls. It returns immutable
  eligibility, not authority. Invalid or unsupported input throws a stable code.
- `inspectAgentReadProposal(session, proposalText, readPolicyText, clock)`:
  explicitly runs the existing `inspectDappSpender` after review, rechecking
  policy, time and session before/after every subread and before returning.
  Session must already be connected. It never requests connection itself.

The proposal includes agent, account, chain, bare origin, connection generation,
policy revision, creation/expiry times, rationale and a structured action. The
policy is separately supplied by the application, **never copied from model
output**. It binds exactly one agent/account/chain/origin to an explicit list of
token/spender pairs and a positive maximum proposal age. Empty targets deny all.
No default production addresses, trusted service list or lifetime is supplied.

Only `inspect-spender` is recognized. It reads bytecode presence, raw balance and
existing allowance at one canonical block. Arbitrary calldata, approvals,
signatures, transfers, swaps, bets, bridges, buybacks and burns are rejected.
An address containing bytecode and a passed review do not establish service
safety, an official partnership or successful operation on that service.

Both Base Mainnet and Base Sepolia IDs can be matched against existing session
configuration. This is not a claim of live-chain validation or support for any
other L2/L3. Time is supplied by the trusted caller, not a trusted timestamp
service. Expiry and clock rollback fail closed. Policy changes, including a
change without a revision bump, invalidate the in-flight result. This does not
undo an already completed read or cancel a provider's in-flight work; remaining
subreads and the result are stopped. Repeated eligible reads are allowed; this
is not transaction replay protection.

The session and callback implementations are trusted application code. This is
not a sandbox for arbitrary JavaScript adapters. Bounded JSON rejects duplicate
keys, unsafe property names, unknown fields and oversized inputs. Session fields
must be own data properties, not accessors. Reason text is never interpreted as
permission or evaluated as code. Async policy/clock callbacks are rejected and
their rejections observed. These guarantees do not authenticate imported policy
or historical observations.

## Reproducible offline integration

```sh
node examples/agent-proposal-simulation.js
node --test test/agent-read-proposal.test.js test/agent-proposal-simulation.test.js
```

The example uses the actual `ThreeCoreWalletSession` class with an in-memory
EIP-1193 fixture provider, three distinct synthetic accounts, a reserved
`.example` origin, synthetic contracts, a fixed clock and a fabricated block.
For each agent it completes a read and rejects a transfer proposal with zero
additional provider calls. Output is JSON, explicitly marked synthetic. It
does not load the user's browser, call RPC endpoints, read private keys, modify
files or send funds. Zero fixture balances are not live observations.

## Application lifecycle

`src/agent-read-policy-registry.js` holds independently reviewed application
configuration, initially empty. DAT, EMA and CAWELON cannot share the same active
account in this registry. Settings have no privileged-operation flags. Each
accepted update or revocation advances a local generation; even revoke/re-add
of identical settings invalidates an old revision. Validation is atomic: an
invalid update leaves active settings untouched. Empty targets deny all reads.
The registry is memory-only, not a durable authorization service or signed
policy store. A process restart requires explicit configuration again; revision
strings alone are not replay protection. This API is application configuration,
not a tool exposed to untrusted models. The offline example now uses it.

`src/agent-proposal-controller.js` provides one independent controller per agent.
Trusted callbacks supply its current session, policy and clock; a proposal
cannot select another agent's controller. It prevents overlapping submissions,
invalidates a read if the session instance is replaced, and suppresses stale
responses after stop/dispose or a newer operation. A notification callback may
stop the operation before its first read. Disposal blocks callback reentry.
Stopping the controller does not change another agent's state or revoke shared
wallet permissions. No implicit reconnection or retry occurs. Successful state
contains the proposal ID, review and block-bound observation; transaction
execution remains false. Provider failure details are not displayed.

## Existing wallet UI integration

`examples/agent-proposal-panel.js` is mounted as a collapsed section inside each
existing wallet card. Nothing connects, registers a policy or reads a balance on
mount. An explicit registration snapshots the card's already-connected identity
and token/spender fields, with a visible 1..600 second proposal lifetime setting.
The 60 second UI default is a development review lifetime, not a spending limit.
Registration does not add wallet permissions. An explicit template button creates
a local verification proposal, conspicuously not described as an AI decision.
Externally supplied proposal JSON is reviewed as untrusted data.

`wallet-card-controller.inspectAgentProposal` runs through the existing card's
protection, cancellation and scoped session machinery. It never exposes the raw
wallet, implicitly reconnects, or introduces a second provider path. The panel
checks current fields and policy again before accepting a delayed result.
Disconnect/account changes, token/spender edits and policy revocation invalidate
the scope. Cancellation settles local waiting without pretending to cancel an
RPC already accepted by an extension. Saved historical evidence remains visible.

Explicit JSON download uses the existing guarded export service and includes
proposal, policy, review and block-bound observation. The file is unauthenticated
historical evidence, not live authority or proof of service safety. The UI tells
the user to verify download completion and does not claim disk persistence from
a button click. These records are not silently added to the existing checkpoint
format; the UI states that limitation. A failed download or cancelled newer read
does not erase the last displayed record.

Node DOM-fixture tests exercise the panel and the actual card/session adapter
with synthetic providers. Two native-browser scenarios were added to the existing
suite, but have not run in this environment because the documented browser
execution permission blocker remains. PC installation has not been performed.

### Historical record recovery and proposal delivery

`src/agent-proposal-record.js` now validates saved UI records with bounded JSON,
exact fields, historical proposal/policy consistency, review reconstruction,
account/chain/epoch/target alignment, uint256 quantities and block context.
Missing token code keeps amounts unknown rather than replacing them with zero.
Duplicate keys, foreign-agent records and inconsistent execution/audit flags are
rejected. Validation is entirely local and **does not authenticate a record**:
internally consistent fabricated balances can pass and remain explicitly labelled
unauthenticated historical observations.

The panel accepts an explicit JSON File through the page's budgeted file reader.
It previews before replacing the displayed result. Failure, cancellation and
late replies preserve the earlier record. Restoring does not change the current
wallet, active policy or proposal draft and never performs RPC. A disconnected
fresh panel can display and re-export old evidence without reviving permissions.
This is file-based recovery, not automatic persistence or checkpoint integration.

The application-owned `stageProposal(text)` hook validates current scope and
expiry, then fills the proposal draft without executing it. It rejects delivery
during another read/import and rejects stale model replies. It cannot apply a
model-provided policy or renew a proposal's expiry. The mock server adapter is
tested through this hook for DAT, EMA and CAWELON. A live authenticated server/UI
bridge remains a separate deployment requirement.

A native-browser File recovery scenario was added but has not been executed in
the restricted browser environment. Native Node File streams and the production
file-read service are exercised separately; those do not substitute for browser
acceptance.

## Remaining boundaries

Live model inference and service-specific research adapters need their own
verified configuration.
Any future privileged execution needs separate authorization, key isolation,
transaction simulation, spending limits, replay controls and acceptance tests.
Passing this module's tests alone is not 90% product completion.

## Server-side model adapter continuation

`server/openai-read-proposer.mjs` now implements optional, bounded model selection
of a read-only target. See `OPENAI_READ_PROPOSER_EN.md` for configuration, cost and
acceptance boundaries. It is not exposed to the demo browser and has not made a
live model call. The default-disabled implementation has synthetic transport,
policy revocation, cancellation and independent-agent integration coverage.
