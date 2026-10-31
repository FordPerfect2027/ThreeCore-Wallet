# Explain a blocked history merge without changing either source

Item 588. Source: dcafee4.

Merge preview now diagnoses both capacity and conflicting observations before attempting an import. It reports current/incoming counts, unique new positions, duplicates, every conflicting position and the additional free slots required. The diagnostic does not construct an invalid oversized history, remove records, select which conflicting source is correct or authorize an import. Exact account/chain/site/block identity is retained; conflicts show differing hashes, native balances and contract observations. Unobserved contracts and missing contract code remain distinct.

The assessment matches the collection's actual duplicate semantics: session-local connection epochs and holding display order do not create a conflict. Merge preview displays the diagnosis and keeps apply disabled when blocked. Correcting the candidate requires a new preview. Explicit replacement remains a separate existing choice and is never selected automatically. Current archive and incoming text are retained during diagnosis.

921 history-related checks passed (13324.6687 ms), including real collection/assessment agreement across capacity boundaries and identity changes. 142 focused native browser cases passed. [Evidence](evidence/2026-11-01-history-merge-assessment/) captures a full 64-record archive with two new positions, one duplicate and one conflict: two more free slots are needed and apply stays disabled. A corrected duplicate-only candidate can be reviewed and applied without changing the archive.

Last full browser: b3254c9 (986 cases). Last full-wallet: d253e8d (15,720 tests). No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred. These synthetic/native checks do not establish a real-wallet connection.
