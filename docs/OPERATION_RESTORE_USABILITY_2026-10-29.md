# Rehearsal recovery usability — October 29, 2026

Follow-up: [Recorded identity, policy and event comparison](OPERATION_RESTORE_COMPARISON_2026-10-29.md) adds the next ten completed work items. The usability iteration below remains a historical record.

A successful file selection previously cleared the native filename control and hid the current detail view. The user could therefore mistake a pending restore review for a failed selection. This update keeps current applied records visible, names the reviewed input separately and explains the next action. Source commit: `1325e8ab325da5e20108a12085728fb381433dc0`.

## Ten completed work items

| Item | Result and verification |
| --- | --- |
| 1. Three-step guide | Distinct choose/read, review and completed states explain when the restore button is required. Verified in Edge. |
| 2. Selected input label | A separate bounded plain-text filename survives native input clearing. Control/directional characters are removed. Covered by page tests. |
| 3. Before/after comparison | Each token shows current and proposed record counts, with replacement, restoration, removal and absent states distinguished. Zero records are distinct from an absent ledger. Tested and observed in Edge. |
| 4. Current results stay visible | File reading, pending review and invalid input preserve the applied detail view, exports and undo. Slow reads and failures are covered by tests; preservation during paste review/error was observed in Edge. |
| 5. Cancelled file selection | An empty selection or picker cancellation preserves an existing valid review and current records. Covered by page tests. |
| 6. Error guidance | Empty, malformed, oversized, duplicate-agent and unsupported SIM inputs receive useful messages without replacing records. UTF-8 byte limits remain enforced. Tested; malformed and duplicate-agent rejection observed in Edge. |
| 7. Paste recovery option | A disclosed text field accepts saved workspace JSON through the same bounded decoder and explicit restore review. Raw text is cleared after submission. The existing saved six-record file was pasted and restored in Edge. |
| 8. Stale review prevention | Editing, switching, cancellation, newer input and disposal revoke pending work. Late success/failure cannot replace a newer review or completed result. Tested; switching/cancellation observed in Edge. |
| 9. Completion and accessibility | The last restore names its source and all three counts. Status updates are announced; review, error and completion move focus to the guide. The active focus target and completion receipt were observed in Edge. |
| 10. Verification and retained evidence | All 187 related tests passed. Edge restored and exported the original six records; the 4,771-byte download exactly matches the original SHA-256. Screens, observations, test log and offline recalculation are retained. |

## Using the page

Open `/rehearsal/`. Under **保存した3トークンの履歴を戻す**, choose the saved combined JSON. **2 / 3 — 選択できています** confirms that input is ready for review; the native file control may be blank because its value is reset to allow selecting the same file again. The independent **確認する記録** label identifies the reviewed source.

Inspect **復旧する前と後の履歴**, then press **確認した3トークンの履歴を復旧**. Until that button is pressed, the upper table and detail view still represent the current applied records. Missing tokens in an incoming workspace are explicitly listed for removal. Cancellation preserves current records. **3 / 3 — 復旧が完了しました** and the last-restore receipt confirm application and recalculation. Undo checkpoints are reset by a confirmed restore.

If file selection is difficult, expand **ファイルを選べない場合**, paste the entire previously saved `ThreeCore-operation-workspace.json`, and press **貼り付けた記録を確認**. This only prepares a review; the restore button is still required. Input is processed locally, without network access. This is an additional page input, not a change to browser-extension file permissions. The textarea accepts at most one character beyond the decoder's limit so over-limit input is rejected instead of being accepted as a truncated valid record. Both character and UTF-8 byte bounds are checked by the existing decoder.

There is no automatic persistence: save necessary histories before closing or reloading. A download-start message does not assert that the user has retained a file. The last-restore receipt describes the last import, not any subsequent edits.

## Verification

```sh
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs
```

Final result: **187 passed, 0 failed**. This includes **51 page tests** (19 added in this iteration); these counts overlap. The suite covers the rehearsal models, ledger, workspace, CLI, page controller and local HTTP integration. The unrelated full wallet regression suite was not rerun for this page-only change.

The real Edge sequence tested a fresh load, paste review, explicit restore, malformed and duplicate-agent rejection, a partial preview showing removals without applying them, cancellation, review invalidation on token switch, final restore and actual download. Focus moved to `workspace-stage`. Final retained records: DAT 3, EMA 2, CAWELON 1. The original and new downloads are both 4,771 bytes with SHA-256 `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`; the offline checker returned exit 0.

[Evidence index and reproducible checks](evidence/2026-10-29-restore-usability/README.md). The native file-picker automation remains subject to browser-extension permission limitations; this iteration does not claim a successful automated native file upload. The ordinary file-read behavior is covered by controller tests, and the paste path was exercised in the actual browser.

All amounts and addresses are fictional rehearsal data. This work performs no wallet signatures, transfers, approvals or private-key retrieval, and establishes no mainnet-readiness percentage. The existing accounting rules and file schemas are retained.
