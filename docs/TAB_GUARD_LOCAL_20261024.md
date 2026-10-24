# Local wallet protection update — 2026-10-24

This update adds a stop-only notification between compatible ThreeCore Wallet
pages in the same browser origin and storage partition. It also strengthens
cleanup after a stop and protects pages restored from the back-forward cache.

The implementation remains local to the PC. This document is not a deployment
record, a GitHub publication notice, or an independent security audit.

## User operation

The existing **3トークンの接続を停止** button still stops this page.
The new **この画面を停止し、同じアドレスの画面にも通知** button first stops
this page, then sends a short stop notification to compatible pages.

The panel waits for responses for two seconds. The displayed number is the
number of distinct matching responses observed during that window, capped at
32. It is not a count of all open pages and does not prove that every page stopped.

Each receiving page closes its read-access gate, invalidates sensitive backup
views, and disconnects its local DAT, EMA and CAWELON sessions. Completed history
records and saved encrypted backups are retained.

Resuming is an explicit local action. Resume never sends a message, reuses a
previous connection, requests accounts, reads balances, signs, or transfers.
After resuming, connect each desired token again using its existing control.

If cleanup cannot be confirmed, the gate stays closed. A warning explains that
some displayed content may remain, and **表示の消去を再試行** retries cleanup.
Resume remains disabled until a synchronous cleanup attempt succeeds.
If retry still fails, close that page. A late asynchronous success does not
silently change this decision or issue a delayed success response.

## Scope and limitations

- The scheme, hostname and port must match. `localhost` and `127.0.0.1` are
  different origins. Ports 4200 and 4201 are also different origins.
- A different browser, browser profile, storage partition, or older application
  version is outside the notification scope.
- Delivery to closed, discarded, frozen or heavily suspended pages is not
  guaranteed. Responses can also arrive too late to count.
- BroadcastChannel does not authenticate a human, browser tab, or document.
  Any compromised script in the same origin/partition can fabricate a stop or
  matching response. The response count is diagnostic, not an attestation.
- There is no remote resume instruction. Compromising the origin itself remains
  outside the protection provided by this transport.
- The application disconnects its own session and clears its own views. It does
  not lock MetaMask, revoke wallet permissions, cancel an already displayed
  extension prompt, or revoke an on-chain token allowance.
- A stop does not undo a storage transaction that completed before the stop.
  Pending operations that support cancellation are invalidated; their late UI
  results are discarded.
- JavaScript cannot promise physical erasure of all memory copies, native crypto
  buffers or browser-managed snapshots. The application clears references and
  input values and refuses late results; this is not a forensic erasure claim.

## Notification format

The channel name is `threecore-wallet-stop-v1`.
No network request, storage event, service worker, localStorage or IndexedDB is
used as a delivery fallback. The transport opens only after explicit mounting
in a secure context: HTTPS or a browser-approved exact loopback HTTP origin.

A stop has exactly these five fields:

| Field | Meaning |
| --- | --- |
| `schema` | Literal `threecore-tab-stop-v1` |
| `kind` | Literal `stop` |
| `source` | Ephemeral random page identity, 16 bytes as lowercase hex |
| `id` | Ephemeral random request identity, 16 bytes as lowercase hex |
| `issuedAt` | Positive safe-integer epoch milliseconds |

A response has those fields with `kind: receipt`, plus `target`.
Its `id` and `issuedAt` copy the stop, `source` identifies the responder, and
`target` identifies the original sender. A source cannot equal its target.

Messages contain no account, token address, balance, wallet name, passphrase,
backup content, filename, provider exception, or free-form reason.
Page identities are not stored, displayed, or treated as wallet identities.

Validation rejects additional or missing keys, accessors, symbols, inherited
records, malformed identifiers, all-zero identifiers and invalid timestamps.
The accepted record is copied and frozen before interpretation.
Only `crypto.getRandomValues` creates identities; there is no weak fallback.

## Time, replay and resource bounds

| Boundary | Rule |
| --- | --- |
| Stop freshness | Less than 10 seconds old |
| Future tolerance | At most 1 second ahead |
| Replay retention | Through the stop's own expiry time |
| Replay capacity | 128 entries; overflow closes the channel and stops locally |
| Ingress budget | 256 messages per 10-second interval |
| Receipt collection | 2 seconds by default; configurable only within 1–5000 ms |
| Receipt identities | At most 32 per explicit request |
| Clock rollback | Stop locally and close notification processing |

