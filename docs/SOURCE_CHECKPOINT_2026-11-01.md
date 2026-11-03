# Verify a plain source checkpoint before starting it

`scripts/verify-source-checkpoint.js` compares an extracted source package with
an explicitly selected full Git commit ID. It checks every tracked file against
its Git blob ID and also reports a portable SHA-256. It rejects missing,
modified, unexpectedly added and unreadable files. The exported directory must
be separate from the repository. No source code from the exported directory is
executed by this comparison, and no checkout, file write, wallet or network
request is performed.

```sh
node scripts/verify-source-checkpoint.js REPOSITORY FULL_COMMIT_ID EXTRACTED_DIRECTORY
```

The JSON result has `allMatched`, file counts and per-file results. Exit status
is 0 for a complete match, 2 for content differences or unexpected files, and 1
for invalid input or unreadable files. A dirty developer checkout or a newer
HEAD does not change the selected source commit. Symbolic links, submodules,
nonportable paths and case-colliding source names are rejected. Inspection is
bounded to 10,000 source files, 64 MiB per file and 256 MiB total content.

This establishes byte identity with the specified local Git source. Select a
trusted revision separately; the command does not authenticate a publisher,
attest security, check executable permission bits, lock files against future
changes, or certify mainnet operation. Archive filters that change or omit
tracked content will cause a mismatch rather than an undocumented exception.

## Fresh-directory verification performed

A standard Git ZIP archive was created from
`df9690f7d1b2c1d3a66e104e506a6ac8c732d86f` and extracted to a new temporary
directory. This source contains the read-only wallet, the original historical
verification records, the CI timing fix and the release-gate document. It
predates the addition of this checker itself.

- 4,227 / 4,227 exported files matched their Git blobs.
- 104,050,188 source bytes inspected; no missing, mismatched or extra files.
- ZIP size: 24,543,487 bytes.
- ZIP SHA-256: `d488e50f4a5ecb0123466789617561a7c927394c4fe6bc63c34a2d6a1542406d`.

The exported server started on an automatically assigned, loopback-only port.
The wallet page, rehearsal page and two entry/connector modules returned the
exact exported bytes with the expected response headers. `.env` and browser
test routes returned 404 in ordinary mode, and a foreign-origin request was
refused with 403. All seven checks passed. The test's own server was then closed.
The existing port 4231 process and open rehearsal data were not restarted or
reloaded. This is a server startup check, not a real-wallet connection test.

Eight checker regressions passed: exact empty/binary files, fixed revision despite
later commits, same-size corruption plus a missing file, unexpected private-file
names without contents, checkout/nested-directory rejection, invalid revision
types, oversized files and junction redirection. See the
[saved audit and validation files](evidence/2026-11-01-source-checkpoint/).

## Preparing and returning to a known version

1. Select the exact source commit and retain the previous known version and its
   saved wallet/rehearsal files. Export with `git archive --format=zip` using a
   fresh archive name; extract into a new empty directory.
2. Run the checker from the development repository against that directory and
   exact commit. Do not launch a package with a failed or incomplete comparison.
3. Start the candidate on an unused loopback port with `THREECORE_DEMO_PORT` and
   `node examples/dev-server.js`. Do not replace or terminate an existing user's
   server to make room. Do not enable `--ui-test` for ordinary use.
4. A new port is a new browser origin: wallet permissions and browser storage
   do not automatically transfer. Import saved files through their normal
   review/confirm controls. Reconnection remains explicit.
5. To return, save any new candidate records, close only the candidate's own
   process and reopen the previous known version. Never overwrite the previous
   backups with a failed or unconfirmed restore. Do not infer permission or
   balance freshness from a restored file.

The archive is a development checkpoint. A public service deployment and
mainnet release still require the [remaining release gates](RELEASE_READINESS_2026-11-01.md).

## November 2 candidate prepared for actual migration

The later Wallet-only archive `ThreeCore-candidate-f52109a-20261102.zip` pins
`f52109a3a5d25665667b19b811584e33da035d15`. The existing checker compared its
fresh Downloads extraction with that exact Git commit before execution:
4,658 matched files / 126,215,683 inspected bytes, no missing, mismatched,
unreadable or unexpected files. The ZIP is 29,172,809 bytes, SHA-256
`db16c2523aa7477cf0279b58def2a5010fb579a007b2df255e9fc7db524894a0`.

The exported ordinary server started with `THREECORE_DEMO_PORT=4232`, PID
28252. Its Wallet page, rehearsal page, setup panel, security-RPC module and
card controller matched the extracted files exactly with no-store/frame-denial
headers. Private-file and browser-test routes returned 404; a foreign-origin
request returned 403. The eight checks establish startup and these routes,
not a complete new regression. No UI-test mode or new dependency installation
was used.

The exported modules also read three actual saved files offline: Mainnet backup
`(12)`, Sepolia backup `(14)` and the fictional operation workspace. Both Wallet
files have three cards / one saved observation per card and verified internal
checksums. The rehearsal contains 3/2/1 fictional records. The original input
bytes remained unchanged. Offline read-back does not establish UI restoration.

The [preparation receipt](evidence/2026-11-02-release-regression/candidate-f52109a-migration-preparation.json)
retains these results. Detailed source comparison, launch/startup receipts and
the Japanese `-手順.txt` are saved beside the ZIP in Downloads. The existing
4231 process remains PID 2108 with its October 30 start time, and its working
tabs are retained. Opening, permission and return were pending at preparation.
The later [actual migration and return](LIVE_ACCEPTANCE_2026-11-02.md#fixed-candidate-migration-and-return-completed)
completed three new candidate Wallet reads, retained all six observations,
explicitly reconnected at the original origin, and produced byte-identical
7,237-byte candidate/return Wallet exports. Rehearsal restoration also passed
for six fictional records and three cases, with byte-identical 17,387-byte
original/candidate/return session files. The original server was not restarted.
This return used its current client files, not a separately pinned older public
release. The preparation alone did not establish these later UI results, and
neither sequence establishes 90% readiness or independent release approval.
