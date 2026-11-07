# Live record preservation: source-based procedure

## Status and scope

This procedure was prepared from the local ThreeCore source on 2026-11-07. It
describes supported controls and offline validators; it is not a receipt for a
completed backup. No live records have been exported or verified as part of this
source review. Successful synthetic tests do not establish that an existing
user page has been backed up, that real-wallet recovery has passed, or that
overall development has reached 95%.

An open page may run an older revision. Match the controls below to the visible
UI actually present. Keep every original page open at its existing address:
do not reload, navigate, close it, replace its records, or install updated code
into that page during preservation. Do not use an original page to rehearse an
import or restoration.

Browser storage is separated by browser/profile/storage partition and origin.
An origin includes scheme, hostname, and port. `localhost` and `127.0.0.1` are
different hosts; different loopback ports are separate origins. A different URL
path on the same origin is not sufficient isolation. Inventory and preserve each
populated tab independently, even when the pages look identical.

The source references in this document are relative to this checkout. These
instructions require no wallet connection, signature, transaction, paid model
request, or access to private keys. Record-related public data should be kept
separate from any credential or passphrase fields.

## 1. Preserve current drafts and observations before changing a view

Record the source tab and origin, the populated record panels, visible history
counts, and any unsaved record-related textarea contents. Associate every
download with that source tab, its record type, and the time of preservation.
Do not assume identical download filenames came from the same page.

Several controls generate JSON by replacing a textarea. Preserve existing draft
text before using them:

| Visible control or field | Preservation consequence |
| --- | --- |
| `履歴全体をJSONにする` | Replaces the history JSON textarea. Prefer the separate complete-history download when the textarea contains an unimported draft. |
| `確認記録をJSONにする` | Places the current portfolio observation in the `確認記録JSON` textarea, replacing its previous text. Preserve any previous text first. |
| `確認した控えを一括復元の入力欄へ` | Stages a saved checkpoint into the workspace import textarea. It is unnecessary for backup and can replace an unsaved import draft. |
| `提案JSON（確認用提案はAIの判断ではありません）` | The editable proposal draft can differ from the proposal in the last completed result. Preserve the draft separately if needed. |

A current portfolio result is not automatically part of stored history.
`今回の確認結果を履歴に追加` explicitly adds it. A workspace backup includes the
stored history, so preserve a current unadded observation separately rather than
assuming the workspace file contains it. JSON generation is not itself a file
download: text exposed in a textarea still needs to be retained in a separate
file or other confirmed local record.

Avoid starting new reads or changing record inputs during an export. If a panel
reports that content changed while preparing a file, preserve the newer content
and explicitly retry its export. Do not edit unfinished fields, clear records,
or discard drafts merely to make a backup validation succeed.

Sources: [portfolio panel](../examples/portfolio-panel.js),
[history panel](../examples/history-panel.js),
[history file controls](../examples/history-files.js), and
[proposal panel](../examples/agent-proposal-panel.js).

## 2. Export the current three-card workspace and full portfolio histories

Use `3ウォレットの保存状況を見る` to inspect the local counts, then
`3ウォレットの平文バックアップを保存` to download the current workspace.
The overview reads local records; it does not query balances.

The application's `readWorkspaceDraft()` contains only these fields for each
of DAT, EMA, and CAWELON:

```text
agent
account
chainId
tokenAddress
tokens
history: the card's stored portfolio history
```

For a separate complete archive of each card, use
`履歴ファイルをダウンロード`. This exports that card's complete stored portfolio
history, independently of its display filters. The similarly placed
`表示した履歴だけダウンロード` exports a subset and does not establish that the
whole history is preserved.

If incomplete or conflicting current configuration prevents workspace export,
retain the inputs and use the per-card full-history downloads where available.
Retain the unfinished configuration separately. A history file alone does not
preserve all workspace settings.

The current workspace format permits three cards, up to 64 historical
observations and 32 configured tokens per card. Its file envelope is bounded to
8 MiB. A workspace overview text file is a summary, not a restoration backup.

### Workspace and checkpoint exclusions

Neither the current workspace nor its saved checkpoints include the entire
application state. Their data source excludes:

