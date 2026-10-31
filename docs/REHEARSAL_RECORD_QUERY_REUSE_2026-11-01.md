# Reuse unchanged rehearsal record queries and summaries

Item 548. Source: ccbbbe3.

Repeated page navigation previously filtered the same immutable source index and rebuilt the same per-agent financial summary. The record module now retains the most recent validated query for each of its three report schemas and one summary per owned immutable index. A repeated equivalent query returns the existing frozen result. This removes repeated full-row filtering and BigInt aggregation during unchanged navigation while keeping the same result and export bytes.

Every call still validates and captures query options before reuse. Cache keys include the normalized complete query and report schema; stored/recorded/both-context searches and reason filters remain distinct. New source indexes have separate state, so edits, restores and missing-ledger scope cannot reuse old results. No arbitrary history of queries or persistent browser storage is added; the WeakMap follows the lifetime of the source index. Other page work such as DOM rendering and selected-record detail preparation still runs.

All 105 focused tests passed (4315.1546 ms) and 217 related tests passed (10740.2433 ms). A new full native Chrome run passed all 959 registered browser UI cases across two sequential isolated profiles, with 261 local modules checked before execution. This supersedes the earlier a2eb7e5 browser checkpoint for this source. The last full-wallet Node checkpoint remains d253e8d (15,720 tests); this is not a new full-wallet run.

[Evidence](evidence/2026-11-01-rehearsal-record-query-reuse/) compares this module against 723d656. All 44 query/summary/export comparisons are byte-identical. In five alternating Node timing rounds, each with 300 repeated query-and-summary pairs on a prebuilt 600-record synthetic index, median time changed from 2004.742 ms to 8.437 ms. These timings exclude source indexing, DOM rendering, exports, network and agent development time; they do not establish an overall speed multiplier. Raw rounds and a reproduction script are saved. Run the script with the repository path and a separate output JSON path; it reads the old module from Git. Evidence hashes are checked against committed blobs.

No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or existing-server restart occurred. Native testing used synthetic providers and isolated profiles; it does not establish a connection to the user's existing tab. This is one completed performance capability, not 300 or 600 development items and not a mainnet-readiness percentage.
