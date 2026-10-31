# Exact historical balance rows for spreadsheet review

Item 594. Source: 6da1674.

A reviewed history search can export every native/token balance row from its matching observations. CSV includes the complete query, original archive index, identity, block/hash and historical-only flags. Filtering by one token selects whole observations; other holdings are explicitly included. A dedicated scope row retains conditions even for zero-match offline exports. Numeric text receives a leading apostrophe to preserve long decimal digits without formulas; amounts are never rounded, converted to market values or summed across assets. Missing-code balances remain blank with code-missing status, distinct from quoted zero.

CSV generation is bounded at 16 MiB, including expansion from repeated long origins. Files use UTF-8 BOM, quoted cells and CRLF. UI exports require unchanged search conditions and archive; they do not mark a full JSON backup. The UI explains that CSV is not restorable and that original JSON should be kept. The offline command produces the identical bytes:

    node scripts/inspect-portfolio-history.js csv history.json --min-block 20 --order newest

144 related checks passed (3683.8152 ms); 148 focused native browser cases passed (29896 ms). [Evidence](evidence/2026-11-01-history-balance-csv/) includes uint256 maximum, a block above the JavaScript safe-integer range, zero/unknown token rows, a zero-match scope and exact UI/API/CLI agreement. Captured native download adapters verify emitted content, not durable saving by the operating system.

Full-suite rerun remains pending after fixture-route maintenance. Last full passes: wallet d253e8d (15,720); browser b3254c9 (986). Existing server unchanged. No external RPC, real-wallet connection, signatures, transfers, approvals, secret retrieval, publication or deployment.