- Current portfolio observations not added to stored history, unsaved textarea
  drafts, pending import reviews, and UI undo/recovery state.
- Proposal results and editable proposal drafts.
- Token-identity observations, allowance observations and target lists, and
  approval-spender inputs.
- Current transfer observations, accumulated transfer archives, the transfer
  vault working copy, and the vault's saved collection.
- Current period-acquisition progress, saved period-library entries,
  reconciliation data, current period reports, saved report history, and report
  comparison/continuity sets.
- Wallet/provider permissions, active sessions, private keys, seed phrases,
  credentials, and authorization to sign or transact.

The optional encrypted workspace export has the same workspace content scope;
encryption does not add the separately managed record collections. An
`操作前の控えを保存` recovery draft, when available after workspace restoration,
is a separate manual recovery format and must not be mistaken for an importable
workspace backup.

Sources: [workspace integration](../examples/wallet-demo.js),
[workspace panel](../examples/workspace-panel.js),
[workspace format](../src/workspace-format.js), and
[workspace file format](../src/workspace-file.js).

## 3. Preserve browser-saved checkpoints separately

The current source supports `現在の3ウォレットを日時付きで保存`. One explicit click
reads the saved list and appends a new snapshot of the initial current draft.
It does not overwrite an older checkpoint. This is browser-local persistence;
file export remains a separate operation.

For a revision without that shortcut, the existing sequence is:

1. `保存済みの控え一覧を読み込む`.
2. Enter a new checkpoint name.
3. `現在の3ウォレットを新しい控えとして保存`.

Use `控え一覧をまとめてファイル保存` to export every saved checkpoint, including
archived entries, names, and archive states. A selected snapshot can also be
exported with `選んだ控えをファイル保存`; that file represents the selected saved
state, not necessarily the page's current state.

There are at most five checkpoints, including archived entries, with a combined
payload limit of 24 MiB. If capacity is full, retain and export the existing
collection. Do not delete checkpoints to make preservation possible. The
current workspace export remains independent of the checkpoint count.

A saved collection can predate unsaved page records. Preserve both the current
workspace and the collection when both contain material to retain. Buttons that
load or refresh a saved list operate on that panel's storage; they do not reload
the browser document. If storage is blocked or a revision conflict is reported,
retain the original page and available file exports rather than reloading it.

Sources: [checkpoint panel](../examples/checkpoint-panel.js),
[checkpoint controller](../src/checkpoint-controller.js), and
[checkpoint transfer](../src/checkpoint-transfer.js).

## 4. Export the other populated record scopes

Use the existing export controls for each populated scope. Exporting a saved
collection does not automatically capture a newer working object displayed
elsewhere on the page.

| Record scope | Exact visible export action | Coverage |
| --- | --- | --- |
| Each card's last proposal result | `最後の確認結果をJSONで保存` | Last completed or restored historical result, including its proposal and policy. The separate editable proposal draft is not substituted into this record. |
| Token-identity observation | `照合記録をファイル保存` | Current identity observation. |
| Allowance observation | `承認額の記録をファイル保存` | Current allowance observation. |
| Allowance targets | `確認先一覧をファイル保存` | Current target list, separate from the observation. |
| Each card's current transfer observation | `JSONを保存`, inside `履歴を保存・再読み込み・比較` | Current transfer snapshot. |
| Each card's accumulated transfer periods | `まとめたJSONを保存` | The card's period archive. A current observation not added to it needs its own export. |
| Transfer vault working copy | `一括JSONを保存` | Current working bundle, separate from saved snapshots and current card state. |
| Transfer vault saved collection | `PC内の保存一覧を開く・再読み込み`, then `保存一覧全体をJSONに保全` | All browser-saved vault entries, including archived entries. |
| Current period-acquisition progress | `途中の控えをJSON保存` | Current acquisition draft, including acquired partial progress. |
| Saved period library | `期間の保存一覧を開く・再読み込み`, then `期間の保存一覧全体をJSON保存` | All entries, including archived and reacquisition-required states. |
| Reconciliation data | `照合データを保存` | Reconciliation input records. `照合用JSONを保存` in the period collector is another source of the reconciliation format. |
| Current period report | Acknowledge its public-data export checkbox, then `元の記録を含む報告JSON` | The current report and its source records. |
| Saved report history | `PC内の報告履歴を読み込む`, acknowledge export, then `全報告のバックアップJSON` | All saved reports, including archived entries and saved metadata. |
| Current report comparison/continuity set | Acknowledge its JSON export checkbox, then `確認セットJSONを保存` | The current set and its included evidence, not every report in the saved library. |

