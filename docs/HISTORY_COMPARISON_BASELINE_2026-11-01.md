# Use a saved history observation as the comparison baseline

Item 591. Source: ae73567.

A selected saved observation can now populate the card's balance-comparison baseline directly, avoiding export/copy/reimport. It stages an exact canonical report and focuses the comparison input. Comparison still requires the explicit button; the displayed observation, token list, saved history and provider read count are unchanged. If a target is already present, mismatched agent/account/network/site, reversed heights and same-height conflicts are rejected before replacing the prior baseline. A baseline can also be staged before a target exists.

Staging retires delayed file reads and invalidates old comparison exports. Captured primitive data, synchronous confirmation, selection/revision checks and focus lifecycle checks prevent stale or asynchronous callbacks from claiming success. Busy card reads cannot accept the handoff. Invalid input preserves the previous baseline text.

141 related checks passed (1624.6902 ms); 146 focused native browser cases passed (28974 ms). [Evidence](evidence/2026-11-01-history-comparison-baseline/) captures the exact baseline, comparison file and unchanged archive. The native case confirms real focus, a separate comparison action and no extra mock read.

Full-suite rerun remains pending after fixture-route maintenance. Last full passes: wallet d253e8d (15,720); browser b3254c9 (986). Existing server unchanged. No real-wallet connection, external RPC, signature, transfer, approval, secret retrieval, publication or deployment.
