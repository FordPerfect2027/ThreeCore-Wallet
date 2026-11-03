# Reproduce saved history searches offline

Item 597. Source: a87cf5a.

Both offline history commands accept --query-file conditions.json as the sole filter source. Saved criteria can reproduce queries, subset JSON, exact-balance CSV and scoped-cleanup candidates against an explicitly supplied current archive. Mixing a preset with command-line overrides is rejected, so the applied scope is unambiguous. Query files use bounded stable-handle reads, fatal UTF-8 and the strict configuration decoder. Neither source file is rewritten; invalid presets and failed scopes emit no partial output. A changed archive can produce different matches and zero results never become a successful cleanup candidate.

21 related tests passed (3469.7094 ms), including actual processes for all four operations, exact shared-API outputs, Unicode filenames, source preservation and malformed/oversized/preset-override failures. [Evidence](evidence/2026-11-01-history-query-replay/) contains original history/conditions and all four independently reproduced outputs. This CLI-only change did not require a browser rerun; latest focused browser remains 5d0b6e9 (150 cases).

Examples:

    node scripts/inspect-portfolio-history.js query history.json --query-file conditions.json
    node scripts/prepare-portfolio-history.js prune history.json --query-file conditions.json

Full-suite rerun remains pending after fixture-route maintenance. Last full passes: wallet d253e8d (15,720); browser b3254c9 (986). No existing-server restart, external RPC, signature, transfer, approval, secret retrieval, publication or deployment.
