# Complete filtered discrepancy export — item 435

Source revision: `f420e7d`. This is one coherent feature spanning the core encoder, browser download and offline query command; its tests and UI controls do not add separate development items.

The report and evidence review panels can save all matching discrepancy paths in one JSON artifact, independently of the displayed 40-row page or selected value. Original difference indices, normalized query, total and matched counts, source report SHA-256, and the complete verification summary remain attached. Empty matches still produce an explicit result with the global mismatch state. Receipt and embedded-source comparisons retain independent targets and totals. This file lists locations and kinds; selected full values remain a separate export.

The offline equivalent is `node scripts/query-rehearsal-differences.js FILE --all [--path TEXT] [--kind KIND] [--evidence receipt|source]`. `--all` cannot be combined with `--page`. Exit 2 continues to report a global discrepancy, including a zero-match filter. Invalid requests produce no partial output. Existing paged output and default parser shape remain compatible.

The encoder accepts only authentic in-memory review identities, bounds UTF-8 output to 6 MiB and escapes directional controls without losing the original path. Browser exports retain their review after failed delivery and cannot overwrite a newer filter, page or cleared view. Generated inspection output is identified as a viewing artifact when mistakenly selected for restoration.

## Validation and evidence

- Focused API/UI/CLI: 97 passed; zero failed/skipped/cancelled; 2,102.7592 ms.
- Related rehearsal/server: 1,357 passed; zero failed/skipped/cancelled; 44,929.1498 ms.
- Native Chrome: 863 passed with a synthetic provider and no external RPC. Existing native filtering coverage now also saves all matches, an empty match and independent evidence targets.
- Five actual offline captures match the core encoder byte for byte. They save 103/103, 100/103 and 0/103 report differences, 87/87 receipt differences, and 103/103 embedded-source differences. Input files are unchanged.

[Evidence and checksums](evidence/2026-10-31-complete-difference-query/) include exact synthetic inputs, outputs, capture metadata and completed logs. Source and tests were frozen during validation. The latest full-wallet run remains the item 431 checkpoint, 14,726 passing tests. Checksums show file consistency rather than authenticity. No real wallet operation, external RPC, key access, existing-server restart, publication or deployment occurred; no reconnection of the user's browser is claimed.
