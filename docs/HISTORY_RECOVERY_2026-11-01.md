# Real balance-history recovery and saved-file comparison

This continuation builds on `07041f00efdb503cb76a06fbe12e5531cb380930`.
It covers the read-only wallet's settings, token lists and saved balance
observations. Transfer archives, period reports and other separately saved
collections are outside this backup's scope.

## What changed

After selecting a valid plain workspace backup, the operator can choose
**選んだファイルと現在の内容を照合**. The application compares all three cards'
normalized settings, token lists and complete saved observations with the
checksum-verified file. The verdict reports settings and history separately,
including file/current record counts, without displaying account values.

The comparison does not merge, replace, connect or query a wallet. A successful
merge is not necessarily an exact match: older records retained in the current
history correctly produce a difference. Equal counts with different block,
balance or other observation data also do not match. Unknown balances remain
different from known zero. The comparison is about the supported data contents,
not whitespace, source-file byte identity, ownership or current balances.

The button is unavailable before a verified file read, during pending file work,
after cancellation, and after a rejected replacement file. Editing the staged
JSON or changing the workspace retires the verdict. Restoration, undo and a new
file read also clear it. Publication is guarded against cancellation or disposal
inside the application adapter. Encrypted files and named checkpoints continue
to use their existing reviewed restore procedures; this comparison control is
for the selected plain workspace file.

## Intended-PC observation

On November 1, Microsoft Edge at the existing `127.0.0.1:4231` origin reconnected
the previously permitted account that the operator identified as Account 1.
The EMA registered contract was read twice and each complete balance observation
was explicitly added to history. The two observations are not a scan of the
blocks between them and are not transfer-history coverage.

The following were actually exercised, with real downloads retained locally:

- Save one observation, then add a second. The backup-status display changed to
  indicate that another save was needed.
- Save a 3,212-byte workspace file with two EMA observations; DAT and CAWELON
  remained unconfigured and had zero observations.
- Open an empty Wallet tab through the existing same-origin links, select the
  downloaded file through the ordinary file chooser, preview, and cancel.
  The empty destination remained unchanged.
- Review and restore settings plus both observations. The destination remained
  disconnected. Re-export produced a byte-identical 3,212-byte file, independently
  checked from disk with both original and re-export checksums validated.
- Reload only that verification tab after preserving both files. The new
  comparison control reported a difference before restore and a complete match
  after the reviewed restore.
- Select a separate, deliberately damaged test copy with a wrong checksum.
  It was rejected, comparison was disabled, and the two restored observations
  were retained. The original files were not modified.
- Re-select the valid file; undo the restore to the original empty destination;
  observe a mismatch; restore again and observe a match.
- Save a new named browser checkpoint containing the two observations, while
  retaining the earlier settings-only checkpoint and file copies.

The existing port 4231 server, started on October 30, was not restarted. Older
working tabs and rehearsal data were not reloaded. The browser-control session
was recovered during this work without operator intervention. Live account
addresses, balances, file copies and screenshots remain on the operator's PC.
No signature, transfer, approval transaction or private-key retrieval occurred.

## Separately saved transfer archive

The same permitted EMA account also completed a bounded read of blocks
53,373,485 through 53,375,484, inclusive: 2,000 blocks. The provider returned zero
events. This is a successful empty query result within that scope, not proof of
no activity or of complete provider coverage. No positive control query or
second-provider completeness check was performed in this continuation.

The snapshot was saved separately and added to a one-record transfer archive.
Both actual files passed their existing offline parsers and checksums. After
explicit disconnect, the in-memory transfer archive was cleared while the two
balance observations remained. Ordinary file selection, preview cancellation,
re-selection and confirmed archive replacement worked while disconnected.
The re-exported transfer archive matched its original byte-for-byte (1,172 bytes).
These private account files remain local and are not included in the evidence
directory. This is distinct from the plain workspace comparison feature and
does not cover all the other saved report collections.

## Verification

- The complete local wallet/HTTP regression run passed 16,425 tests, with no
  failures, cancellations or skips. This includes the focused cases below;
  the counts must not be added as distinct features or a readiness percentage.
- 1,305 focused workspace/checkpoint/encrypted-backup tests passed.
- 1,005 browser UI cases passed in two isolated profiles using synthetic
  providers without external RPC. The real-wallet observations above are
  separate evidence from those automated fixtures.
- New regressions cover equal-count content differences, extra retained history,
  zero versus unknown balance, normalized configuration, invalid input, and
  revoked or silently changed file input.
- Logs and their manifest are in
  [the local evidence directory](evidence/2026-11-01-history-recovery/).

This completes the exercised **one-account balance-history backup/restore** path.
It does not complete three distinct public-testnet account acceptance, recovery
of every separately saved collection, an independent audit, or release approval.

The operator requested collecting subsequent changes and evidence locally before
one combined GitHub update. This continuation has not been pushed and has no
new remote CI result; the tests reported here were run on the PC.
