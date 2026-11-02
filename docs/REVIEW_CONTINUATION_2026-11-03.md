# Current review package and candidate round trip — November 3, 2026

The standalone local package now includes the connection-stop diagnostics and
same-origin navigation recovery, plus the earlier complete regression records.
It replaces `2126019` as the current combined review package; the old ZIP is
unchanged. This is a source/evidence checkpoint, not release approval.

- Package: `ThreeCore-review-9374845-20261103.zip` in Downloads
- Fixed Wallet source/evidence: `9374845d440910f7ecb27c73d35fe2cfda37f934`
- Latest implementation: `f6f378cc9b44f33fc7e147f4626e23573de06a6c`
- ZIP size: 52,200,092 bytes
- SHA-256: `bfc859d5033fd866c7e75f089dcced7785c3467213d8ee1f9b32aa62ee3acb94`

The unchanged token pins are DAT `47d8aa9db72e54e49fc9521f9b4022c416a7c6d1`,
EMA `5d36704ec1a5f5fb89febd7f414eee9fe41fd3ac`, and CAWELON
`4af9e1db98cac546e498b6f34531ba890cc2e3c0`. Each token package includes its
complete Git bundle, source archive and previously verified build artifact.

## Package verification

All four source archives were compared against their exact Git revisions:
4,758 Wallet files, 99 DAT files, 84 EMA files and 84 CAWELON files matched.
All four complete Git histories restored into new empty repositories with no
remote; Windows newline conversion was enabled and each checkout was clean.
The restored Wallet matched 256 evidence manifests / 2,655 entries and passed
the historical checkpoint checker. Its temporary server passed 11 source-byte,
route and security-header checks, then closed.

The final ZIP was freshly extracted into another directory. All 31 outer
manifest entries matched, with no extras. Deliberately changing the extracted
README was rejected; restoring its original bytes made verification pass again.
Run `node verify-package.mjs` in the extracted package to check its contents.
Follow `START_HERE.txt` to restore the Wallet bundle into a new directory.

No dependencies were reinstalled and no contracts were rebuilt. Packaging did
not repeat full regression: the latest full Node/HTTP run remains at `2126019`;
the later 453 targeted Node cases, 1,024 synthetic browser cases and 62 server
cases retain their original implementation scopes and logs. Public CI was not
rerun. Checksums detect changes, not provenance, safety or independent approval.

## Actual candidate restoration

On Microsoft Edge at port 4233, the previous validation tab lost its automation
attachment during file selection. It was not reloaded. A fresh tab opened the
new refusal guide and its explicit same-origin link opened the Wallet, without
asking the operator to type the address again.

The real nine-record file `(19).json` was selected through the supported browser
file chooser, previewed and restored into the empty candidate tab. Each card
received three observations. The six older Account 2 observations retained
their original account, network, source origin and block identities. All cards
remained disconnected; restoring a file did not grant Wallet permission.

The candidate exported `ThreeCore-workspace-backup (20).json`. Although the
download-event waiter timed out, the file was present on disk. Both files are
10,103 bytes and byte-identical, with SHA-256
`3ebf36e36f94d12fb6b09387c723a3144933918c720ab26cd78a7c1d6ab5d4bc`.
The offline checker verified the internal checksum and nine observations.
An initial command omitted its required `--file` flag; the corrected command
passed. This was a command-argument error, not damaged backup data.

The candidate's manual stop and explicit resume produced a version-2 protection
journal containing `ready`, `manual` and `resumed`. All nine histories remained.
The journal included no addresses, balances or provider payloads. This verifies
the actual page's manual controls and export format; no live wallet account or
network change occurred in this exercise. All wallet-event counters were zero.

The original 4231 and fixed-candidate 4232 server processes were preserved.
No signatures, transactions, token approvals, keys, new Wallet permissions or
GitHub writes occurred. The original nine-record page and rehearsal were kept.

## Remaining scope

While recording this follow-up, the current repository reached 257 tracked
manifests and exposed the collection checker's old 256-manifest ceiling. The
local checker now accepts at most 512 manifests. Its 512 MiB shared artifact
budget, 64 MiB file limit, bounded Git output/time and path validation are
unchanged. A regression fixture verifies 257 and 512 accepted, 513 rejected,
corruption still reported, and the smaller shared-byte budget still enforced.
All 56 collection/manifest/Git-round-trip cases passed with no failures,
cancellations or skips. The [repair receipt](evidence/2026-11-03-review-continuation/checker-repair.json)
and raw test log are included in this follow-up evidence.
The corrected checker then verified the actual current collection: all 257
manifests / 2,668 entries matched (118,891,979 admitted bytes), with no mismatched
or unreadable files. The full result remains in the local continuation folder.

This checker-only repair occurred after the `9374845` package was sealed and
does not change that ZIP. Its original checker remains sufficient for its
exact 256-manifest archive. Use the newer local checker for the growing current
repository; do not claim the archive contains this subsequent tool repair.

Live MetaMask account/network invalidation, the dependency advisory disposition,
native Windows picker traversal, any required previous-release rollback, and
independent review/release decisions remain separate open items. Neither this
package nor its file counts establish a measured 90% completion score.

[Package receipt](evidence/2026-11-03-review-continuation/package-receipt.json),
[ZIP verification](evidence/2026-11-03-review-continuation/zip-receipt.json),
[actual candidate receipt](evidence/2026-11-03-review-continuation/candidate-roundtrip.json),
[backup inspection](evidence/2026-11-03-review-continuation/backup-check.json),
and [protection record](evidence/2026-11-03-review-continuation/protection-record.json)
are retained with their [manifest](evidence/2026-11-03-review-continuation/SHA256SUMS.txt).
These packaging/round-trip receipts were recorded after the fixed source pin
and are not inside that source archive. Their later documentation commit does
not change the ZIP or the implementation pin.
