# Corrected Wallet: verified delivery and recovery

The corrected Wallet and all three token projects are collected in one local
archive: `ThreeCore-complete-4dfa300-20261103.zip` in Downloads. This is a
standalone recovery package: no other ZIP or prior incremental update is needed.

- Size: **55,011,589 bytes**.
- SHA-256: `296fabf3de800ccf8bc9d5344248f0bd5f8c571e57a926391f7995b588992ca5`.
- Wallet source: `4dfa300aa2efc0b068ee5537df941282a21df1f4`.
- Wallet implementation/tests: identical to `7bdb23d3398e1e92582a602bb22f06d364825412`.
- DAT: `c50aae41b9c7aa496833e6260cc3314dc3c3fbfb`.
- EMA: `a37c60574e279980b5ce90775842d27b9c4ce5eb`.
- CAWELON: `0f5dfa00a6e1738df3706e12e59b48459ff875a0`.

The [account-input correction](ACCOUNT_INPUT_REFRESH_2026-11-03.md) fixes stale
shared-account and saved-backup summaries. Its final complete checks passed
16,470 Node/HTTP cases and 1,026 synthetic browser cases. Actual Microsoft Edge
verification confirmed the corrected summaries and byte-identical preservation
of all nine histories. Packaging did not repeat or inflate those test results.

## Fresh extraction and restoration

The final ZIP was extracted to a new directory. All **62 outer manifest entries,
59,395,404 bytes**, matched. Running the supplied `restore-latest.mjs` restored
four exact commits and content trees into another new directory, with clean
working files, no Git remotes and successful object-integrity checks. It verifies
the unchanged base and cumulative update internally; the operator invokes one
restoration command. See the [complete delivery receipt](evidence/2026-11-03-account-refresh-delivery/complete-delivery-result.json).

The freshly restored Wallet also verified all **273 evidence manifests / 2,963
entries / 125,898,575 bytes**, with no mismatch or unreadable entry. These are
saved evidence counts, not additional features or test passes.

With Node.js 22 or later and Git installed, run from the extracted package:

```powershell
node verify-package.mjs
node restore-latest.mjs "C:/Users/aseet/Downloads/ThreeCore-restored-new"
```

Choose a new destination outside the package, with an existing parent directory.
The script does not overwrite existing directories, install dependencies, use
the network, start a server or connect a wallet. The source and Japanese startup
instructions are in the package. Keep the existing 4231/4232/4233 processes and
working tabs intact; use an unused port for a separately started candidate.

Disposable-copy controls confirmed rejection of an altered file before a
restoration target was created, rejection of a destination inside the package,
and rejection of an existing destination while preserving its only file exactly.
See the [three controls](evidence/2026-11-03-account-refresh-delivery/complete-package-controls.json).

## Incremental package and retained failures

The smaller `ThreeCore-update-4dfa300-20261103.zip` is also preserved. It requires
the unchanged b7df758 base package and is unnecessary when using the complete
ZIP above. Its 728,471 bytes have SHA-256
`7d6a40639f70fb11f3f58dde7992c3ebb13ca047c40058d7cb49870971922223`.
All 25 entries / 1,793,911 bytes matched after fresh extraction, and its four
repositories restored exactly. Altering a copied Wallet bundle was rejected
before target creation; replacing that copy's original bytes restored a pass.

The first incremental ZIP build had an empty outer manifest because the
interactive inventory helper retained an old array binding. Verification rejected
it before delivery. The corrected inventory explicitly checked its 25 entries,
and the final archive was rebuilt, freshly extracted and verified. The invalid
copy and [failed check](evidence/2026-11-03-account-refresh-delivery/first-build-check.txt)
remain separate. The immutable b7df758 and 36ed431 archives were not replaced.

A saved-file probe initially could not import its dependencies in the persistent
tool session (`EventTarget` unavailable). The ordinary Node process completed
the same final-source decoding and exact re-export without any runtime changes.
The nine-record, 10,103-byte backup retains SHA-256
`6e4e79f3cb6efcb3cf49169779918e4bd6dd032b54a3c9d6af6d8cf5071e6c2a`.
This is offline compatibility evidence, separate from the successful actual Edge
restoration in the correction record.

An additional attempt to return to the fixed prior candidate in Edge lost its
automation attachment before an import could be performed. It was not counted
as a browser rollback pass. No user tab was reloaded or duplicate import made.
The [retained failures](evidence/2026-11-03-account-refresh-delivery/retained-failures.json)
distinguish these attempts from completed checks.

## Current development and release scope

| Condition | Current result |
| --- | --- |
| Assigned developer review | Completed; no requester/reviewer identification is pending. The later account-input finding was corrected and retested. |
| Corrected fixed source | Complete regression and actual Edge display exercise passed on the recorded implementation. |
| Account/network change handling | The earlier actual Mainnet-to-Sepolia and Account-1-to-Account-2 exercises passed three-card invalidation, explicit reconnect and history preservation. No additional direction or in-flight live race is inferred. |
| Current data restoration | Actual nine-record restore/export passed at fixed prior and corrected candidate versions; final-source offline re-export matches the original bytes. |
| Token/helper work | Applied compatibility repair, source/artifact comparisons, local simulation, configuration-validator coverage and developer maintenance review are recorded for the exact token pins. |
| Local delivery/recovery | One freshly extracted ZIP restores all four fixed source trees; altered and wrong-destination controls reject safely. |
| Publication | Consolidated local delivery is ready for the requested later publication. These local results are not remote CI on the unpublished source. |

The intended candidate remains the read-only Wallet and offline rehearsal.
The original Windows picker traversal and rollback to the older public 07041f0
checkpoint have not been established. That public checkpoint is known to reject
shared-account configuration; use the documented history-only recovery scope
instead of claiming unrestricted rollback. Final deployed scope and publication
remain separate decisions. Independent third-party audit and a numerical mainnet
completion percentage are not established by this developer checkpoint.

Full account backups and screenshots remain local and are not in these archives.
No user-wallet signature, transfer, approval transaction or secret access was
used. The original server PIDs and start times were rechecked unchanged.

This delivery receipt postdates the sealed archives and is saved separately.
The [evidence manifest](evidence/2026-11-03-account-refresh-delivery/SHA256SUMS.txt)
fixes its supporting records without changing the packaged source.
