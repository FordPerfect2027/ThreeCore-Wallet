# Inspect multiple original wallet save files in the browser

Item 517. Source: `a4d6535`.

The file-reading panel now has an explicit, read-only batch workflow for 1–20 original period, library, report, report-history or report-set JSON files. It reads only after Start, limits individual files to 16 MiB and the selection to 64 MiB, rejects ambiguous/nonportable filenames, and computes each exact UTF-8 text hash before internal format/checksum validation. Validated originals, declared-only auxiliary documents, invalid files, unavailable hashes and pending files remain distinct. It does not restore records, sum holdings, contact a provider or alter storage.

Stop during verification retains completed rows and marks the rest pending. Clear, replacement and disposal retire late work. A complete SHA256SUMS list is available only when every selected file has been hashed; malformed content may still have a hash, which does not establish validity. Partial JSON receipts remain exportable. A fresh acknowledgement is required for each plaintext download, and rejected/async/throwing save callbacks cannot claim success. Neither receipt nor manifest authenticates an author or contains restorable original evidence. External checksums are not compared by this workflow. Retain the separately saved originals with their exact filenames.

Native File reads use the existing bounded shared file service; its per-read deadline remains 30 seconds. The inspection stage has a separate 120-second deadline. These are not a claim that loading and inspection together always take at most 120 seconds. The local files are not an atomic filesystem snapshot.

## Validation

173 focused checks passed (3075.7107 ms). All 1,076 related save-file, file-reading, manifest, original-format and batch checks passed (34982.2165 ms), with zero failures, skips or cancellations. Tests include stale completion, cancelled verification, input capture, limits, failed hash calculation, invalid originals, auxiliary declarations, owned-receipt exports, picker dismissal and failed downloads.

Native Chrome passed 934 cases across two reconciled isolated profiles with cleanup. New cases use real File/DataTransfer objects, the actual panel and captured downloads to verify original/auxiliary/invalid separation, exact hash lists and partial cancellation. A storage sentinel remains unchanged. These tests do not establish control of the user's existing tab or operation of the OS file picker.

[Evidence](evidence/2026-11-01-wallet-saved-browser-batch/) includes byte-identical copies of five original formats plus corrupt and auxiliary controls. The browser-shared API generates the seven-row receipt and hash list under Node; the actual existing CLI consumes that list and agrees on every raw hash, validation status and inspection (browser invalid maps to CLI unreadable). A cancellation capture retains two checked and five pending rows and refuses a partial manifest. Original bytes are rehashed unchanged. The separate native UI log establishes browser behavior; these API-generated artifacts are not described as captured OS downloads. Committed artifact bytes are verified against their hashes.

This complete workflow counts as one item. Last full-wallet checkpoint remains d253e8d (15,720 tests); this source has the related and native validation above. No signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart occurred. Counts are not mainnet-readiness percentages.
