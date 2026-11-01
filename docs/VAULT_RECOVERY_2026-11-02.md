# Intended-PC archive retention and saved-collection recovery

This continuation uses local source `593916348fadc822de5d6811d694b1f3ce90a183`
for the retention and recovery exercise, followed by the collection-guide fix
in the commit containing this record. The exercise began on November 1 and the
guide correction finished on November 2, 2026 (Japan time). Changes and evidence
are being collected locally at the operator's request; nothing from this
continuation has been pushed or submitted to remote CI.

## Actual Microsoft Edge observations

The existing loopback server at port 4231 was retained. A separate, backed-up
verification tab loaded the local code; the older working and rehearsal tabs
were not reloaded. Ordinary file-chooser actions, previews and explicit apply
controls were used. No new transfer-history query was run.

The previously permitted Account 1 EMA context on Base Mainnet was restored
from its saved settings/history file, containing two balance observations.
The saved archive contains one record for blocks **53,373,485–53,375,484**
(2,000 inclusive), with zero recorded events. It is not a complete-account
history or a fresh chain observation.

After explicit connection, ordinary disconnect retained the accepted archive
and allowed an offline JSON download. Explicit reconnect followed by the
three-token protective stop did the same. A blank account input refused record
selection but still allowed saving the original, context-bound archive. The
three resulting downloads matched the original exactly: 1,172 bytes, with
valid internal checksums. Re-selecting the workspace backup after the stop
also confirmed that all three cards' settings/history matched that backup:
DAT 0, EMA 2, CAWELON 0 observations. Those zeros are history counts, not balances.

The accepted EMA archive was then captured into the three-token working copy,
reviewed and saved as one named PC record. Both the working bundle and the
whole saved-list backup were downloaded before reloading only the verification
tab. The named record survived that reload. Re-importing the collection after
review reported **0 additions and 1 duplicate**; the persistent list remained
at one record and revision 1. No stored record was deleted or purged.

A working-bundle file preview was cancelled without populating the empty
working copy. A subsequent reviewed import succeeded. With matching account
settings restored, the bundle could stage an individual EMA card preview,
which was applied separately. The three re-exported formats matched their
original downloaded bytes:

| Format | Bytes | SHA-256 of both original and re-export |
| --- | ---: | --- |
| Individual archive | 1,172 | `e833b894da0d1930bced32eaa16da88a73c1456d0c85887717bb31a0d650225e` |
| Three-token working bundle | 1,679 | `c09aec2ece0400939d2e8c657d321d8d17e1c2f4528692bf8cb2d6a7d49d5efc` |
| PC saved-list backup | 2,356 | `07b861f7f35cb119d2680b68c5f384610a73628e89a1c3cd8fd7ca040b966296` |

The actual account files, private comparison report and screenshots remain in
the operator's Downloads directory. They are not copied into this repository.
The collection was re-imported into an existing list: **import into an empty
persistent database was not exercised**. The working-copy import did start
empty. This distinction matters when interpreting recovery coverage.

## Defect found and corrected

The app's generic saved-JSON inspector rejected its own whole-list backup with
`FILE_INSPECTION_UNSUPPORTED`, even though the dedicated collection decoder
validated it and the dedicated restore control worked.

The inspector now recognizes `threecore.transfer-vault-collection.v1`, uses
the existing strict collection decoder/checksum verification, and directs the
operator to the **PC saved list** and **collection backup file** control.
It separately counts saved entries, archived entries, archive references,
record references and event references. It does not publish labels, identifiers,
account addresses, amounts or timestamps in the inspection receipt. Repeated
references remain repeated counts, not extra independently verified history.

The destination action opens the saved-list section. If the list has not been
read, it focuses the explicit refresh button. After the list is read, it
focuses the collection file selector. Merely navigating performs no storage
read/write, wallet request, file selection, preview or import. Existing file
limits and confirmation requirements remain in place. This was observed in
the intended Edge tab with the actual 2,356-byte file; the saved list remained
one record at revision 1 and the import preview remained empty.

## Verification and remaining gates

- Related saved-file and vault regression: **938 passed**. The final navigation
  adjustment additionally passed **71 focused tests**, overlapping the prior
  suite rather than adding 71 product features.
- Final native-browser file-read focus: **154 passed**, with isolated browser
  shutdown/cleanup completed. These use synthetic providers and temporary
  profiles, not the user's wallet. The full browser suite and full Node suite
  were not repeated for this change.
- Tests cover corrupted checksums, invalid collection structure/duplicate IDs,
  nested data changes, metadata changes with unchanged counts, cancellation
  during hashing, comparison/bundle/batch export, prior-format compatibility,
  and navigation before/after reading the list without an automatic import.
- The earlier archive-retention revision's full regression and full browser
  results remain documented in its own record; they are not results for this
  subsequent change.

Raw logs, a synthetic collection example, its generic inspection and checksums
are in [the evidence directory](evidence/2026-11-02-vault-recovery/). Initial
failed checks are retained and explained there, including the navigation
problem exposed by the browser test before the final correction.

No signing, transfer, approval transaction, seed/private-key retrieval, server
restart or GitHub publication occurred. One real Account 1/EMA recovery
exercise does not close the three-distinct-account public-testnet acceptance
gate. Independent review and a release decision remain incomplete; no new
completion percentage is asserted.
