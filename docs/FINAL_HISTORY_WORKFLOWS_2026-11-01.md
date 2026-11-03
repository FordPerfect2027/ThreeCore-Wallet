# Final history comparison and retention workflows

Items 598–600. Fixed tested source: 3fd2836.

598. A reopened comparison can export either included observation as an exact standalone portfolio report and explicitly stage one in the baseline field. Reuse requires a separate comparison. Invalid selections, changed baseline input, cleared/disposed results and unconfirmed download adapters cannot export stale data or claim success. Current displayed observations and history are not replaced.

599. The card can find the newest strictly earlier saved observation matching the displayed agent, account, chain and site, using exact BigInt block ordering. Equal-height, future and other-identity records are excluded. It stages the predecessor and selects its original archive position; no additional provider read occurs and comparison remains explicit. Missing targets/predecessors or stale/asynchronous handoffs cannot claim success.

600. History retention can prepare keeping the newest 1–64 matched observations per complete identity, preserving every unmatched row and original archive order. The preview lists only the records proposed for removal. Exact reviewed filters, count, revision and archive plus an explicit checkbox/apply are required. No-op or invalid policies are rejected. The full pre-change archive remains downloadable and exactly recoverable. Saved block order is not a claim of current balances.

170 related tests passed (3200.5165 ms). Full validation at the fixed source passed **16391 wallet tests** and **1001 native browser cases**, including the three new workflows. Browser tests use a synthetic provider and isolated local servers/profiles; they do not establish a real-wallet connection or an operating-system save confirmation. The prior full-suite fixture-route assertions are now green in the complete run. [Evidence](evidence/2026-11-01-final-history-workflows/) includes exact source extractions, selected predecessor, retained/recovered archives and both full logs.

These three independent workflows complete the numeric target. The separate completion audit must still verify the full ledger, committed evidence, current served files and unchanged local-only boundaries before the goal is marked complete. No existing-server restart, external RPC, wallet signature, transfer, approval, secret retrieval, publication or deployment.
