# Save and reuse history search conditions

Item 595. Source: 15ff3b9.

History search conditions can now be saved and reused as a bounded, configuration-only JSON file. The schema contains normalized account, chain, origin, block bounds, order and token-state criteria, with explicit false authorization flags. It contains no observations or balances and is not a history backup. Strict parsing rejects duplicate/unknown keys, changed authority flags, malformed criteria and files above 64 KiB.

Selecting a file only fills the review textarea. A separate explicit action copies validated conditions into the filters and searches the current archive; it does not import records. The UI warns that the same conditions can yield different results against a different archive. Saving a query leaves the full-history backup marker unchanged. Invalid files preserve the draft and current conditions. Cancellation, editing, other file operations, search and disposal retire delayed file completions.

159 related checks passed (3245.3634 ms); 149 focused native browser cases passed. [Evidence](evidence/2026-11-01-history-query-files/) records exact query round-trip, the original three observations and the resulting two-observation subset, with no archive mutation. Native integration confirms file staging, explicit use and result focus.

Full-suite rerun remains pending after fixture-route maintenance. Last full passes: wallet d253e8d (15,720); browser b3254c9 (986). Existing server unchanged; no external RPC, real-wallet connection, signatures, transfers, approvals, secret retrieval, publication or deployment.
