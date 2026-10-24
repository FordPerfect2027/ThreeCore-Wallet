# Local wallet security hardening — 2026-10-24

This change adds protection around ThreeCore's existing read-only wallet
connections, imported files and local development server. It does not introduce
signing, transfers, token approvals, key custody or a new deployed service.

Development took place in a separate PC-local checkout. The previous checkout
and its history were preserved. No GitHub push is part of this change.

## What a user can do

The main wallet screen now contains a protection panel:

1. Press **3トークンの接続を停止** to stop all three wallet connections.
2. The live balance results are cleared and connection controls are disabled.
3. Press **接続操作を再開する** to allow connection actions again.
4. Connect each required token explicitly. Resume never reconnects automatically.
5. Select a 1-, 5- or 15-minute idle timeout. The initial value is 5 minutes.
6. Tab/page hiding also stops the connections by default.

Saved local history remains available. The stop control is a page-local access
gate. It does not lock a wallet extension, remove its website permission, cancel
its already open permission prompt, or erase local files.

The protection history shows stop reasons and configuration changes. It retains
at most 64 events in memory, displays the latest eight and reports eviction.
Aggregate event counts remain available for the current page session.

**保護の記録を表示** prepares a text report for inspection. It contains neither
wallet addresses nor balances, provider payloads, private keys or seed phrases.
There is no automatic upload, clipboard write, storage or download. A new event
invalidates the displayed report. Reloading the page starts a new history.

The history is a local diagnostic aid, not an authenticated audit log.

## Threats addressed

| Boundary | Example problem | New handling |
| --- | --- | --- |
| Imported JSON | Duplicate members hide a discarded value from a checksum | Scan the original text and reject duplicates before parsing |
| Escaped JSON names | Literal and escaped names identify the same member | Compare decoded member names |
| Input resources | Deep or extremely large structures monopolize processing | Byte, depth, member/string/number and node limits |
| Native File reads | Oversized/truncated data, invalid UTF-8, hanging reader | Streaming checks, exact size, fatal decoding, deadline and cancellation |
| RPC request | Accidental arbitrary signing or write method | Explicit read-method and argument allowlist |
| RPC response | Oversized values or accessor-backed response objects | Bound and snapshot response fields before semantic decoding |
| Provider replacement | A later request-property replacement changes transport | Capture the validated function once and retain its original receiver |
| Provider failure | Error text asks for secrets or exposes provider data | Static messages with recognized codes; discard raw prose and data |
| Unattended page | Existing connection remains usable after inactivity | Idle/page exit gate plus explicit resume and reconnect |
| Delayed result | Old completion restores results after stopping | Gate and existing session-generation checks discard stale results |
| Discovery spam | Endless wallet announcements grow the selector | Maximum 32 discoveries and sanitized display names |
| Local server | Foreign origins, rebinding Host or embedding reach local pages | Exact loopback Host/Origin, Fetch Metadata and framing restrictions |
| Script injection | Inline executable strings run in the local page | Enforcing CSP with self-only scripts and no eval |

## JSON validation

The scanner validates the complete JSON grammar and then uses native JSON.parse.
Existing schema, field, checksum and domain validators remain in place.

The default upper bounds are:

- 96 MiB of UTF-8 text; individual formats retain their smaller limits.
- Nesting depth 64.
- 1,000,000 values.
- 256 decoded characters per member name.
- 32 MiB-equivalent character bound per string.
- 128 characters per numeric token, with finite numeric results.

Prototype-related **member names** are rejected. Text values containing those
words are allowed. Errors contain static codes, not snippets of imported content.

This change applies to 20 existing import modules, including portfolio/history,
workspace, setup, checkpoint, identity, allowance, transfers, period reports,
report history and report sets. Internally produced JSON clone operations are
unchanged.

Checksums still detect accidental modification of canonical content. They are
not signatures and do not establish who created a file.

## Native File handling

Eight current file readers use the shared streaming boundary: transfers, vaults,
reconciliation, periods, period libraries, period reports, report history and
report sets.

Actual bytes must match the captured declared size. A stream is stopped before
decoding bytes beyond the permitted size. UTF-8 decoding is fatal, including
invalid sequences split across chunks. BOM handling retains existing behavior.

The default deadline is 30 seconds. Abort and timeout settle the local operation
and consume late outcomes. A broken stream cannot silently switch to the
arrayBuffer fallback. Cleanup failure cannot turn rejection into acceptance.

The arrayBuffer fallback supports older File-like adapters. Such an adapter
controls its own allocation; the application cannot prevent memory allocation
inside a malicious adapter before its promise resolves. Native File.stream is
preferred. Synchronous JSON work is bounded but is not interruptible mid-parse.

## RPC capability and response rules

The read boundary accepts chain ID, exposed accounts, balances, contract code,
block headers, fixed ERC-20 view selectors and account-scoped Transfer queries.
An explicit connection flow may separately request account permission.

