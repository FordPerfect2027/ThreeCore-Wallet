# Actual downloaded-file recovery — November 2, 2026

The existing saved files were restored through the Wallet's browser controls
in a new isolated browser profile on the intended Windows PC. The source under
test was `0405370b38c43e599dda0b475c88e1ec1850034a`; application code was unchanged
from `34d1731`. This extends the earlier format-only checks to native browser
storage and complete Wallet screens without operating the user's open tabs.

| Check | Input and result |
| --- | --- |
| Saved transfer collections | Three downloaded files, two distinct byte contents. Both restored into empty native IndexedDB stores after review. Preview/cancel left the store empty; importing the same collection again added no duplicate. |
| Collection persistence | A second browser process using the same newly created profile retained both complete collections. Re-exported content was byte-identical to its input; records were not implicitly applied to the working token cards. |
| Complete Wallet backup | Nine downloaded files, eight distinct byte contents. All eight restored their exact settings, token lists and full balance histories after file verification and explicit review. Preview and cancel left the initially empty cards unchanged. |
| Wallet checkpoint persistence | After the first browser process exited, a second process loaded the native IndexedDB checkpoints. All eight required explicit review/apply, restored every saved field, and passed the application's own three-card file comparison. No wallet permission was restored; provider calls remained zero. |
| Actual browser download | A separate run restored the saved two-account workspace with ten historical observations, restarted the test browser, restored its checkpoint, then pressed the normal backup button. The browser created a real JSON file in the run's separate download directory. Reading that file from disk verified its checksum and full content against the original. |

The files overlap and include original synthetic fixtures. Nine files are not
nine wallets, and counts across versions are not additional on-chain observations.
The receipts identify each source by digest and give per-file history counts.
The native-download case overlaps the eight-file recovery check; it is additional
download-path coverage, not another independent feature or wallet.

## Failure retained and corrected

The initial and diagnostic workspace runs passed all eight initial restores but
failed all eight restart restores with `Restore must be reviewed`. The test's
state-inspection helper clicked the history-export button during an active
workspace review. The Wallet intentionally cancels pending workspace reviews
on token-card clicks. Diagnostic state showed a valid preview before that click
and a cancelled preview afterwards.

The corrected test reads visible fields and history lists without clicking
anything while review is pending. Full history export/comparison occurs only
after applying the restore. All eight restart cases then passed. No application
code, confirmation requirement or protection was changed to obtain this result.
Failure messages and original private-log hashes remain in the evidence.

## Boundaries and retained files

Each run used an ordinary installed browser in headless mode, with extensions
disabled, a new disposable profile and a temporary loopback test server. Both
browser processes in a run shared only that new profile. The actual native
IndexedDB implementation was used. The full Wallet fixture contains synthetic
providers, but asserted zero provider calls throughout these file operations.

Files entered the actual `File`/`FileReader` handlers through `input.files` and
change events. The OS file chooser was not exercised. The collection test
captured prepared export bytes; the separate workspace download test used the
default application Blob/anchor adapter and verified the browser-created file
on disk. Its own profile was configured only with a separate download directory
and no Save As prompt; no permission or security restriction was disabled.

All temporary browsers, profiles and test servers were closed/removed by their
own harness. Source files were rehashed after the runs and again when collecting
evidence. The existing port 4231 server, user browser profile, wallet and open
tabs were not used or modified.

Private source files, raw browser pages and the downloaded JSON remain in
Downloads under the `ThreeCore-private-empty-store-20261102`,
`ThreeCore-private-workspace-20261102-v3`, and
`ThreeCore-private-native-download-20261102` directories. The failed attempts
are retained separately. [Public-ready receipts and method snapshots](evidence/2026-11-02-actual-file-recovery/README.md)
omit private account values and raw backups. Their hashes identify the private
inputs but do not make those inputs publicly inspectable.

This completes the isolated actual-file/empty-store and restart checks described
above. It does not complete the original-profile OS chooser workflow, a live
MetaMask three-token acceptance sequence, real-wallet version return, independent
review or the release decision. It is not a measured progress percentage.
