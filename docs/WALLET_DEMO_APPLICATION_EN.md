# Normal wallet demo on the owned application host

`server/wallet-demo-assets.mjs` composes the existing normal wallet demonstration
with `createProposalApplicationHost`. It captures a coded public asset list
before creating the inert host. Calling `start()` is still a separate action,
and the host remains disabled by default. Importing this module does not open a
listener, create a service, load environment files, issue a grant or contact a
wallet or model.

The normal `examples/wallet-entry.js` mounts the wallet demo
with the current browser origin and explicit wallet selection/connection. It
does not enable proposal transport or accept a grant. This composition provides
the ordinary wallet screen on the owned listener; production authentication and
private capability delivery remain separate application responsibilities.

The standalone development server retains its existing read-only Base Mainnet
relay. It enables that adapter in its root document. The application host
serves the same entry with the adapter disabled and leaves reads with the
connected wallet provider. Proposal transport remains explicitly enabled by
the caller.

## Fixed public files and capture

The exported `WALLET_DEMO_ASSET_FILES` is a frozen array of frozen descriptors
with `path`, `file` and `contentType` string fields. Its paths are coded in this
module, not discovered by walking a directory or supplied by an HTTP request.
The existing demo server shares this normal allowlist; its separately gated
`--ui-test` routes remain outside the application-host capture.

`await captureWalletDemoPublicAssets()` returns frozen
`{path, contentType, body}` records. The method takes no filesystem root or asset
override. It opens only the coded normal files, requires regular files, limits
each read to the observed size plus one byte, detects growth/truncation during
that read, and decodes UTF-8 with fatal error handling. Every handle is closed.
Unreadable, missing, invalid UTF-8 or oversized content fails with the fixed code
`WALLET_DEMO_ASSET_UNAVAILABLE`; raw filesystem diagnostics are not returned.

| Bound | Value |
| --- | --- |
| Public records | 1–256 |
| One captured file | At most 131,072 bytes |
| Combined captured UTF-8 content | At most 4,194,304 bytes |
| Public MIME types | `text/html;charset=utf-8`, `text/javascript;charset=utf-8`, `text/css;charset=utf-8` |
| Path contract | The existing application's exact public paths, also validated by the owned host |

Capture occurs on each explicit construction. Once constructed, the application
host serves its in-memory snapshot, with no request-time filesystem lookup or
fallback. Changes to files on disk do not silently change that instance. A new
instance requires a new explicit construction/start. The checkout containing
these public application files is trusted server-owned code; its files must not
contain secrets or per-user records. The loader is not a sandbox for hostile
filesystem writers.

The four existing inline style blocks have been moved into
`examples/wallet-demo.css`, in their original order. Its single stylesheet link
occupies the first former block's position: after `security.css` and
`secure-backup.css`, before the reconciliation/period/report stylesheets. The
strict application-host CSP remains unchanged, with external scripts/styles
from self only and no inline-style or unsafe-eval exception.

## Construction and explicit start

```js
import { createWalletDemoApplicationHost } from "./server/wallet-demo-assets.mjs";
import { createAgentProposalService } from "./server/agent-proposal-service.mjs";

const host = await createWalletDemoApplicationHost({
  enabled: true,
  port: 0,
  // Ordinary wallet UI only: proposal generation remains disabled.
  createService: ({ origin }) => createAgentProposalService({ origin, enabled: false }),
});
const { origin } = await host.start();
console.log(origin);
// The owning process later calls await host.close().
```

`createService` is required and must return the existing synchronous service
contract (`handle`, `register`, `revoke`, `dispose`). It is called only after a
successful explicit bind. No default service, adapter, model, API key or journal
is created by the wrapper.

Only these host options are accepted:

| Option | Contract |
| --- | --- |
| `createService` | Required application-owned synchronous factory |
| `enabled` | Defaults to `false`; `start()` refuses while disabled |
| `port` | Defaults to `0`, choosing an unused ephemeral loopback port |
| `maxConnections` | Existing host option; default 16 |
| `maxConcurrentRequests` | Existing host option; default six |
| `requestTimeoutMs` | Existing host option; default 35,000 ms |

Own-data options are captured synchronously before the first filesystem await.
Changing the caller's options object afterward cannot replace the factory,
change the port or enable the pending host. Accessors, unexpected keys such as
`root`, `publicAssets` or `uiTest`, invalid record shapes and a missing factory
reject the Promise with `INVALID_WALLET_DEMO_CONFIG`. The existing host retains
its numeric/type validation and `INVALID_HTTP_HOST_CONFIG` errors.

The returned object is the existing owned host interface: `start`, private
`register`/`revoke`, `close`, and read-only `state`. Binding remains restricted to
`127.0.0.1`. Fixed-port collisions do not stop or replace another process. The
protected API keeps exact Host/Origin, explicit capability and request/body
limits; public navigation uses the existing declared-GET rules. No test route,
server-source route, environment-file route or public registration/bootstrap
endpoint is added.

## Origin and record preservation

Use a new unused origin for development or acceptance; do not stop an existing
ThreeCore server or reload an existing user page to try this host. An ephemeral
port is useful for isolated tests. Reopening browser-local saved lists later
requires the same scheme, host and port; a different port is a different storage
origin. A new empty list does not mean that the old origin's records were erased.

The normal wallet continues to require explicit connection. Loading files,
reviewing checkpoints and restoring historical settings/data do not restore
wallet permissions or proposal grants. Preserve original downloads and drafts;
rehearse restoration only in an isolated destination. Workspace/checkpoint files
cover public settings and stored portfolio histories, not every record panel,
unsaved textarea, proposal result, transfer collection or period/report library.
Use the supported exports for each populated scope, as described in
[Live record preservation](LIVE_RECORD_PRESERVATION_EN.md).

A proposal grant, when a separately authenticated application integrates one,
must be delivered through its private channel and kept in memory. Serving the
wallet screen and API from one origin is not authentication. The normal entry
does not obtain grants from page assets, query parameters, files, localStorage
or a public endpoint, and a historical import cannot authorize generation.

## Verification scope

`integration/wallet-demo-application-server.test.mjs` checks the complete normal
static import/stylesheet closure, the default entry with proposal transport disabled, inert disabled
construction, actual loopback delivery of every declared asset with strict CSP,
legacy demo stylesheet compatibility, and invalid/bounded file capture in an
owned temporary tree. It never mutates checkout files to inject failures.

`integration/wallet-demo-asset-boundaries-server.test.mjs` independently checks
configuration overrides, option mutation during capture, denied private/test
paths and absence of request-time filesystem reads. The existing host suites
retain the shared lifecycle, body, deadline, admission and authority checks.

```sh
node --test integration/wallet-demo-application-server.test.mjs integration/wallet-demo-asset-boundaries-server.test.mjs
node --test integration/demo-server.test.mjs integration/proposal-host-server.test.mjs integration/same-origin-proposal-host-server.test.mjs
```

Native full-application rendering, file/IndexedDB recovery and optional private
proposal-bridge behavior require their own browser receipts. Node asset tests
are not evidence of real wallet access, successful OS file persistence, a live
model, deployed authentication, or overall completion percentage. No signing,
transactions, public-network request, paid API, key retrieval or publication is
part of this asset composition.