The local resume timestamp is a barrier: stops issued at or before that timestamp
are ignored. Replay entries are kept across resume so queued duplicates cannot
be accepted simply because the page resumed.

Responses must match the current request identity, issue time and target, and
arrive before the deadline. Duplicate responder identities do not add to the
count. Unknown requests, old requests and unsolicited responses are ignored.

The timer checks the actual deadline. An early callback continues waiting;
a late callback completes the window without extending it. Generation checks
make callbacks from cancelled, resumed or disposed requests ineffective.

Malformed messages consume the ingress budget. On budget or replay overflow,
the receiver stops locally and closes the channel rather than evicting live
replay records or silently trusting further messages.

Received stops are never relayed. This prevents a notification echo loop.
Automatic idle, hidden-page, page-exit, freeze and restoration protection remain
local; backgrounding one page does not broadcast a stop to active pages.

## Cleanup ordering and failure handling

`runProtectionBatch` validates and snapshots its bounded list before running it.
The production wallet supplies these steps in order:

1. Clear backup credentials, decrypted candidates and library review views.
2. Invalidate the current period/report view.
3. Disconnect DAT's application session.
4. Disconnect EMA's application session.
5. Disconnect CAWELON's application session.

Every configured step runs even if a prior step throws or returns false.
A promise or thenable does not count as synchronous completion; rejection is
consumed, the step is marked failed, and remaining steps still run.
The result contains only fixed step names and counts, never exception text.

The read-access gate closes before the cleanup callback runs. A peer response
is sent only after the cleanup callback reports synchronous success.
Failed cleanup closes notification processing and sends no success receipt.
Explicit local retry cannot retroactively acknowledge the earlier request.

A repeated stop runs sensitive cleanup even when the gate was already locked.
This clears credentials entered after the first stop. The same rule applies to
freeze, hidden-page, page-exit and persisted pageshow events.

## Lifecycle behavior

Opening the notification channel performs no wallet operation and sends no
message. Unsupported transport does not silently select another communication
mechanism. The current page can still be stopped locally.

Disposal removes listeners, cancels the receipt window, releases replay data,
clears the ephemeral source identity and closes the channel. Queued callbacks
cannot recreate a disposed panel or reopen its read gate.

The browser's `freeze` event protects locally. `pageshow` with `persisted: true`
also protects locally before the user resumes. An ordinary first pageshow does
not lock a newly opened page. These events supplement the existing idle and
pagehide protection; they do not guarantee delivery before an OS crash.

## Verification coverage

- Exact protocol shape, identifiers, timestamp limits and descriptor handling.
- Duplicate messages, delayed messages, future messages and resume barriers.
- Request-bound responses, caps, deadlines, replay overflow and ingress floods.
- Missing/throwing/asynchronous transport capabilities and cleanup callbacks.
- Reentrant faults, observers, disposal and stale scheduler callbacks.
- DAT/EMA/CAWELON balance, allowance, bytecode, block and event reads interrupted
  while pending, including late success and late rejection after local resume.
- Permission prompts and provider account/chain events completing after a stop.
- Real native AES-GCM work completing after cancellation, without releasing its
  result to the stage or download controls.
- Library reviews and in-flight transactions stopped without deleting saved
  ciphertext, plus preservation of commits that already completed.
- Browser-native BroadcastChannel delivery, message cloning and namespace
  separation, with the actual wallet demo and synthetic providers.
- Same-origin server routes, no mutation endpoint, restrictive response headers,
  and complete dependency graph resolution.

The browser fixtures use explicitly synthetic wallets and values. They do not
claim a fresh real-wallet connection test, transaction test or external audit.
Exact pass totals, line changes and local preservation hashes belong in the
adjacent `wallet-tab-guard-verification-20261024` evidence directory.

## Reproduce locally

From this checkout, using Node 22 or newer:

```powershell
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4201'
node examples/dev-server.js --ui-test
```

Open `http://127.0.0.1:4201/test/browser/?suite=tab-guard` for the focused native
tests or `/test/browser/` for the full browser regression suite.
`/test/browser/security-demo/` contains three clearly labelled synthetic wallet
cards for checking stop and explicit reconnect behavior in separate tabs.
Test-only routes are absent when the server starts without `--ui-test`.

## Browser references

- [MDN Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
  describes same-origin/storage-partition delivery and the API's context scope.
- [MDN pageshow event](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event)
  describes the `persisted` indicator used for restored pages.

These references describe browser behavior. They do not certify this wallet.
