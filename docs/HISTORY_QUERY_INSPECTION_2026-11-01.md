# Recognize saved queries in the shared file inspector

Item 596. Source: 5d0b6e9.

The shared saved-file inspector, mixed-file batches, difference review and offline inspector now recognize history-query configuration using its strict decoder. Query filter addresses are never counted as configured wallet accounts, token holdings or balance observations. No agent association is inferred from a chain/account filter. Inspection summaries omit raw filter values while reporting the exact text digest, structure-only validation and explicit false authority/authenticity flags.

Destination guidance explains that this is a reusable search condition, not a history backup, and can navigate to the cards without importing the file, filling filters or requesting wallet access. Mixed batch evidence can be independently recomputed while retaining its structure-only status. Invalid query values, extra fields, forged authority and oversized inputs remain rejected.

39 related checks passed (4690.2449 ms); 150 focused native browser cases passed. [Evidence](evidence/2026-11-01-history-query-inspection/) includes the source query, structure-only inspection, mixed batch evidence and independently recomputed review. Actual CLI output is byte-identical to the API; exit 2 explicitly distinguishes structural inspection from a checksummed original. The native test confirms card navigation with unchanged query inputs and no wallet calls.

Full-suite rerun remains pending after fixture-route maintenance. Last full passes: wallet d253e8d (15,720); browser b3254c9 (986). Existing server unchanged; no external RPC, real-wallet connection, signatures, transfers, approvals, secret retrieval, publication or deployment.
