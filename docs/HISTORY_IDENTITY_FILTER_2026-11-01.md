# Search the exact account, network and site identity of a saved observation

Item 589. Source: 7ea5bcb.

History queries now support an exact bare site origin as well as account, chain, block and token criteria. Paths, credentials and nonlocal HTTP are rejected using the existing origin validator. This is a local filter, not site approval or navigation. Origin labels are visible in the history list, record selectors and search results so otherwise identical account/chain/block records from different sites can be distinguished.

An explicit same-target action fills account, chain and origin from the selected historical observation, clears unrelated block/token conditions, runs the local query and focuses its results. It preserves original archive indices and changes neither records nor current wallet state. Edited criteria retire stale exports. The existing offline history command supports the same --origin filter and emits identical results. Bad/other-agent handoffs and reentrant lifetime changes cannot claim a successful search.

157 related tests passed (4326.6214 ms); 143 focused native browser cases passed. [Evidence](evidence/2026-11-01-history-identity-filter/) captures five records differing by site/account/network and the exact two-record identity subset, with actual CLI/API byte equality. Native integration confirms visible origin labels, focused results and an unchanged source archive.

Last full browser: b3254c9 (986 cases). Last full-wallet: d253e8d (15,720 tests). No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred. Synthetic/native checks do not establish a real-wallet connection.
