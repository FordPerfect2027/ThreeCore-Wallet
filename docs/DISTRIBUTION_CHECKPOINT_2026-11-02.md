# Combined distribution checkpoint — November 2, 2026

The saved review package now includes the history CLI boundary correction, the
runtime dependency classification fix, and the bounded Zod compatibility finding.
It is a local review checkpoint, not a release approval or completed independent
review. The binary archive remains in Downloads; it is not committed to Git.

- Filename: `ThreeCore-review-d904442-20261102.zip`
- Wallet source/evidence revision: `d9044422820973e53fa41e0c55908f6e34217d7f`
- Wallet application implementation: `34d173112d7f45475c52fb64553cfa8b369699d2`
- ZIP size: 46644072 bytes
- ZIP SHA-256: `cb3ae5a3cec4abc8196c6b4d6fe5e8c769417aab51cc4c7f89774a53c63c57c5`

| Token | Source revision | Fresh restored CLI/input cases |
| --- | --- | --- |
| DAT | `6c455914df26d52de75bd2c6d3ae0aefb1215d29` | 30 passed / 0 failed |
| EMA | `c027e68cd1974dc31f2619d04b4fb9059843424f` | 30 passed / 0 failed |
| CAWELON | `b77a6b31af135c0461dd66d95bc837c8e7d9e88f` | 30 passed / 0 failed |

## What was verified for this delivery

The Wallet source archive matches all 4433 tracked files
at the fixed revision. A full-history Git bundle restores into an empty Windows
repository whose path contains spaces, with normal core.autocrlf=true. All
253 evidence manifests / 2348
entries match there, and the historical-record verifier passes. The isolated
source export passes ten startup/HTTP checks; its server is closed afterwards.

Each token bundle likewise restores its complete history into a separate empty
repository and passes Git's full integrity check. Each restored checkout receives
its own 19-package minimal installation and passes 30 CLI/input cases. The source
ZIP comparisons cover DAT 79, EMA 72, CAWELON 72 files.
The 30-case selections include canonical state/identity command tests and the
history CLI tests with known positive events; they overlap the earlier full
213-case results and are not additional features or a new full regression run.

Installation used npm offline mode with the already populated task cache,
--omit=dev, --omit=optional and --ignore-scripts. No existing node_modules was
shared. Dependencies are not vendored in the ZIP: a PC without the required cache
normally needs the public npm registry. Network-free source restoration and a
cache-assisted runtime install do not establish an unprepared offline build.

The included contract artifacts retain the exact hashes from the earlier verified
builds. Contract/compiler inputs and every dependency version, resolved URL and
integrity value are unchanged. The lock bytes differ because runtime/development
classification flags changed. Artifacts were not rebuilt in this packaging run.

The final outer ZIP was extracted into another empty directory: all
46 manifest entries match, with no unlisted extra files.
The [receipts and raw logs](evidence/2026-11-02-release-regression/DISTRIBUTION_D904442.md)
bind each claim to its scope. Checksums detect corruption; they do not authenticate
a publisher or certify the product.

## Remaining release gates

Real-wallet Base Sepolia acceptance for all three token cards using the two
existing accounts, the original-profile OS file chooser, real-wallet migration
and return, compatible Zod remediation, independent review and the release
decision remain incomplete. Original wallet data and the running 4231 server
were not replaced. No signature, transfer, private credential access or public
RPC request occurred in this package check.

The earlier 7d58d08 archive remains a historical checkpoint. This document and
these delivery receipts are recorded after the packaged source revision; they
do not change the bytes or revision inside the fixed d904442 archive.