The transfer vault's `3枚のカードの履歴を確認` can capture card archives together
with current transfer observations. Applying that review can replace its
existing working copy. Preserve the existing working copy first; direct
per-card exports avoid requiring that replacement during preservation.

Proposal preservation does not require `提案を取得する（読取りはまだ実行しない）`
or `提案を検証して読み取る`. Those actions start new work. The save control exports
the historical result already retained by the panel.

CSV, HTML, text summaries, and filtered exports have narrower purposes and do
not substitute for restoration JSON. A currently displayed period draft or
report may be newer than the corresponding saved collection; retain both.

Sources: [transfer panel](../examples/transfer-panel.js),
[transfer archive](../examples/transfer-archive-panel.js),
[transfer vault](../examples/transfer-vault-panel.js),
[period collector](../examples/period-panel.js),
[period library](../examples/period-library-panel.js),
[period report](../examples/period-report-panel.js),
[report history](../examples/report-history-panel.js),
[report set](../examples/report-set-panel.js),
[reconciliation](../examples/reconciliation-panel.js),
[identity](../examples/token-identity-panel.js), and
[allowance](../examples/allowance-panel.js).

## 5. Verify completed downloads without restoring them

A notice that a download was started does not prove that the file reached disk.
Confirm each completed download, retain the original file unchanged, and run the
appropriate existing CLI against that file or an independently retained copy.
Run commands from the isolated development checkout. Replace `export.json` with
the actual downloaded path; no command below has been run on live records as
part of this document's preparation.

| File type | Existing read-only command |
| --- | --- |
| Workspace or individual checkpoint | `node scripts/check-workspace-backup.js --file "export.json" --json` |
| Saved checkpoint collection | `node scripts/check-checkpoint-collection.js --file "export.json" --json` |
| Token-identity observation | `node scripts/check-token-identity.js "export.json" --json` |
| Allowance targets or observation | `node scripts/check-allowance-file.js "export.json" --json` |
| Transfer snapshot | `node scripts/check-transfer-file.js "export.json" --json` |
| Transfer-period archive | `node scripts/check-transfer-file.js "export.json" --archive --json` |
| Transfer vault working bundle | `node scripts/check-transfer-vault.js "export.json" --json` |
| Transfer vault saved collection | `node scripts/check-transfer-vault.js "export.json" --collection --json` |
| Period-acquisition draft | `node scripts/check-period.js "export.json" --json` |
| Period-library collection | `node scripts/check-period-library.js "export.json" --json` |
| Reconciliation data | `node scripts/check-reconciliation.js "export.json" --json` |
| Period report | `node scripts/check-period-report.js "export.json" --json` |
| Saved report history | `node scripts/check-report-history.js "export.json" --json` |
| Report comparison/continuity set | `node scripts/check-report-set.js "export.json" --json` |

The workspace and checkpoint commands require `--file`. The other listed
commands take a positional filename. The workspace checker is for the plain
workspace file envelope; it does not accept encrypted workspace files, manual
recovery drafts, or individual raw portfolio-history archives.

No dedicated proposal-record or raw portfolio-history CLI was found in the
reviewed `scripts` directory. Existing format readers can support a separately
scoped offline check; do not claim those files were verified by an unrelated
workspace checker. In particular, proposal records remain explicitly
unauthenticated after format and internal-consistency validation.

These validators read local files and do not restore browser data or request a
wallet. The workspace and checkpoint validators open files in read mode, verify
file bounds and stable reads, validate formats and checksums, and report counts.
The collection checker also verifies every nested workspace checksum. Some
other diagnostics expose public addresses or amounts; retain their output with
the backup evidence rather than assuming every report is redacted.

