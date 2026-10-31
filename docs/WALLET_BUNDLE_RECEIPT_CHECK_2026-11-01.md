# Verify a saved bundle review receipt against its source

Item 549. Source: e826829.

After a source bundle is reviewed, its previously saved review JSON can be checked against that owned recomputation. The checker compares every expected top-level field recursively, counts unexpected fields without exposing their names or contents, and separately records the binding to the exact bundle text hash. It supports both legacy V1 and plain-source V2 receipts. Imported receipt copies cannot supply expected authority. Input is limited to 256 KiB, depth 32 and 10,000 nodes; hashing is cancellable and time-bounded.

The UI uses a separate file choice, cancellation and save acknowledgement. Changing/reopening the bundle, cancelling or disposal invalidates unfinished checks. A late result or a source change during download cannot publish old success. The verification result contains metadata and hashes only and cannot extract or restore sources. A faithful receipt documenting a bad embedded comparison may pass receipt checking; both UI and output keep that underlying failure explicit, and extraction remains blocked.

Offline reproduction: `node scripts/wallet-saved-bundle.js verify-receipt bundle.json receipt.json --json`. The command freshly reviews the bundle, reads the saved receipt and emits the same check as the API. Exit 0 means the receipt faithfully represents the recomputation, 2 means receipt claims differ, and 1 means invalid input. A faithful negative receipt does not imply a successful source comparison. No input file is written.

All 10 focused cases passed (4041.4089 ms), with 67 related cases (17579.0146 ms) and all 112 scoped native Chrome file-read UI cases. [Evidence](evidence/2026-11-01-wallet-bundle-receipt-check/) includes faithful, altered-authority and faithful-negative receipts and three exact API/actual-CLI output pairs. Tests also cover wrong bundle binding, nested changes, duplicate keys, forged expected authority, acknowledgement, late callbacks, cancellation and timeout. Committed evidence hashes are verified.

The last full native browser checkpoint is ccbbbe3 (959 cases); the last full-wallet Node checkpoint is d253e8d (15,720 tests). This scoped run does not replace those full checkpoints or establish a connection to the user's existing tab. No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or existing-server restart occurred. One product capability is counted, independent of tests and evidence variants.
