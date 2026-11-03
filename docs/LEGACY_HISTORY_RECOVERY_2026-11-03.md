# Shared-account backup compatibility with the earlier public source

The earlier public PR head `07041f00efdb503cb76a06fbe12e5531cb380930`
rejects the actual Mainnet three-record, Sepolia three-record and latest
nine-record backups with `WORKSPACE_DUPLICATE`. The current source accepts all
three. The rejection is an older shared-account restriction, not file corruption.
Do not use that older source as an unrestricted rollback target for these files.

The old revision was exported into a new directory. All 4,249 source files /
105,110,167 bytes matched Git. An isolated ordinary server returned the exact
Wallet and rehearsal HTML and was closed. No existing server was replaced.
This pin is an earlier public PR checkpoint, not an immutable public release.

## Recovery copy prepared

Downloads contains `ThreeCore-legacy-history-recovery-20261103/`:

- `ORIGINAL-nine-records.json`: byte-identical copy of the original backup.
- `HISTORY-VIEW-ONLY-legacy.json`: a separate copy for offline history viewing.
- `READ-ME.txt`: Japanese instructions distinguishing their purposes.
- `verification.json`: exact hashes, preserved histories and acceptance results.

The history-view copy sets only the three card-configuration `account` fields
to null, then recomputes the envelope checksum with the old revision's own
encoder. Its nine historical observations retain every original account,
network, token, block and observed value. No observations are discarded, relabelled
or fabricated. Tokens and other card settings are unchanged. No permission or
connection is restored. The original backup remains the normal current-version
recovery file; the history-view copy cannot restore the shared-account setup.

| Verification | Result |
| --- | --- |
| Old decoder accepts the history-view copy | Passed |
| Current decoder accepts the same copy | Passed |
| Each card's complete history equals the original | Passed: 3 DAT, 3 EMA, 3 CAWELON |
| Restore original configuration in memory and encode with current source | Exactly reproduces every original byte |
| Altered checksum | Rejected by old decoder with `WORKSPACE_CHECKSUM` |
| Original input and preserved copy | Byte-identical and unchanged |

Original: 10,103 bytes, SHA-256
`3ebf36e36f94d12fb6b09387c723a3144933918c720ab26cd78a7c1d6ab5d4bc`.

History-view copy: 9,983 bytes, SHA-256
`07039033ae5e30e5c3b7fdfccbf8c33afc6d291f2dceec93a64b757965104795`.

This establishes offline file recovery only. Nothing was applied to the user's
loaded page. Native browser restoration, MetaMask switching and a complete
previous-release rollback remain separate checks. A later release plan must use
a shared-account-capable baseline or deliberately document the history-only
recovery limitation. Do not silently clear live configuration or modify the
original backup to make old software accept it.

The initial analysis script had a quoting error and an incorrect old rehearsal
HTML path. These were corrected before accepting the result; they are not
application failures. The successful source comparison was reused, and the
corrected compatibility/recovery methods exited successfully.

## Evidence

- [Old/new backup compatibility](evidence/2026-11-03-legacy-recovery/compatibility-summary.json)
- [Exact old-source comparison](evidence/2026-11-03-legacy-recovery/source-verification.json)
- [Recovery verification](evidence/2026-11-03-legacy-recovery/recovery-summary.json)
- [Recovery method](evidence/2026-11-03-legacy-recovery/recovery-method.mjs)
- [Execution notes](evidence/2026-11-03-legacy-recovery/execution-notes.json)
- [Checksums](evidence/2026-11-03-legacy-recovery/SHA256SUMS.txt)

The two account-bearing backup files stay in Downloads and are excluded from
repository evidence and the public-review ZIP. No wallet/RPC action, signing,
transaction, key access, dependency installation or GitHub write occurred.
The sealed `bf690f3` review package remains unchanged; this later observation is
a supplemental record, with no application-source change.
