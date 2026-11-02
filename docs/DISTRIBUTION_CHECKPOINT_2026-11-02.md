# Combined distribution checkpoint — November 2, 2026

The latest local archive includes the RPC history-range correction, complete
regression after the native-crypto test-wait fix, six deployed-runtime comparisons,
and the intended-PC Mainnet restore/reconnect/stop acceptance record.

- File: ThreeCore-review-23d0a35-20261102.zip (Downloads)
- Source/evidence revision: 23d0a35b129c32be581bf1a3ffad57e228b9b65c
- Application implementation: 96b59459a0f593246c60f0bed4b52052211a464a
- Complete regression revision: e5841f0d1b412b516b3e3eb4a81d75eabaf81edd
- ZIP: 50030551 bytes
- SHA-256: 31a88b5c015fd4adb71100d8b66fb8fd06b4eae5ad14defd868e76ce9d80aadc

Full local regression passed 16,454 Node/HTTP and 1,021 synthetic-browser cases.
The initial 16,453/16,454 failure and subsequent test-only correction are retained.
The actual MetaMask session used one existing account on Base Mainnet across
three token cards. Actual save/restore, explicit reconnect, pending-read Stop and
history preservation passed. Three downloaded workspaces were byte-identical.
Synthetic browser tests and real-wallet observations are separate evidence.

The source archive has 4,577 files matching the pinned commit. A new Windows
checkout with core.autocrlf=true verified 253 evidence manifests / 2,483 entries,
complete Git history and the historical-record checker. A separate temporary
server passed 12 asset/HTTP/privacy/range checks and was closed. This did not
restart or upgrade the original port 4231 server.

The three token packages are byte-identical to the verified 16a0d33 distribution:

| Token | Revision |
| --- | --- |
| DAT | 502944c94ffed408356b487abc9a710807697ee2 |
| EMA | 9cad39a196e8afc37abb5b99c260e00327c55d1c |
| CAWELON | e3a5fbb966008319b7b7204ddbfb705a3e9ab12c |

Their prior selected test receipts are retained, not presented as new test runs.
A fresh DAT runtime installed 19 packages from the pre-existing offline npm
cache, without reused node_modules or development packages. The stored six-
deployment comparison replay passed: six executable/immutable matches, one
complete runtime match and five metadata differences. No public RPC request or
new token compilation was performed during this packaging. Dependencies are
not vendored. The development Zod advisory remains open.

The final ZIP was extracted into another fresh directory. All 60 outer manifest
entries matched with no extras. Package and ZIP receipts recorded after the
source pin are preserved alongside the creation and sealing methods. These
later records do not change the fixed source archive.

Remaining: real two-account and chain switching, Sepolia acceptance, complete
candidate-server migration/return, independent review and release decisions.
Actual file selection used the browser file-chooser API; native Windows picker
traversal was not tested. At the subsequent attempt to inspect the Edge extension
screen, Computer Use could not determine the browser URL and stopped browser
operations. No account or chain switch was attempted after that stop.

Checksums detect changes, not provenance or security. This is a review checkpoint,
not release approval or a calculated 90% completion score. The earlier 16a0d33
and d904442 distributions remain unchanged.

[Receipts and methods](evidence/2026-11-02-release-regression/DISTRIBUTION_23D0A35.md)
