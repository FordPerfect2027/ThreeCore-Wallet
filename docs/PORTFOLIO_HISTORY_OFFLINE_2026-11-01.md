# Inspect saved portfolio history without a browser connection

Item 582. Source: 7181885.

The offline command reads one local portfolio-history archive (up to 1 MiB) and supports query, subset, individual record, source-included comparison and timeline output. All results use the same strict history and comparison modules as the browser. This is one complete offline workflow, not five separate completion items. It neither writes source files nor connects to a wallet or RPC. Output includes the selected public addresses and balances.

Query results retain zero-based original archive indices despite sorting. Record and compare use those indices. Token filters distinguish known zero, unknown balance and not-observed contracts. Subsets retain whole matching observations and require an explicit filter; an empty subset is rejected. Reversed or incompatible pairs and invalid positions produce no partial output. UTF-8 decoding, file identity checks and size bounds use the shared read-only local reader.

Examples (run from the repository root):

    node scripts/inspect-portfolio-history.js query history.json --order newest
    node scripts/inspect-portfolio-history.js subset history.json --min-block 53159243 --max-block 53161242
    node scripts/inspect-portfolio-history.js record history.json --index 0
    node scripts/inspect-portfolio-history.js compare history.json --before 1 --after 0
    node scripts/inspect-portfolio-history.js timeline history.json

Use query first to obtain source indices. Output goes to stdout; save it to a separate destination if needed. Exit 0 means the requested local operation completed; exit 1 means invalid input, an empty subset or an incompatible pair. Neither exit code certifies observation authenticity, current balances, transfers or profit.

203 related tests passed (3290.2714 ms). Five actual child-process CLI operations matched their APIs byte-for-byte and left the input directory unchanged. Negative checks cover exact indices, bad/duplicate arguments, missing files, directories, malformed JSON, BOM, invalid UTF-8, size overflow, empty selection and incompatible comparisons. [Evidence](evidence/2026-11-01-portfolio-history-offline/) retains each output and actual CLI status. No browser rerun was needed for this standalone command; latest focused browser checkpoint is 3184850 (137 cases), full browser 431dcfd (980 cases), full-wallet d253e8d (15,720 tests).

No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred.
