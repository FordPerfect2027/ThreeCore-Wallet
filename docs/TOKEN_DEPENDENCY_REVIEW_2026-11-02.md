# Token development dependencies — November 2, 2026

The three pinned token projects had identical dependency graphs (141 locked
transitive package entries, including optional platform packages). An actual
npm registry audit reported eight high-severity package entries. This is a
dependency finding, not evidence of exploited wallets or unsafe deployed token
bytecode. No user wallet, signing key or public transaction was used.

## Local correction and validation

The token projects now pin `follow-redirects` 1.16.2 and `undici` 6.29.1 through
overrides. The lockfile delta changes only those two transitive entries. Compiler
0.8.34, Hardhat 3.16.0, OpenZeppelin 5.6.1 and contract sources are unchanged.
The relevant advisories identify patched versions:

- [follow-redirects cross-origin credential handling](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)
- [undici TLS option propagation](https://github.com/advisories/GHSA-2m5v-pch6-74hx)

A new DAT worktree used `npm ci --ignore-scripts --no-audit --no-fund` successfully.
After verifying all three repaired dependency graphs match, EMA and CAWELON used
that same new dependency installation through directory junctions. Each token
compiled in its own previously empty artifact/cache directories. This is one
clean dependency installation shared across three equivalent graphs, not three
separate installations. Original pinned validation directories were preserved.

| Token | Local repair commit | Contract cases | Read-only cases | Local history cases | Wallet compatibility cases |
| --- | --- | ---: | ---: | ---: | ---: |
| DAT | `fb5a5f6940563b1efa5c5bb5006b270b086e303b` | 161 | 124 | 10 | 50 |
| EMA | `69c89da9a0697a6d6f6f7a1fa82ab25354c7f7ab` | 163 | 124 | 10 | 50 |
| CAWELON | `5fe773a62d1676b381a4a33156db0a3c033617f2` | 163 | 124 | 10 | 50 |

Every project's complete `npm run check` passed, including TypeScript checking.
Wallet compatibility used the fixed `59b63ca` Wallet source on isolated local
EVMs. Synthetic local transfers/approvals in those EVMs do not use the user's
wallet and do not submit transactions to a public network.

The first comparison required byte-identical full artifact JSON and failed for
DAT. Inspection showed only `buildInfoId` differs. The ABI, creation bytecode,
runtime bytecode and every other artifact field match for all three contracts.
The final receipt preserves both full-file hashes and the changed field; it
does not claim full-file identity or silently replace the prior expected hash.

## Remaining advisory

The subsequent complete audit reports six high-severity package entries, all
tracing to [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
This is one root advisory propagated through the Hardhat plugin dependencies,
not six newly discovered independent defects. The installed Zod is 3.25.76;
the advisory names 4.6.6 as fixed. The npm metadata checked on November 2 also
showed latest Hardhat 3.21.2 still depending on `zod: ^3.23.8`.

No forced major-version override, toolchain downgrade or automatic audit fix
was applied. Compatible remediation and source-level exposure review remain
open; do not describe the development-dependency audit as clean. An additional
production-only audit reports zero known findings for the earlier classification.
That result predates the [runtime installation correction](READ_ONLY_RUNTIME_2026-11-02.md);
it is not an audit of the revised graph. That narrower historical result does
not clear the development finding, certify contract safety, or replace an
independent review.

A bounded source/exposure check at Wallet `eb08524` found no references to these
toolchain libraries in the Wallet's `examples/` or `src/` JavaScript files, and
the Wallet package declares no runtime dependencies. A separate temporary
ordinary-mode HTTP server served the Wallet while refusing package, toolchain,
integration and browser-test routes in six checked cases. It was then closed;
the original server and user browser were untouched. Hardhat's Zod configuration
and RPC schemas do use arrays and validation parsing, so the advisory remains
open in the development tools. This check is neither a full reachability proof
nor independent review. [The scope and source hashes are recorded here](evidence/2026-11-02-token-dependency-review/exposure-review.json).

## Combined publication order

Before preparing the combined delivery, all three token repositories were found
to have shallow local history. Read-only fetches completed their history without
changing the pinned commits or working files. Each new Git bundle was then
restored into its own empty repository without remote access; the full-history
integrity check and clean working-tree check passed.

The initial DAT source ZIP differed from its commit in two Markdown files.
Inspection confirmed automatic LF-to-CRLF conversion only. The source export
now uses `git -c core.autocrlf=false archive` to preserve committed bytes, while
the independent bundle checkouts retain the normal Windows `core.autocrlf=true`
setting. The initial failed ZIP and diagnosis are preserved; expected source
hashes were not changed. Corrected exports match all 67 DAT files, 60 EMA files
and 60 CAWELON files. Lockfiles match the previously verified builds, and the
included compiled artifacts match the prior successful compatibility receipts.

The local token review kit is `ThreeCore-token-offline-review-20261102-v2` in
Downloads. Its complete 28-entry manifest passes. It contains source ZIPs,
offline-restorable Git bundles, compiled artifacts, dependency notes and
receipts. npm dependencies are not vendored: this demonstrates offline source
restoration, not a network-free rebuild. No additional contract test run, new
remote CI result, independent review or resolution of the remaining Zod advisory
is claimed. [The token package receipt](evidence/2026-11-02-token-dependency-review/token-package-receipt.json)
records exact pins and artifact hashes.

Everything remains local at the operator's request. The Wallet CI matrix has
been prepared with the three repair commits above. **Before publishing that
Wallet change, publish the corresponding token commits to their intended
repositories and verify each remote can resolve its pin.** Until then, these
are local candidate pins, not publicly available references. No new remote CI
run or successful public result is claimed for them.

The already delivered `59b63ca` ZIP predates these dependency and CI changes.
Keep it as a historical checkpoint; produce a new combined delivery when the
current collection of changes is ready. Avoid repeatedly rebuilding the whole
Wallet package for each documentation update.

See [the audit JSON, logs and receipts](evidence/2026-11-02-token-dependency-review/README.md).

## Major-version compatibility check

A [bounded Zod 4.6.6 compatibility probe](ZOD_COMPATIBILITY_2026-11-02.md) reproduced a TypeError in the unchanged Hardhat helper when formatting an ordinary invalid configuration. The Zod 3 baseline returns the expected structured error. No override was adopted; compatible upstream remediation and full regression remain open.
