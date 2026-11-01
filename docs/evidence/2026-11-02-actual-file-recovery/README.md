# Actual-file recovery evidence

Source under test: Wallet 0405370b38c43e599dda0b475c88e1ec1850034a.

See [scope and interpretation](../../ACTUAL_FILE_RECOVERY_2026-11-02.md).

Receipts contain source digests, per-phase results and cleanup. Private source files and browser pages are excluded; hashes do not make unavailable private bytes independently inspectable. The original downloaded collection includes a synthetic fixture as well as actual-account data. Do not count every file as a different live wallet.

Browser methods were executed by the accompanying runner snapshots. Absolute local paths in runner snapshots are replaced by <WALLET_REPOSITORY>, <PRIVATE_INPUT_DIRECTORY>, and <METHOD_DIRECTORY>. To reproduce with authorized local copies, replace these placeholders and the exact input/body/output filenames with their local locations; keep the source pin, no-overwrite output directory and isolated-profile safeguards. These files are preserved method evidence, not a newly supported application command. The embedded sourceRevision describes this run, not a future rerun.

Each runner starts an isolated loopback test server and extension-free headless installed browser. Two separate owned processes reuse only their new disposable profile. File/FileReader events use real downloaded bytes. Native IndexedDB stores the restored entries. No user browser profile or original server is used. Browser test providers are present for the full Wallet fixture but receive zero calls.

The native-download case uses the default application Blob/anchor download adapter and its own download directory in the temporary profile's preferences. No automatic-download permission or browser security setting is weakened. Node then reads and decodes the actual browser-created file. The OS file picker and Save As dialog are not exercised.

Two failed workspace attempts are retained by digest and failure text in method-provenance.json; the cause was a test action cancelling the review. The corrected method passed without changing the application or bypassing review. The original vault runner's sourceFilesUnmodified flag is derived from successful phases, but the run exited successfully after explicit rehashing; this collector independently rehashes all originals again before recording success. Later runners track rehash completion separately and include it in allPassed.