There is no arbitrary passthrough. Signing, sending, approve/transfer/permit
selectors, chain switching and permission revocation are outside this boundary.

Read selectors include token name, symbol, decimals, total supply, balanceOf and
allowance. The owner of balance/allowance reads must be the expected account.
Transfer filters must use the configured token and expected account direction.
Hash-based state reads require canonical blocks.

At most 32 requests can be waiting in one session. Response bounds include 128
accounts, 128 KiB of bytecode, bounded hexadecimal values and 500 Transfer logs.
Domain decoders continue checking addresses, encodings, hashes, ranges and log
semantics. The existing over-limit Transfer error remains in effect.

Snapshotting avoids invoking ordinary response accessors. This is not a sandbox
against an actively malicious same-page extension or Proxy trap. Injected
JavaScript can already operate in that page's environment.

## Access gate behavior

The gate closes before cleanup callbacks and observers run. Permission requests
already in progress cannot be canceled through EIP-1193; the existing shared
pending-permission guard avoids starting duplicate prompts.

Clock rollback/failure closes access. A delayed timer or an action after an
expired interval cannot renew the connection. Only trusted user pointer/key
events refresh activity. Explicit resume allows a new Connect action.

Settings and protection history are intentionally page-local. Reloading does
not restore a previously connected session or persist a protection log.

## Local server restrictions

The example server remains bound to 127.0.0.1. It serves only a fixed file
allowlist. Development test pages are served only with --ui-test.

Allowed Host values are localhost/loopback with the actual listening port.
An Origin header, when present, must exactly match that origin. Foreign
Sec-Fetch-Site values and iframe/object/embed destinations are refused.
Malformed and excessive request targets receive controlled errors.

Security headers cover successful, refused and missing routes:

- Content-Security-Policy.
- X-Content-Type-Options: nosniff.
- X-Frame-Options: DENY.
- Referrer-Policy: no-referrer.
- Cross-Origin-Resource-Policy: same-origin.
- Permissions-Policy restrictions on device/media capabilities.
- Cache-Control: no-store.

Inline styles remain enabled for compatibility with existing presentation
styles. Inline scripts, event-handler strings and dynamic evaluation are not.
Requests and module imports are restricted to the same origin.

These browser protections are not authentication. A native local process can
forge HTTP headers. No production hosting or HTTPS configuration was changed.

## Verification

Final verified local results for this source snapshot:

| Suite | Passed | Failed | Canceled |
| --- | ---: | ---: | ---: |
| Unit tests | 6,651 | 0 | 0 |
| Local HTTP integration | 140 | 0 | 0 |
| Native browser UI | 482 | 0 | 0 |
| Total | 7,273 | 0 | 0 |

The prior snapshot had 6,688 cases across the same three suite groups. This
update adds 585 cases. Repeated and focused test runs are not added to the total.
The native browser suite also reported zero unexpected browser errors.

Manual synthetic-provider checks verified separate DAT/EMA/CAWELON connections,
read-only balance display, clearing all three on Stop, no extra provider request
on Resume and idle termination after selecting one minute. No real funds were used.

Security-focused tests cover parsing ambiguity, resource bounds, accessors,
UTF-8 boundaries, cancellation, permission races, delayed results, provider
replacement, discovery floods and three-token isolation.

Regression testing includes the existing unit tests, HTTP integration tests
and the native browser UI suite. The largest 6,000-event fixture needs the
normal 60-second test deadline on this PC; a shorter 20-second exploratory
deadline was insufficient and is not used as the final result.

Browser checks exercise the actual CSP, native File/DataTransfer behavior,
one-click stop, resume without reconnection, journal invalidation and DOM cleanup.
The standalone security preview uses clearly marked synthetic wallet providers.
No real wallet signatures, transactions or approvals are made.

Run local checks from the repository root:

    node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
    node --test --test-timeout=60000 --test-concurrency=2 integration/*server.test.mjs

Start the optional local browser test server:

    node examples/dev-server.js --ui-test

Then open /test/browser/ for the suite and /test/browser/security-demo/ for
the synthetic preview. Set THREECORE_DEMO_PORT if the default port is busy.

Final counts, line statistics, screenshots and backup hashes are recorded in
the sibling wallet-security-verification-20261024 evidence directory.

## Review limits and follow-up

This is an engineering hardening change, not an independent security audit.
It does not establish that a token contract, RPC source or wallet extension
is trustworthy, nor prove a reported balance independently.

Backup JSON remains unencrypted. Existing saved history remains readable to
software with access to the browser profile or PC. OS security, browser and
extension updates, encrypted storage and production deployment configuration
remain separate responsibilities.

Existing token integration tests that require a compiled token-contract
repository are separate from the wallet server tests. No dependencies were
installed into those repositories and no token contract was modified.

Protocol references:

- EIP-1193 provider API: https://eips.ethereum.org/EIPS/eip-1193
- Browser CSP guidance: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP
