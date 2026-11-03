# Combine saved portfolio reports into a reviewed history candidate

Item 586. Source: e3b067e.

A separate multiple-file input accepts one to 64 individual portfolio observation JSON files for this card. Each file is bounded to 64 KiB, the batch to 1 MiB, and reading/preparation uses a shared 30-second deadline. File metadata is captured before reading; fatal UTF-8, exact byte length, existing report schema and agent validation remain enforced. Exact duplicate observations are removed; a malformed file, another agent or contradictory observations reject the entire candidate.

Successful reading fills the existing history JSON input with a separate canonical candidate and reports source/unique/duplicate counts. It does not modify active history. Existing preview and apply remain mandatory, including capacity, conflict and replacement checks against the current archive. Cancel, edited input, replacement, another file operation or disposal retire pending reads. Failed batches preserve the preceding candidate and active history. Unconfirmed callbacks cannot claim a completed handoff.

233 related checks passed (2815.9179 ms); 140 focused native browser cases passed. Coverage includes the 64-file and 1-MiB exact boundaries, malformed/conflicting/mixed-agent input, no reads on invalid metadata, delayed cancellation, elapsed batch deadline and no stale completion. The native multi-file workflow proves staging, duplicate counts, explicit preview/application and preservation after a failed subsequent batch. [Evidence](evidence/2026-11-01-history-report-batches/) retains two source reports, their candidate archive and actual UI/API capture.

Last full browser: b3254c9 (986 cases). Last full-wallet: d253e8d (15,720 tests). Synthetic/native File checks do not establish OS-picker use or a real-wallet connection. No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred.
