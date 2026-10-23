# Three-token transfer history vault

Local development, 2026-10-23. This feature has not been pushed to GitHub.

The vault brings previously collected DAT, EMA and CAWELON Transfer-event
observations into a single offline working copy. It adds explicit browser-local
storage, backup files, activity filters, exact per-token summaries and undo/redo.
It does not connect wallets, query providers, sign messages or send transactions.

## Start with the three cards

1. Collect or import historical observations using the existing token cards.
2. Select **3枚のカードの履歴を確認** in the vault panel.
3. Review each token's added periods, removed periods and account/chain changes.
4. Apply the preview to the working copy. A replacement which removes original
   periods requires a separate acknowledgement.
5. Export a JSON file or explicitly save the working copy in the local list.

Capturing includes both the card's period archive and its current observation.
An identical current period is deduplicated. A conflicting same-range observation,
account, chain, block hash or overlapping event rejects the capture/merge.

The working copy is separate from the cards. Changing a card invalidates a pending
card preview. Applying a preview also rechecks the cards against their captured
contents. Existing working data remains historical until explicitly replaced.

**矛盾がない記録だけを追加する** performs an additive merge. It never picks a winner
between contradictory records. **作業用コピーを置き換える** replaces only the
working copy after review. Neither action changes a saved snapshot.

## Save and reopen

The panel does not open IndexedDB or read a saved record on mount.

1. Open **PC内の保存一覧** and select the explicit open/refresh button.
2. Enter a name and save. Each save creates a new immutable snapshot.
3. When reopening the same browser and origin, explicitly load the saved list.
4. Select a record, inspect it and apply the reviewed contents to the working copy.

Names and archive state can be changed separately. Archived entries still count
against storage limits, remain exportable and can be restored to the active list.
Permanent deletion requires an archived selection and its own confirmation box.
Deleting a saved record cannot be undone with the working-copy undo button.

Writes check the document revision inside one IndexedDB read/write transaction.
A stale tab cannot overwrite a later save. On a conflict, refresh explicitly.
Cancellation and disposal attempt to abort pending writes. If cancellation races
with transaction completion, refresh the list to establish whether it committed.
The UI does not claim that cancellation always removes a completed save.

The vault uses database `threecore-transfer-vault-v1`. Existing workspace
checkpoints use a different database and retain their existing schema. This
feature neither migrates nor clears them. The shared storage adapter accepts a
strict document policy; existing checkpoint callers use the original default.

## Three different file purposes

| File | Contents | Import effect |
| --- | --- | --- |
| ThreeCore-transfer-vault.json | Current working histories for all three tokens | Reviewed working-copy replacement or merge |
| ThreeCore-transfer-vault-collection.json | Every saved entry, including names and archived entries | Reviewed addition to the local saved list |
| ThreeCore-transfer-activity.csv / .txt | Exact activity rows or per-token summary | Readable report; not an import format |

A collection backup is self-contained. It does not depend on a live browser
storage reference. Its portable document revision is zero; local revisions are
not copied to another storage instance. The checksum covers entry metadata and
all nested histories. Identical entries with the same ID are skipped. An ID with
different contents or metadata rejects the entire import, preserving local data.
No import evicts older entries to make room.

The panel also accepts previous single-period transfer JSON and period-archive
JSON. Select the corresponding format and token before opening that file. Their
existing checks and limits remain in force. They cannot be treated as wallet
configuration or an instruction to reconnect a provider.

Checksums detect accidental modification. They are not signatures, proof of
wallet ownership, proof of current chain state, or an independent security audit.
A person who modifies a file can also recompute its checksum.

## Undo and redo

Applied card, file, legacy-file and saved-record previews enter a volatile
working-copy timeline. Undo and redo affect only this offline copy.

- At most five applied changes and 24 MiB of serialized before/after data are kept.
- The oldest changes are discarded when either limit is exceeded, with a notice.
- A single change exceeding the undo budget still applies after review, but its
  undo data is not retained and the bounded-history notice is shown.
- A new applied change after undo starts a new branch and clears redo.
- Reapplying identical contents does not add a step or clear redo.
- Undo/redo invalidate outstanding import previews and removal acknowledgements.
- Storage writes, card configuration and downloaded files are not rolled back.
- Closing or reloading the page clears this timeline. Saved snapshots survive.

