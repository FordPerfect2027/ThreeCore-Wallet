# Three-agent rehearsal workspace — October 29, 2026

This ten-item continuation lets DAT, EMA and CAWELON retain separate rehearsal histories while switching between them, and export/restore them as one reviewed file. It extends the [previous ledger iteration](OPERATION_LEDGER_2026-10-29.md). All records remain fictional, single-asset simulations. This change adds no wallet connection, signature, transfer, approval, trading, custody or private-key handling. It is local development, not a production release or a mainnet completion percentage.

## Ten work items

| Item | Behavior and verification |
| --- | --- |
| 1. Separate histories | One validated ledger per named agent, with immutable snapshots; duplicates in a workspace are rejected. |
| 2. Switching | Changing the selected agent preserves each applied ledger. Unconfirmed proposals are revoked. |
| 3. Independent undo | Up to ten append checkpoints per agent survive switching. Undo changes only the selected ledger. |
| 4. Overview | A three-row summary shows record count, P&L, reservations and remaining allocation per agent. Missing data is labeled absent, never zero. No totals combine accounts, chains or assets. |
| 5. Combined export | One bounded JSON file contains applied inputs and the selected agent, excluding unconfirmed proposals and undo history. |
| 6. Restore preview | File selection only prepares a review. The preview names every agent that will be replaced or removed, and warns that undo history is reset. Current data can still be exported. |
| 7. Atomic restore | Explicit confirmation replaces all three slots once, then recalculates. A missing member becomes absent; this is replacement, not an automatic merge. |
| 8. Invalid/stale reads | Invalid members, duplicate agents, oversized data, stale asynchronous reads, cancelled reviews and reentrant input cannot partially restore a workspace. |
| 9. Offline checker | An explicit `--workspace` mode validates the combined file, optionally checks SHA-256 and reports each agent separately. |
| 10. Browser save/restore | Chrome creation, switching, independent undo, actual combined download, invalid-file rejection and restore cancellation were observed. A fresh Edge session restored the user-selected saved file after explicit review; all six records and per-agent values returned. Its new export exactly matched the original Chrome file. |

## Use

Open `/rehearsal/` on the local demo and create a sample for each desired agent. Switching **対象** returns to that agent's applied records and undo checkpoints. Input-condition edits, a new single-operation calculation, a new sample or **読み込み・表示をクリア** affect only the selected agent. Importing a single ledger replaces that ledger's named agent when confirmed, preserving the other agents. Original V1 records remain V1 and cannot receive V2 appends through this page.

**3トークンの履歴を一括保存** downloads `ThreeCore-operation-workspace.json`. The file contains only applied data. There is no localStorage, automatic persistence, encryption, synchronization or background saving. Closing or reloading the page loses page-local histories; use the downloaded file to recover them.

Choose **一括ファイルを選ぶ**, inspect the per-agent replacement list, then choose **確認した3トークンの履歴を復旧**. Choosing a file alone does not replace records. **一括読込を取り消す** preserves current histories and restores the selected agent's display. Restoring a partial or empty workspace explicitly removes missing agents after confirmation. Import/restore clears undo history; switching alone preserves it. Editing or switching invalidates a pending restore review. Failed imports leave the applied histories available through the overview, switching and combined export.

## File and accounting boundaries

`threecore.operation-rehearsal-workspace.v1` has exactly four fields: `schema`, `simulationOnly`, `activeAgent` and `ledgers`. It contains zero to three unique agents in canonical DAT/EMA/CAWELON order. Each member retains its existing V1 or V2 schema, 200-record bound and 128 KiB export bound. The complete UTF-8 file is limited to 512 KiB. Duplicate JSON keys, extra fields, invalid members, getters and sparse arrays are rejected. Imported derived results are not accepted as evidence.

The reusable module can preserve different valid assets and chains, but never sums their results. The Japanese rehearsal screen accepts only six-decimal SIM records. Agent labels separate local records; they do not establish independent custody, verify the source account or prove that two datasets represent different funds. Business-rule rejections remain visible records, not structural file errors. The offline checker returns 2 if supplied records violate modeled constraints, allocations are overcommitted, or the workspace contains no agent ledgers; a negative realized P&L alone is not a malformed file. A present ledger with zero events is distinct from an absent agent.

Checksums establish byte equality with a supplied hash only. All reports retain `simulationOnly: true`, `sourceVerified: false` and `authorizesExecution: false`. Reading and checking a file performs no wallet or network requests and writes no files.

## Reproduce

```sh
node --test test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs
node scripts/check-rehearsal.js path/to/ThreeCore-operation-workspace.json --workspace --json
node scripts/check-rehearsal.js path/to/ThreeCore-operation-workspace.json --workspace --sha256 EXPECTED_64_HEX_CHARACTERS
```

The existing single-ledger CLI default remains unchanged. An explicit `--workspace` prevents confusing the two formats. Exit 0 means supplied nonempty workspace data satisfies the modeled constraints; exit 2 describes modeled constraint failures or an empty workspace; exit 1 describes file, checksum, encoding, arguments or structural failure. None means a transaction is authorized or safe.

## Validation

- Final focused model/controller/page/CLI/HTTP suite: **168 passed, zero failures**.
- Full unit regression with concurrency 2: **11,747 passed, zero failures**.
- Integration regression: **406 passed, zero failures**, excluding `token-compatibility.test.mjs`, which requires its own compiled token checkout.
- Counts overlap and should not be added. All source changes in this iteration were present for these runs.
- Chrome created DAT profit plus a 2.8 SIM reservation (3 records), EMA loss (2 records) and an unresolved CAWELON operation (1 record). Switching retained all three; undoing DAT changed neither other agent. A pending append was revoked on switching.
- Chrome saved the combined six-record file, 4,771 bytes. SHA-256: `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`. Offline recalculation confirmed per-agent P&L of 28 SIM, -42 SIM and -1 SIM respectively, DAT reservation 2.8 SIM and CAWELON closing-fee reserve 2 SIM.
- Chrome rejected a deliberately duplicated-agent file without changing the current six records. A valid restore preview also left the current records unchanged; cancellation retained them and DAT's undo checkpoint.
- The initial Chrome connection failed during file selection after reload; that attempt did not complete a restore. After the local server was restarted, the user opened a fresh Edge session and selected the saved file. The empty overview remained unchanged during preview. Explicit restore recovered DAT (3 records), EMA (2) and CAWELON (1), cleared all undo checkpoints, and disabled repeated application of the consumed review. Switching through each agent preserved the overview and recalculated the expected values.
- Edge exported the restored workspace as `ThreeCore-operation-workspace (1).json`: 4,771 bytes, byte-for-byte identical to the original Chrome download. The offline checker returned exit 0 with the expected SHA-256. This completes the ten-item batch with a **Chrome export → Edge restore → Edge export** check. A Chrome-only reload/import round trip is not claimed. Browser extension file access settings and local origin protections were not changed.
- [Saved evidence and reproduction instructions](evidence/2026-10-29-operation-workspace/README.md) include both downloads, browser observations, offline reports, a restored-screen image and checksums. All ten development items are complete within this simulation-only scope; this is not a mainnet readiness percentage.
