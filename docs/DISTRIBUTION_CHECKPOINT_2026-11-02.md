# Combined distribution checkpoint — November 2, 2026

The latest local review archive includes the response-body deadline correction,
strict historical Sepolia verification, source LF portability and corrected test
discovery. It is a review checkpoint, not release approval or a completion score.

- File: ThreeCore-review-16a0d33-20261102.zip (in Downloads)
- Wallet source/evidence revision: `16a0d33b6af6c735c5d690e63a8b629bbabf867c`
- Wallet application implementation: `34d173112d7f45475c52fb64553cfa8b369699d2`
- ZIP size: 47868853 bytes
- ZIP SHA-256: `79e5329634c0634e7528a27272a202d553c7101467a146eb82b82e85ee08ed17`

| Token | Source revision | Fresh restored selected cases |
| --- | --- | --- |
| DAT | `502944c94ffed408356b487abc9a710807697ee2` | 51 passed / 0 failed |
| EMA | `9cad39a196e8afc37abb5b99c260e00327c55d1c` | 45 passed / 0 failed |
| CAWELON | `e3a5fbb966008319b7b7204ddbfb705a3e9ab12c` | 45 passed / 0 failed |

All 4523 Wallet source files match the fixed revision. Full-history Git bundles
restore into empty Windows repositories with spaces in their paths, with
core.autocrlf=true explicitly set only in those disposable repositories. Git
integrity checks pass; all 253 evidence manifests / 2434 entries match. The
historical-record verifier and ten startup/HTTP checks pass. That temporary
server was closed. The original 4231 process and user tabs were untouched.

Each restored token receives its own minimal 19-package runtime; existing
node_modules is not linked or shared. Hardhat, solc, TypeScript and Zod are absent
from that profile. Selected checks cover canonical/identity/history commands,
response-body handling, actual Git source checkouts and test routing; DAT also
runs its six Sepolia CLI cases. These are selected overlapping regressions, not
new features or a rerun of the entire Wallet suite. Installation used the existing
npm cache in offline mode, with lifecycle scripts disabled. Dependencies are not
vendored; an unprepared PC normally needs the public npm registry.

The included compiled artifacts match the actual new LF builds and source
revision recorded in the [source correction](SOURCE_PORTABILITY_2026-11-02.md).
They were copied and compared during packaging, not recompiled here. Their
metadata differs from the older d904442 distribution; ABI and executable-byte
comparisons are preserved separately. DAT's included historical reference is
unchanged. From the freshly installed runtime, its normal verification command
passed again at block 46,922,886 using public reads and eth_call only. No signature
was created or public transaction submitted. This is historical state, not
current balances or real-wallet acceptance.

The final ZIP was extracted into another empty directory; all 56
outer manifest entries matched, without unlisted extra files. Supplements include
the bounded Zod exposure observation and public package metadata. The advisory
remains open in the full development installation. The source ZIP is fixed at
16a0d33; the delivery receipt and supplements do not change that source revision.

Real-wallet acceptance, original-profile file selection, migration/return,
compatible Zod remediation/exposure review, independent review and release
approval remain incomplete. Checksums detect corruption; they do not authenticate
a publisher or certify security. [Raw receipts and methods](evidence/2026-11-02-release-regression/DISTRIBUTION_16A0D33.md)
bind each result to its scope. The earlier d904442 ZIP remains unchanged as a
[historical checkpoint](evidence/2026-11-02-release-regression/DISTRIBUTION_D904442.md).