These limits bound serialized history content, not the JavaScript engine's exact
heap usage. Large files also require temporary parsing and validation buffers.

## Activity and amount interpretation

The activity list filters by token, direction and public identifier. It uses
20-row pages. Changing the working copy or filter resets the page. Ordering groups
chains and then uses block order; it is not a shared wall-clock chronology across
chains. Original records are retained even when overlapping events are deduplicated
in a display or summary.

Amounts use integer arithmetic and each token's validated decimals. Tokens are
never summed into a portfolio value. Incoming plus mint events form observed
receipts; outgoing plus burn events form observed sends. Self-transfers remain
visible separately and have no effect on the observed net amount.

The net observation is not a balance, profit/loss or tax calculation. A missing
slot means no record, not zero holdings. Queried block ranges and gaps are shown,
but a range without a reported gap is still not proof of a complete history.
Counterparties are grouped public addresses, not verified identities or trust
ratings. CSV exports retain raw base units and full transaction/log identifiers.

**表示条件に一致する全件をCSVに保存** exports every matching row, including
matches beyond the current page. It applies the same token, direction, identifier
and order filters as the screen. No-result searches disable this download. The
separate **履歴CSVを保存** control continues to export the full working history.
Filtered reports do not change the original data, saved list or undo timeline;
they are reports rather than restorable backups. Retain the JSON for restoration.

## Limits and privacy

| Boundary | Limit |
| --- | --- |
| Token slots | DAT, EMA, CAWELON in fixed order |
| Original periods per token | 12 |
| Existing individual-period reader | 2,000 blocks and 500 unique events |
| Canonical bundle | 12 MiB |
| Bundle file envelope | 20 MiB |
| Saved entries, including archived | 5 |
| Canonical saved document | 24 MiB |
| Collection file envelope | 40 MiB |
| Name | 60 UTF-16 code units |
| Search input | 100 UTF-16 code units |

Public addresses and transaction history are stored unencrypted in the browser
and exported files. Secret keys, seed phrases, wallet permissions and signing
capabilities are not in these formats. Export files only to destinations the user
intends to share with. Back up files independently from browser storage.

Browser profiles, browsers, hostnames and ports are separate origins. Opening the
same app at another port will show a different local list. Clearing browser data,
private browsing, storage eviction or device loss can remove local records. The
app does not request persistent storage permission or promise permanent retention.

Unknown fields, malformed amounts, unsafe shapes, incompatible contexts,
conflicting observations, failed checksums and size limits fail closed. Corrupt
stored data is reported; it is not replaced by an empty document.

## Local file inspection

The checker reads a file without importing it, connecting a provider or modifying
browser storage. It reports token presence, period/event counts and coverage.
Its output includes public account addresses, observed amounts and, for a collection,
saved labels. Review the output before sharing it with another person.

```powershell
npm run vault:check -- "C:\path\ThreeCore-transfer-vault.json"
npm run vault:check -- "C:\path\ThreeCore-transfer-vault-collection.json" --collection --json
```

It checks declared and actual read size, strict UTF-8, schema and SHA-256. It uses
bounded reads, so a file growing after its first size check is still limited.

## Verification and preview

```powershell
node --test test/*.test.js
node --test integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4191'
node examples/dev-server.js --ui-test
```

The complete native-browser suite is at `/test/browser/`. Tests use unique
`threecore-test-transfer-vault-` database names and clean up only their synthetic
test databases. They do not open the normal vault database.

The manual route `/test/browser/transfer-vault-demo/` contains synthetic histories
for all three tokens, including gaps and several directions. Its separate
`threecore-transfer-vault-preview-only-v1` database is only for the preview.
The preview has no wallet provider and a `connect-src 'none'` policy. The normal
integrated wallet demo is at `/`. Test routes are unavailable without `--ui-test`.

Native-browser verification includes transactional concurrency, cancellation
rollback, corruption preservation, explicit remount/restore, legacy import,
collection duplicate handling, separate card review and undo/redo. These checks
do not establish that separate real wallets have been tested or that current
mainnet balances have been independently verified.
