# Bounded token transfer history

This local development feature adds read-only Transfer-event observations to the
DAT, EMA and CAWELON Wallet cards. It uses the existing EIP-1193 session and the
registered token catalog for Base Mainnet and Base Sepolia. There is no signer,
transaction sender, approval flow, swap, bridge or automatic network switch.

## Using the screen

1. Select the intended token card, chain and public account, then explicitly
   connect the Wallet with the existing connection button.
2. Open the transfer section. Leave the end block empty to resolve the latest
   mined block when Read is pressed. Enter a fixed start/end pair, or select a
   recent block count. The default is 250 blocks and the maximum is 2,000.
3. Press **送受信履歴を取得**. The range, account and token are displayed with the
   returned events. A failed query is an error, not a zero-event result.
4. Search by public address, transaction hash or block number. Direction filters
   distinguish incoming, outgoing, self-transfer, mint and burn events.
5. Save JSON to preserve a record. CSV contains exact base-unit amounts and a
   human-readable decimal amount; spreadsheets may round long numeric cells,
   so JSON/base-unit strings remain the authoritative local representation.
6. Reopen JSON, review its account/range, then apply it to the display. Imported
   data is labeled historical and does not reconnect a Wallet or modify forms.

The pin, previous-window, narrow-window and latest-window buttons only edit the
range draft. They do not issue RPC requests. The displayed summary continues to
state the range of the existing record until another successful read completes.

## What a read verifies

- A connected, read-only session is required; account, chain, agent, origin and
  connection epoch are checked throughout the operation.
- `eth_getLogs` receives a fixed ERC-20 Transfer signature, registered contract
  address and the connected account's indexed sender/recipient topic. Callers
  cannot provide arbitrary filters, contracts or RPC methods.
- Outgoing and incoming queries must both succeed. Responses with removed,
  pending, unrelated, malformed or contradictory events are rejected.
- Name, symbol and decimals are checked against the catalog. Contract bytecode
  and metadata reads use the selected end block's hash with `requireCanonical`.
- Event hashes are compared with their block headers. Range boundaries are
  checked again after all reads. Identical self-transfers returned by both
  queries are counted once. Duplicate rows within a single response fail.
- Block/log positions and transaction slots must be internally consistent.
- Cancellation, timeout or changed context prevents later results from replacing
  the current view. There is no transparent retry to a different provider.

This does **not** prove that a provider returned every relevant event. Headers
and logs come from the same provider. It is not a full-chain indexer, independent
consensus check, finality guarantee, accounting statement or security audit.
An empty response cannot independently establish that no activity occurred.

Event sums cover only observed events in the requested range. They are not the
Wallet balance or investment profit/loss. Self-transfers are excluded from net
movement; mint and burn events remain separately labeled. Amounts use BigInt
and decimal strings rather than floating-point arithmetic.

## Limits and failure behavior

| Item | Bound |
| --- | --- |
| One requested window | 1–2,000 blocks, inclusive |
| Each directional RPC result | 500 events |
| Unique events in one observation | 500 |
| Distinct event block headers | 100 |
| Default overall observation deadline | 60 seconds |
| Configurable observation deadline | 1–120,000 milliseconds |
| Single JSON file | 512 KiB |
| Archive | 1–12 original observations |
| Archive JSON file | 6 MiB |

If the provider refuses log queries, the range is too wide, limits are exceeded,
or any required read fails, nothing is presented as a completed partial result.
Choose a narrower range and read again. Local cancellation cannot cancel an
RPC already sent to a provider; it discards that reply and stops further work.

## Comparison and archives

Two records can be compared only for the same account, agent, chain, contract and
exact block range. The view separates added, missing and changed events and also
reports boundary-hash and metadata differences. Such differences are observations;
they do not prove actual new transfers, malicious behavior or a chain reorganization.

The archive shelf retains up to 12 original records. It summarizes queried block
intervals and gaps between them without constructing a fictitious single snapshot.
Overlapping records must agree on events in their intersection. Inconsistent block
hashes, changed event identities and duplicate ranges are rejected atomically.
Existing shelf contents remain intact when an addition or import fails.

The shelf is **in memory** until its JSON download button is used. Refreshing or
closing the page discards unsaved shelf contents. Removing a shelf entry or clearing
the view does not delete previously downloaded files. Archive imports require a
preview before replacing the in-memory shelf. They do not merge silently.

Transfer observations and archives are separate files; the older workspace and
IndexedDB checkpoint formats have not been extended to include these new records.
Use the transfer JSON or archive JSON buttons to preserve transfer history.

## File privacy and verification

Files contain unencrypted public addresses, contract addresses, event amounts and
transaction hashes. They contain no private keys, seed phrases, Wallet connection
permission or authorization to spend funds. Review recipients before sharing.

SHA-256 covers a validated canonical representation. Whitespace, object ordering
and normalized address casing do not represent semantic changes. The checksum
detects accidental changes, not authorship: anyone can invent a record and recompute
its digest. Import never changes `completeHistory: false` or grants trust to a file.
Extra fields, incompatible schemas, invalid UTF-8, oversized files and checksum
mismatches are rejected. File contents are rendered as text, never HTML.

## Offline inspection

These commands read local files and perform no network/Wallet requests or writes:

```powershell
npm run transfers:check -- "C:\path\transfer-record.json"
npm run transfers:check -- "C:\path\new.json" --baseline "C:\path\old.json" --json
npm run transfers:check -- "C:\path\transfer-archive.json" --archive --json
```

The CLI uses a bounded read from one open file handle and validates the actual
byte count as well as the declared file size. Successful JSON output explicitly
reports zero network requests, Wallet requests and file modifications.

## Verification routes

```powershell
node --test test/*.test.js
node --test integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4190'
node examples/dev-server.js --ui-test
```

- `/` is the normal development Wallet interface; connection requires user action.
- `/test/browser/` runs the full synthetic browser suite.
- `/test/browser/?suite=transfer` runs the transfer browser cases.
- `/test/browser/transfer-demo/` provides an interactive synthetic preview with
  clearly labeled mock data and CSP `connect-src 'none'`.

Test-only routes and fixtures are absent without `--ui-test`. The normal demo does
not import synthetic providers. The server binds to `127.0.0.1` and exposes an exact
GET allowlist; it does not expose source directories, Git metadata or upload APIs.

`integration/token-compatibility.test.mjs` remains a separate local-EVM harness
that must run from a compiled DAT/EMA/CAWELON token checkout. It is not an HTTP test
and cannot be run by globbing all integration files from the Wallet directory.
No real Wallet or live-chain end-to-end test of the new history reader is claimed
by the synthetic suites. Recheck that capability with an explicitly connected
Wallet before describing it as tested on a real Wallet.
