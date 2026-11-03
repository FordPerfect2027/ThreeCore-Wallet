# Consolidate multiple saved history archives

Item 592. Source: 4ee99df.

A separate multi-file picker now combines up to 16 saved history archives, each at most 1 MiB and at most 4 MiB together, into a candidate in the existing import field. Files are read sequentially under a shared 30-second deadline; exact duplicates are counted and removed. File order and each archive's observation order are retained. One malformed, conflicting or other-card archive rejects the entire candidate. More than 64 unique observations and all-empty batches are rejected without truncation. A leading UTF-8 BOM follows the established archive policy.

The current history remains unchanged until explicit preview and apply. Size/count/name limits are checked before reading, declared and actual byte lengths must match, UTF-8 decoding is strict, and cancellation or a changed destination retires late results. Individual-report batching retains its original stricter limits. Both batch selectors share busy/cancel controls.

106 related checks passed (3028.4318 ms); 147 focused native browser cases passed. [Evidence](evidence/2026-11-01-history-archive-batches/) includes two original archives, their exact three-record candidate and four-record merge preserving an existing observation. A native File/DataTransfer selection is a browser integration test, not verification of an operating-system file picker or a real wallet connection.

Full-suite rerun remains pending after fixture-route maintenance. Last full passes: wallet d253e8d (15,720); browser b3254c9 (986). Existing server unchanged; no external RPC, signatures, transfers, approvals, secret retrieval, publication or deployment.
