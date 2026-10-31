# Preserve validated plain sources and save a bundle review separately

Items 542–543. Source: ecb8bc1.

## 542: Preserve plain settings, portfolio and rehearsal source pairs

The existing source-bundle panel and offline command now accept the eight supported plain source families, including mixed plain/checksummed pairs. V2 bundles retain both exact UTF-8 source strings with their recomputed text comparison. Reviews record the absence of an internal checksum and preserve rehearsal simulation-only scope. Legacy original-only API behavior and checksummed V1 preparation output remain unchanged. Valid sources with different content or format can be preserved; a faithful comparison does not mean the sources match.

Before extraction, both embedded sources are decoded again and their exact hashes bound to a fresh comparison. Altered claims, substituted sources, an incompatible comparison version or auxiliary-only documents cannot authorize extraction. V2 exposes a separate sourceFilesAvailable flag; legacy originalsAvailable remains false for plain-containing pairs. Source contents are included only in an explicitly acknowledged bundle or source extraction. No automatic import occurs. Limits remain 24 MiB combined source text and 48 MiB bundle text.

## 543: Save only the completed bundle verification result

After reviewing a bundle, a separately acknowledged action saves the review JSON without the embedded source text, addresses, balances or note bodies. It retains schemas, counts, exact hashes and mismatch conclusions. Failed comparisons can be recorded while source extraction remains disabled. Imported copies of a review cannot supply encoder or extraction authority. Replacement, cancellation and disposal clear acknowledgement; a callback that replaces the review cannot publish stale save-success feedback. The review is not a restore file and is not encrypted. Keep the source bundle separately for reproduction.

Offline commands:

`node scripts/wallet-saved-bundle.js create before.json after.json`

`node scripts/wallet-saved-bundle.js check bundle.json --json`

`node scripts/wallet-saved-bundle.js extract bundle.json before`

Output is written to stdout; exit 0 is a faithful accepted bundle, 2 is a comparison mismatch, and 1 is invalid input. Extraction on mismatch emits no source text.

All 23 focused cases passed (11895.0287 ms), followed by 114 related cases (17139.9207 ms). A scoped native Chrome run passed all 109 file-read UI cases, including real File/DataTransfer selection, separately acknowledged receipt saving, exact source downloads and rejected extraction. [Evidence](evidence/2026-11-01-wallet-source-bundles/) includes eight source-family round trips, V1 compatibility, successful/mismatching receipts and six actual offline CLI checks. The first test run contained one fixture mutation error against a deliberately frozen history object; the fixture was cloned and the corrected focused suite passed. Its failed log is retained.

Last full browser checkpoint remains a2eb7e5 (950 cases); last full-wallet checkpoint remains d253e8d (15,720 tests). Scoped checks do not establish full browser coverage, a user-tab connection or OS file-picker behavior. No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or existing-server restart occurred. These are two completed product capabilities; test counts do not add product items or establish a mainnet-readiness percentage.
