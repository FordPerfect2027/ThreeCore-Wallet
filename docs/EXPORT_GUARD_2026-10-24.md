# Local wallet export protection

This change hardens the final handoff of generated wallet files to the browser.
It is a local development change. It does not publish code, upload exports,
contact a wallet, submit transactions, or change existing saved data.

## Application behavior

All twelve previous Blob URL allocation sites now use one document-scoped
download manager. History, settings, workspace backup, token identity,
allowances, transfers, vaults, reconciliation, periods and reports share it.
Panels that already use the history download helper inherit the same boundary.

The normal wallet screen includes a Japanese status panel. It shows aggregate
counts and reserved input bytes, with controls to clear temporary resources
and retry cleanup. It never renders an export's filename, text, address,
object URL, password, checksum or native browser exception.

The ordinary security stop runs export cleanup before file-read cancellation,
backup cleanup, period invalidation and the DAT, EMA and CAWELON disconnects.
Each operation is still attempted if an earlier cleanup fails. Unconfirmed
cleanup prevents the security panel from reporting a successful cleanup or
re-enabling connection operations. Its existing explicit retry runs the batch
again. Clearing export resources does not delete files already saved on disk.

## Accepted transport input

`inspectExportPayload` snapshots only own data properties. Required fields are
primitive `text`, `filename` and `mimeType`; optional `byteLength` must equal the
actual UTF-8 byte count. Unrelated metadata is not copied or evaluated.
Ordinary and null-prototype records are accepted. Getters, inherited transport
fields, revoked proxies and coercion-dependent values are rejected.

Names consist of an ASCII alphanumeric stem followed by letters, digits,
hyphens or underscores, with one approved extension. Names are at most 180
characters. Paths, separators, additional dots, device names, control codes,
Unicode direction changes and executable extensions are not accepted.

| Extension | Canonical MIME type |
| --- | --- |
| json | application/json;charset=utf-8 |
| csv | text/csv;charset=utf-8 |
| txt | text/plain;charset=utf-8 |
| html | text/html;charset=utf-8 |

The matching MIME without a charset or with a single space before `charset`
is normalized to the canonical type. A mismatched extension and MIME is refused.
The content itself is not rewritten. BOMs and CSV line endings remain bytes of
the original generated file. Invalid raw UTF-16 surrogate sequences are refused
instead of allowing the Blob constructor to replace them silently.

## Fixed resource limits

| Limit | Value |
| --- | --- |
| One generated file | 96 MiB of UTF-8 input |
| Aggregate reserved input | 128 MiB per document |
| Active or cleanup-pending resources | 4 per document |
| Normal retention after admission | 1,000 milliseconds |
| Status observers | 32 per manager |

The byte limit is an admission budget, not a measurement of total browser memory.
The browser may maintain its own copies and buffers. Full budgets reject before
inspecting another input. There is no waiting queue, automatic retry or eviction
of an earlier export to make space for a later one.

## Resource ownership and failure handling

The manager reserves capacity before creating its resource adapter. The adapter
does not allocate until synchronous activation. Its release function is captured
before activation is read, so a broken activation getter cannot bypass cleanup.
The adapter captures browser methods and uses the document's HTTP(S) origin.
Only a same-origin `blob:` URL with an opaque bounded identifier is accepted.

The hidden anchor has `noopener noreferrer` and `no-referrer`, receives a fixed
download name, is clicked once, and is removed. Its URL is normally retained
until the deadline so the browser can consume the handoff. Clearing resources,
page exit, page restoration and app disposal also trigger cleanup.

DOM removal and URL revocation are attempted independently. A failed removal
must not skip revocation; failed revocation must not leave the DOM unexamined.
If either cannot be confirmed synchronously, the resource retains its quota and
new offers stop. Explicit retry targets pending cleanup only. Disposal does not
hide a remaining cleanup problem or prevent a later cleanup attempt.

Reentrant cleanup during `append` can remove an anchor before the append call
returns and attaches that same node. The adapter therefore retains the node
until activation unwinds, then removes it again. The manager also retains the
reservation until that stack unwinds. Cleanup callbacks cannot replace a stopped
download by reentering admission while a clear operation is in progress.

Timer versions make cancelled and superseded callbacks inert. Early timers are
rearmed for the remaining interval. A backward, invalid or throwing monotonic
clock fails closed, clears existing resources and prevents further admission.
Promise-returning activation, release or scheduling is not counted as synchronous
success. Rejections are consumed without publishing their contents.

## Verification

The new unit coverage exercises payload boundaries, exact UTF-8 accounting,
shared budgets, deadlines, reentrancy, independent cleanup failures, recovery,
observer behavior, safe diagnostics and document lifecycle events. Deterministic
command traces compare live resources and their bytes against manager accounting.

Compatibility tests use the existing DAT, EMA and CAWELON generators and compare
the actual Blob bytes with generated text. Real WebCrypto encrypted workspace
files remain decryptable after transport; encrypted libraries and checkpoint
collections retain their original contents. No real wallet credentials are used.

Browser tests use the real DOM and synthetic resources. One case exercises
native Blob/object-URL allocation with a controlled click that does not navigate
or save a file. The manual demo is only served in explicit `--ui-test` mode.
HTTP regression checks keep production paths allowlisted, reject foreign origins
and fetch contexts, and expose no upload, download, filesystem or status API.

Test commands:

```text
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-reporter=tap --test-concurrency=2 integration/*server.test.mjs
```

The integrated browser suite is `/test/browser/` on the local `--ui-test` server.
The synthetic demonstration is `/test/browser/export-guard-demo/`.

## Boundaries of the result

An offered receipt means the browser handoff ran; it explicitly contains
`downloadComplete: false`. Browser acceptance, persistence to disk and filesystem
permissions are not observed. A cleanup confirmation does not prove that the
browser, operating system or another application erased every copy of the data.

This manager is a final resource/transport boundary. Existing schema validators,
CSV escaping, HTML report escaping/CSP and encryption retain responsibility for
their own content formats. The manager does not certify arbitrary HTML as safe,
authenticate wallet ownership or repair an already compromised JavaScript realm.
Browser adapters and injected callbacks are trusted implementation dependencies.
Any adapter that allocates something and throws before returning its handle must
clean that unobservable allocation itself.

No independent security audit or production-readiness claim is made. Real-wallet
operation, cross-browser native download completion and external audit remain
separate verification tasks.