For a workspace, compare `totalObservations` and each card's `observations`,
`configuredTokens`, `agent`, and `chainId` with the source-page inventory. For a
checkpoint collection, compare `activeCount`, `archivedCount`,
`nestedChecksumsVerified`, and the observations for each snapshot and agent.
Keep each validator's exit status and output associated with the correct tab
and file. A valid file with zero records does not establish preservation of a
different populated source page.

Omit `--require-complete`, `--require-agreement`, and `--require-continuous` during
preservation checks. They impose additional semantic acceptance conditions.
Partial acquisition progress, arithmetic disagreement, and period gaps can be
valid and valuable evidence. Report those conditions separately from file
corruption or format failure. A failed inspection is a reason to retain the
original file and investigate; do not edit its data or checksum to obtain a pass.

Checksums detect corruption; they do not prove authorship, ownership, current
balances, chain completeness, or independent security assurance.

Sources: [workspace validator](../scripts/check-workspace-backup.js),
[checkpoint validator](../scripts/check-checkpoint-collection.js),
[bounded file reader and vault validator](../scripts/check-transfer-vault.js),
and the individual CLI implementations named in the table.

## 6. Rehearse disconnected restoration only after verified preservation

Begin a restoration rehearsal only after the relevant downloads have completed,
their available offline checks have passed, and source-page counts and file
scope have been reconciled. Retain every original page, source record, and
download unchanged throughout the rehearsal.

Use a separate disposable test page on a different isolated loopback origin,
preferably in a disposable browser profile without wallet extensions. Confirm
the test origin differs from every preserved source origin; changing only a URL
path is insufficient. Use the normal application UI appropriate to the verified
format, with no existing test records that need preservation. Do not use an
original page or a live production origin for the rehearsal.

For a workspace or individually exported checkpoint:

1. Select the verified plain file using `保存した一括バックアップを選択` on the
   isolated page. Its accessible field name is `一括バックアップファイル`.
   Wait for the file and checksum result.
2. Use `一括復元の変更内容を確認`. Compare all three cards, histories, networks,
   and configured tokens with the verified file inventory. Keep
   `既存の履歴を置き換える（未選択なら追加）` unchecked. An initially empty test
   destination does not need removal of earlier records.
3. Acknowledge `変更する設定と履歴を確認しました`, then use
   `確認した内容を一括復元` only on that isolated destination.
4. Inspect the restored local counts and historical labels while remaining
   disconnected. Do not press a wallet connection, balance-read, proposal-read,
   or period-acquisition action to establish restoration success.
5. Export the restored workspace to a new file, run its offline check, and
   compare its semantic contents and counts with the original backup. Preserve
   both files; an unexplained difference is not a successful rehearsal.

For a checkpoint collection, load the isolated page's own checkpoint list and
select the verified collection in `保存した控え一覧ファイル` (accessible field
name: `控え一覧のバックアップファイル`). Review the append-only import,
acknowledge `控え一覧への追加内容を確認しました`, and use
`確認した控え一覧を追加`. Inspect selected entries with
`選んだ控えの内容を確認`. Staging and applying a selected checkpoint, if needed,
must remain within this isolated destination and follow the workspace sequence.

Use each other format's own reviewed import flow on the isolated destination.
A proposal record can be displayed as historical evidence through its saved
record import and `確認した過去の記録を表示`; this does not restore its policy as
active authority or connect a wallet. Saved period/report collections and their
current working objects remain separate during restoration as they were during
export.

Importing a file does not restore wallet permissions. Configuration changes in
workspace restoration explicitly disconnect affected cards. A historical
account address, chain ID, or balance must not be treated as an active connection
or a current observation. Real three-account acceptance remains separately
pending until the intended browser/wallet access and any actual wallet permission
prompts are resolved. It requires explicit connections and new evidence; the
existing instruction to continue development remains in force.

Record the isolated origin, exact files used, verified counts, actions completed,
and observed disconnected state. Until that evidence exists, mark live backup
and disconnected restoration as pending rather than inferring completion from
this procedure or from automated regression totals.

Sources: [workspace coordinator](../src/workspace-controller.js),
[application restore integration](../examples/wallet-demo.js),
[checkpoint controller](../src/checkpoint-controller.js),
[proposal record validation](../src/agent-proposal-record.js), and
[proposal historical import UI](../examples/agent-proposal-panel.js).
