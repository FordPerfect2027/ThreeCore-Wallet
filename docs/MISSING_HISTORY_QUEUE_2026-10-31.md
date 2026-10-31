# Preview ten missing-history windows at a time: item 463

Fixed source: `f1be6ab`.

463. Within each saved-range coverage section, “記録がない区間の読み取り予定（10回分ずつ）” proposes a bounded page of missing query windows. The default is 2,000 blocks per query, at most ten queries per page, newest blocks first. Previous/next controls and an exact page-number field allow navigation without silently running reads. Changing conditions invalidates the old preview. Source replacement recreates the panel from the newly accepted immutable set.

“計画内で履歴記録なし” uses planned ranges lacking saved query records. “計画と計画の間の空白” explicitly selects intervening unplanned ranges instead. Adjacent missing cells merge before partitioning, and the resulting inclusive windows neither overlap each other nor include ranges with saved records. Short final windows are retained. Already recorded but review-needed ranges remain excluded and their block count is disclosed separately; an empty queue does not mean all evidence is verified.

Each proposal includes the full account, chain, token address, selected group, exact total/page block and window counts, source report references, and executed:false. Group IDs are local to the displayed set. Page arithmetic uses exact integers and skips directly to the requested page; it never allocates one item per block or per earlier window. Queries reject invalid groups, options and page numbers. This creates no period plan in storage and calls no provider.

## Validation

- Focused queue, coverage and timeline checks: 36 passed (4,453.0846 ms).
- Related report-set, check-detail and period-report checks: 704 passed, zero failed/skipped/cancelled (48,722.4456 ms).
- Full wallet at f1be6ab: 15,020 passed, zero failed/skipped/cancelled (352,395.498 ms).
- Native Chrome: 874 UI cases passed with an isolated profile, fresh ephemeral server, synthetic provider and no external RPC.
- Previously tracked evidence: all 125 manifests, 781 files and 48,907,666 bytes matched their recorded SHA-256 checksums. This audit precedes the present folder.

The native case previews 24,000 missing blocks as 20,000 blocks/ten windows followed by 4,000 blocks/two windows, navigates back, changes width and verifies the stale preview clears. Displayed original evidence is unchanged and no download is requested. This is isolated test-browser verification, not reconnection of the user's existing tab/server.

Four shared-function captures reproduce those two pages, a partially collected EMA range and the last page of an enormous unplanned gap. [Evidence](evidence/2026-10-31-missing-history-queue/) contains three checksummed synthetic original sets, exact proposal JSON and screen text, metadata, scoped/full/native logs, prior evidence audit and SHA-256 manifest. The captures run under Node; native UI coverage is separate. These counts describe planned read requests, not completed on-chain verification or mainnet readiness. No real signing, transfers, approvals, secrets, publication or deployment occurred.
