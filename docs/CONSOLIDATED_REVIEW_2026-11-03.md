# Consolidated review package with applied helper repair

`ThreeCore-review-128ee11-20261103.zip` is a standalone local review package.
It includes the Wallet and all three locally committed token updates, including
the private helper archive, its source and license. Earlier ZIPs and separate
patches are not required to reconstruct these four sources. Dependencies are
not installed by opening or extracting the package.

| Source | Fixed commit | Verified source files |
| --- | --- | ---: |
| Wallet | `128ee11fefc263a11e36c026fbf786655c4cf8f6` | 5,022 |
| DAT | `dc2535732e9b83bddd8c5f4a2208c65fdff0a6d1` | 105 |
| EMA | `cae4130e8e01fd325fdcb6a589a46338be08b27e` | 90 |
| CAWELON | `9fc0ffa988f5b9a80d75d7f95b80e6a759f1610d` | 90 |

The ZIP is **54,097,515 bytes**, SHA-256:

`f448a4551546ade7e3cbbd2bec67f6e15bcf5b9baed6492816750f36de02adcc`

Each complete Git history was restored in an empty directory, with no remote,
the expected detached commit and a clean working tree. Every source archive
matched the committed bytes. The restored Wallet's **264 manifests / 2,903
evidence entries** matched, totaling 124,314,622 verified bytes. The packaged
token contract source, complete creation/runtime bytecode and helper archive
matched the applied-repair receipts. No build or full regression was repeated
merely to increase a count.

After a fresh outer-ZIP extraction, all **29 listed files / 57,328,118 bytes**
matched, with no unlisted files. Modifying the extracted entry instructions was
rejected by the verifier; restoring them passed again. The original sealed ZIP
was not modified by this negative control.

## Review entry points

Read `START_HERE.txt` and `package-receipt.json` after extraction, then run:

```powershell
node verify-package.mjs
```

`wallet/source.zip` and `tokens/<DAT|EMA|CAWELON>/source.zip` contain source.
Each adjacent `history.bundle` contains its full Git history. The frozen
Wallet source predates this packaging receipt, so its references to the earlier
standalone ZIP are historical. The outer receipt is the version map for this
package. This document and final packaging receipts are retained in the next
documentation commit, outside the fixed source pin above.

Wallet implementation and test files are unchanged from the complete
`bf690f3` regression: 16,470 Node/HTTP and 1,024 synthetic-browser cases passed
then. The newer applied token checks and 68-case decoder comparison are
separate results with their own source and time. No new current-chain state,
user-wallet event acceptance or independent approval is inferred from them.

Remaining: actual connected MetaMask account/chain-switch invalidation, native
Windows picker traversal, the prior-public-release rollback if required, private
helper maintenance/release approval, and independent candidate review. The
package neither asserts 90% completion nor authorizes a public release. Original
servers and user tabs remain preserved; GitHub writes remain deferred.

Private full-address Wallet backups and screenshots are not added to this
package. Their relevant observations and hashes remain in the dated records.
Checksums establish consistency, not origin authentication or token safety.

- [Exact source and verification receipt](evidence/2026-11-03-consolidated-review/package-receipt.json)
- [ZIP extraction and alteration control](evidence/2026-11-03-consolidated-review/zip-receipt.json)
- [Package inventory](evidence/2026-11-03-consolidated-review/package-SHA256SUMS.txt)
- [Evidence checksums](evidence/2026-11-03-consolidated-review/SHA256SUMS.txt)
