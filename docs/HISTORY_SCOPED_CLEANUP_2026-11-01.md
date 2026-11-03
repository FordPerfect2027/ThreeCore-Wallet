# Scoped history cleanup with explicit review and recovery

Item 590. Source: 7722aca.

A full 64-record archive can now be organized without repeatedly deleting individual selections. A completed search can prepare the exact matching subset for removal. The preview lists original archive positions, accounts, chains, origins and blocks; a separate checkbox and apply action are required. Unscoped/order-only filters, empty matches and full-history removal are rejected. The existing separately confirmed clear-all flow remains explicit.

Removal preserves the exact complement in original archive order. Every application is tied to the reviewed archive, revision and exact criteria; changed filters, history, confirmation and lifecycle invalidate the proposal. A single-use synchronous handoff is verified and uncertain results are not reported as success. The full before-change archive can be downloaded and restored through existing recovery controls. This only organizes local saved observations; it does not move assets or alter blockchain records.

943 history-related checks passed (13431.1048 ms). 145 focused native browser cases passed, including real filter/checkbox interaction and exact recovery. [Evidence](evidence/2026-11-01-history-scoped-cleanup/) records a five-observation source, reverse-sorted deletion of original indices 2 and 1, the exact three-record complement and recovery bytes. The initial failing test dereferenced a detached test DOM after disposal; its reference was captured before disposal without changing assertions.

Full-suite rerun remains pending after the documented fixture-route maintenance. Last full passes: wallet d253e8d (15,720); browser b3254c9 (986). Existing server unchanged; no external RPC, wallet signature, transfer, approval, secret retrieval, publication or deployment.
