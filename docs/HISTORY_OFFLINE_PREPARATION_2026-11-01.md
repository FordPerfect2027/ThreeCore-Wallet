# Prepare consolidated and pruned history candidates offline

Item 593. Source: 7cc02d7.

The new local command prepares the same archive-consolidation and scoped-cleanup candidates as the UI, without importing or modifying anything. It emits a complete candidate only after all inputs pass; failed checks emit no partial JSON. Source files remain unchanged. The command limits file counts, individual/combined bytes, UTF-8 decoding and unique observations, and rejects wrong-card records, conflicts, empty batches and whole-history/order-only removal scopes. Each file is read through one bounded handle with before/after metadata checks. No network or wallet adapter is used.

Examples (stdout contains a candidate; review before importing):

    node scripts/prepare-portfolio-history.js combine DAT first.json second.json
    node scripts/prepare-portfolio-history.js prune history.json --max-block 100

The prune example removes matching observations only from its emitted candidate; it does not delete source files. npm alias: portfolio-history:prepare. Exit 0 means local preparation succeeded, never authenticated evidence or mainnet readiness. Exit 1 rejects the operation without partial stdout.

94 related checks passed (3711.1519 ms), including actual command launches, exact API/CLI equality, immutable originals, Unicode filenames, capacity/size/UTF-8 failures and strict argument handling. [Evidence](evidence/2026-11-01-history-offline-preparation/) preserves original inputs, both candidate outputs and a rejected full-history scope. No browser rerun was needed for this CLI-only change; latest focused browser checkpoint remains 4ee99df (147 cases). Full-suite rerun remains pending after fixture-route maintenance; last full passes: wallet d253e8d (15,720), browser b3254c9 (986).

No existing-server restart, external RPC, signature, transfer, approval, secret retrieval, publication or deployment.
