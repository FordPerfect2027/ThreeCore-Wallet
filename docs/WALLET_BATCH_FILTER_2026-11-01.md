# Filter the wallet saved-file result list

Item 550. Source: 55f9913.

After a batch finishes, its result list can be filtered by exact result status and a case-insensitive literal filename substring. The controls display shown rows beside the total selected count. They support empty matches, explicit clearing, all source/checksum/invalid/pending statuses and an 80-character bound. Invalid control characters or conditions hide the filtered rows with an error while preserving the complete result. A new selection/reference clears the filter; retry updates row visibility under the current filter without rereading successful files.

Filtering changes only visibility. JSON, CSV and checksum-list saving keep the complete original batch and explicitly say so. Hidden rows cannot open a source through a retained button, visible rows keep their original selection index/hash, and changing a filter suppresses a late detail-opening status from the previous view. No source content, hash, inspection or full receipt is changed by filtering.

All 36 focused tests passed (2354.2678 ms), with 57 related tests (4698.0019 ms) and all 113 scoped native Chrome file-read UI cases. [Evidence](evidence/2026-11-01-wallet-batch-filter/) records all/validated/name/empty/cleared views of three synthetic files, the exact unchanged complete receipt and the selected visible source action. Native tests exercise File/DataTransfer selection, hidden-row rejection and byte-identical full saving after an empty match. Evidence hashes are verified against committed Git blobs.

Last full browser checkpoint: ccbbbe3 (959 cases). Last full-wallet Node checkpoint: d253e8d (15,720 tests). This scoped check does not establish full browser coverage or a connection to the user's current tab. No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or existing-server restart occurred. One filtering capability is counted; statuses and test cases do not create extra items.
