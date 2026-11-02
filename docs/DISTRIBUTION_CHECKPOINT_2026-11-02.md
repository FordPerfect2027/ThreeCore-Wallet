# Combined distribution checkpoint — November 2, 2026

## Current combined review package: 2126019

`ThreeCore-review-2126019-20261102.zip` in Downloads replaces the earlier combined
review package as the entry point. It is standalone and includes complete source
archives and Git history for the Wallet and all three corrected token candidates.
The original packages remain unchanged.

- Wallet source/evidence: `212601977bc6dad8da298f11ebb9e7a421052571`
- Wallet implementation: `8fa0ed2739482b8df415e46c6c45491955d4bfc4`
- Last complete Wallet regression: `e5841f0d1b412b516b3e3eb4a81d75eabaf81edd`
- ZIP: 51,127,612 bytes
- SHA-256: `a938e26ed7c572962c32decf0cc452654caeed58f5514be9ae41418c9ad605ea`

| Token | Included revision |
| --- | --- |
| DAT | `47d8aa9db72e54e49fc9521f9b4022c416a7c6d1` |
| EMA | `5d36704ec1a5f5fb89febd7f414eee9fe41fd3ac` |
| CAWELON | `4af9e1db98cac546e498b6f34531ba890cc2e3c0` |

Each full bundle was verified in an empty Git repository, then restored with
`core.autocrlf=true`, without a remote. The exact commits, complete history and
clean checkouts were confirmed. Source ZIPs matched all 4,727 Wallet files,
99 DAT files, 84 EMA files and 84 CAWELON files. The restored Wallet verified
254 evidence manifests / 2,630 entries and the historical checkpoint checker.
An isolated ephemeral server passed 11 source-byte, route and security-header
checks and was closed. Original servers on 4231 and 4232 were not restarted.

The final outer ZIP was extracted into another new directory: all 31 manifest
entries matched, with no extra files. A deliberately altered README was rejected;
restoring its exact bytes made verification pass again. Run the included
`node verify-package.mjs` to check the extracted package.

Packaging did not reinstall dependencies, rebuild contracts or repeat full
regression. The [previous toolchain validation](TOOLCHAIN_EMPTY_DATA_2026-11-02.md)
and its original logs remain the test evidence. Included token artifacts match
those verified builds exactly. No new public RPC or real-wallet operation occurred.
The Zod finding, live switch-event acceptance, native picker traversal, independent
review and release decision remain open. This is a review package, not release
approval or a calculated completion percentage.

- [Package receipt](evidence/2026-11-02-release-regression/distribution-2126019-package-receipt.json)
- [ZIP verification](evidence/2026-11-02-release-regression/distribution-2126019-zip-receipt.json)
- [Included file manifest](evidence/2026-11-02-release-regression/distribution-2126019-file-manifest.txt)
- [Japanese entry instructions](evidence/2026-11-02-release-regression/distribution-2126019-README.txt)

## Earlier combined package: 23d0a35

The full local archive includes the RPC history-range correction, complete
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

## Incremental evidence and review supplement

`ThreeCore-review-supplement-9c8c81b-20261102.zip` in Downloads adds the later
source-reconstruction, actual-context and review records to the fixed full
distribution. It requires the original `ThreeCore-Wallet-review.bundle`; it is
not a standalone Wallet distribution.

- Supplement target: `9c8c81bfd2cdefa8f9419815b5de79f490e02fc0`
- ZIP: 468,608 bytes
- SHA-256: `df51633722500251b51cf8dde996e38fde284567d0363a8174ac913c13bb42de`
- Incremental bundle: 313,232 bytes, 65 changed documentation/evidence/CI files
- Application and regression inputs: unchanged from the full distribution

A fresh Windows checkout first rejected the incremental bundle because its base
history was absent. After fetching the full bundle and then the increment, the
exact target, all 602 history commits and a clean working tree were confirmed.
No remote was configured. With `core.autocrlf=true`, all 253 evidence manifests /
2,539 entries matched. The historical-record checker also passed its 149 files.
These are checks of saved evidence, not new chain observations or additional
Wallet regression cases.

Fresh ZIP extraction matched all nine outer manifest entries with no extra
files. The initial sealing attempt detected ordinary Markdown newline changes
from the Windows checkout and stopped before creating a ZIP. The loose handoff
copy was then checked with newline normalization and omitted: its relative
links should be followed inside the fully restored repository. Evidence bytes
were never normalized. The Japanese README contains the base-then-increment
restore steps and the exact expected revision.

The supplement does not close the remaining release gates in the
[current review handoff](RELEASE_HANDOFF_2026-11-02.md). The source-replay kit is
still available separately; it is not required to apply this bundle increment.
The original 4231 process was observed unchanged at the end of this work.

- [Restore receipt](evidence/2026-11-02-release-regression/supplement-9c8c81b-receipt.json)
- [ZIP receipt](evidence/2026-11-02-release-regression/supplement-9c8c81b-zip-receipt.json)
- [Included file manifest](evidence/2026-11-02-release-regression/supplement-9c8c81b-file-manifest.txt)
- [Japanese restore instructions](evidence/2026-11-02-release-regression/supplement-9c8c81b-README.txt)
- [Creation method](evidence/2026-11-02-release-regression/supplement-9c8c81b-build-method.mjs)
- [Sealing method](evidence/2026-11-02-release-regression/supplement-9c8c81b-seal-method.mjs)
