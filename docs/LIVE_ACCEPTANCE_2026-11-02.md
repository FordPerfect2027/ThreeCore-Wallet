# Intended-PC acceptance progress — November 2, 2026

Latest: the [Account 2 / Base Sepolia follow-up](#account-2--base-sepolia-successful-follow-up)
below completes three-card reads, actual file selection, same-tab restoration
and explicit reconnection. The earlier Mainnet observations are retained below
as their own checkpoint. Live account/chain-change invalidation and full
candidate-server migration remain separate, uncompleted checks.

After the operator selected the existing Microsoft Edge rehearsal tab, its
control connection responded. The existing MetaMask permission exposed one
account on Base Mainnet. Three token cards were explicitly connected to that
same existing account. No new account, funding, signature, approval transaction
or transfer was required. These are Mainnet read-only observations, not Sepolia
acceptance or three independent wallets.

| Token | Identity-read block | Saved portfolio block | Token balance, smallest units |
| --- | --- | --- | --- |
| DAT | 53,395,642 | 53,395,700 | 0 |
| EMA | 53,395,722 | 53,395,743 | 0 |
| CAWELON | 53,395,750 | 53,395,754 | 0 |

The identity reads matched the registered names, symbols and decimals, found
contract code, and passed the bounded supply/balance comparisons. Each JSON
records its own canonical block hash. They are separate block observations;
the displayed values are not an aggregate or a later/current balance claim.
This metadata check does not prove contract safety or exact deployed source.

## Save, restore, reconnect and stop

1. Saved each identity result, and added one newly read portfolio observation
   to each card's history. Saved the actual combined workspace to Downloads.
2. Opened a separate, empty Wallet tab through the rehearsal's same-origin
   link, leaving the source tab and original server running.
3. Selected the actual downloaded workspace through the documented browser
   file-chooser API. The checksum passed. The preview showed three settings
   changes, three added observations and zero removed existing observations.
4. Confirmed the preview and restored. All three cards remained disconnected.
   The UI comparison reported matching settings, token lists and full histories
   on all three cards. Re-exported the restored workspace.
5. Explicitly selected MetaMask and reconnected each restored card. Started a
   DAT read, observed it pending, then used the ordinary three-token Stop control.
   All cards became disconnected; the in-progress result remained unconfirmed
   after later inspection. Each accepted history remained at one observation.
6. Saved again after Stop. All three actual workspace files are byte-identical:
   **4,410 bytes**, SHA-256
   `17d16f8c10f571ba04b23be790640cab36ccbae5feeddca44e6a4433328ac989`.
   The resume control did not automatically reconnect any card.

The same session restored the pre-existing fictional rehearsal workspace into
the empty selected rehearsal tab: DAT 3, EMA 2, CAWELON 1 records. Its preview
was saved before applying. The re-export matched the original **4,771 bytes**,
SHA-256 `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`.
That simulation result is distinct from the actual-account observations above.

## Scope and retained evidence

Application source on disk was `96b59459a0f593246c60f0bed4b52052211a464a`;
the checkout was `e5841f0d1b412b516b3e3eb4a81d75eabaf81edd`, whose only later
code change is the [test-only native-crypto wait correction](NATIVE_CRYPTO_TEST_WAIT_2026-11-02.md).
Fresh client tabs loaded the current assets. The original port 4231 server,
PID 2108, started October 30 at 00:41:41 JST and was not restarted. Its already
imported server modules were preserved. This is not a complete fresh-candidate
server deployment or a test of the new relay limit on that original process.

[The local evidence summary](evidence/2026-11-02-release-regression/live-mainnet-acceptance-summary.json)
records checks, block hashes and file digests. Actual downloaded account files,
screenshots and the Stop observation are preserved under
`Downloads/ThreeCore-private-live-acceptance-20261102`. The summary omits the
account value; the recording method identifies the observed public account.
Checksums detect alteration; they do not authenticate provenance. The recording
method validates saved bytes and records observed UI actions; it is not an
automated browser replay or an independent audit.

Remaining: the two-existing-account switch, chain-switch behavior on the real
wallet, Sepolia acceptance, full candidate deployment/version return and
independent review. Native Windows picker traversal was not exercised: the real
files were selected through the browser's supported file-chooser API. These
results advance the file/reconnection checks without closing all release gates
or establishing a completion percentage.

## Existing-account context rejection — 11:04–11:06 JST follow-up

The existing restored Wallet tab responded through its retained browser
connection. Reclaiming the rehearsal tab still timed out; that tab was not
reloaded. The Wallet retained one saved portfolio observation per token.

With the actual MetaMask Account 1 permission still on Base Mainnet, the DAT
card was explicitly reconnected and then changed to Base Sepolia in the card's
own configuration. The card immediately disconnected. A new Connect attempt
reported a network mismatch and left the balance-read button disabled. Returning
the card to Mainnet and explicitly connecting succeeded.

Next, the DAT card was set to the other previously saved public account while
MetaMask's selected account remained unchanged. This disconnected the card;
Connect then reported an account mismatch and left the balance-read button
disabled. Restoring the original account and explicitly reconnecting all three
cards succeeded. These are real-provider **mismatch rejection** checks, not an
actual MetaMask account or network switch.

The subsequent actual workspace download is byte-identical to the earlier
4,410-byte backup, with the same SHA-256 above. It preserves all three settings,
token lists and full histories. The browser download listener timed out after
15 seconds, but the file was already present in Downloads and was verified
directly; the download action was not repeated. The ordinary Stop control was
then used on the tested tab, without broadcasting to other tabs.

[The redacted follow-up receipt](evidence/2026-11-02-release-regression/live-context-acceptance-summary.json)
and recording method retain the exact source checkpoint, observed steps and
private evidence digests. Actual files, screenshots and visible-state records
are in `Downloads/ThreeCore-private-context-acceptance-20261102-Fg9Opw`.
The source checkpoint was `2e470d9`; application source remained `96b5945`.
No product code changed, new balance was read or full regression rerun in this
sequence. The original 4231 process remained PID 2108 with its original start.

Native Edge inspection subsequently stopped because the automation tool could
not establish the browser's current URL. No native browser input followed.
The actual MetaMask account/chain switch, Sepolia acceptance and full candidate
migration remain open; the new evidence does not complete those separate steps.

## MetaMask site context and guidance — afternoon follow-up

The operator reported selecting Account 2 and Base Sepolia, and subsequently
changing the connection settings for `127.0.0.1`. The retained Edge Wallet tab's
ordinary permitted-account control was read again after each report. Both reads
still returned the prior Account 1 public address, Base Mainnet and one permitted
account. No address was applied, no card connected and no new balance was read.
These observations do not establish a completed account or network switch.

MetaMask's official documentation distinguishes the asset display from each
connected site's network and permitted accounts. This explains a possible
source of confusion; it does not establish why this particular tab continued
returning the old context. The browser/profile and actual site settings still
need to be confirmed. A planned fresh-tab recheck did not complete. Native Edge
inspection again stopped because the tool could not establish the current URL;
no native browser input followed. The original tab and server were preserved.

At `7c12a280649ee56d52165d9412db3af4c5bd4770`, the account preview helper text,
account/network mismatch messages and Japanese operator guide were updated to
direct the operator to the connected site's settings. No RPC dispatch,
permission handling or identity guard changed. The existing command
`node --test test/permitted-account.test.js test/wallet-card-controller.test.js test/connection-boundaries.test.js`
passed **82 tests, zero failures**, as recorded in the development session and
commit message. These are automated local cases, not 82 real-wallet exercises.
The preserved live tab was not reloaded to display the new source, and the
complete regression was not repeated for this copy-only change.

The first follow-up's visible result and screenshot remain private under
`Downloads/ThreeCore-private-site-context-20261102-0P9ZM8`. They were saved before
the operator's subsequent site-settings report and must not be presented as a
screenshot taken after that later change. The later read was observed in the
live tool output. Sepolia, actual account/chain switching and candidate migration
remain open. The next clarification is which browser/profile holds the changed
MetaMask connection, rather than requesting the same switch repeatedly.

Official references: [per-site network selection](https://support.metamask.io/configure/networks/how-to-change-networks)
and [dapp permissions](https://support.metamask.io/more-web3/dapps/manage-dapp-permissions/).

## Account 2 / Base Sepolia successful follow-up

After the operator supplied a photo of the working Wallet and MetaMask, the
existing Edge Wallet tab became controllable with the requested context. Its
ordinary permitted-account button returned Account 2 on Base Sepolia, chain
84532, with two permitted addresses. All three cards were explicitly connected
to the displayed Account 2 address. This is one observed account serving three
token cards, not three independent wallets.

The tab now displayed the site-specific guidance added at `7c12a28`, with empty
histories. The agent did not reload it. The prior in-memory Mainnet histories
are not claimed to have survived the operator intervention; all four previously
saved 4,410-byte Mainnet backups were checked and retained their original
`17d16f8c10f571ba04b23be790640cab36ccbae5feeddca44e6a4433328ac989`
SHA-256. The original port 4231 process remained PID 2108, started October 30
at 00:41:41 JST.

| Token | Identity-read block | Saved portfolio block | Token balance, smallest units |
| --- | --- | --- | --- |
| DAT | 53,413,786 | 53,414,276 | 0 |
| EMA | 53,413,786 | 53,414,584 | 0 |
| CAWELON | 53,413,972 | 53,414,584 | 0 |

All three identity panels reported agreement with the registered information:
contract code present, names/symbols/decimals matched, and supply/balance checks
within bounds. Separate identity JSON files were actually downloaded. Each
portfolio observation was added once to its card's saved history. Identity and
portfolio blocks differ; they are not a common current balance checkpoint.

The actual combined backup was `ThreeCore-workspace-backup (13).json`, 4,371
bytes. Its internal checksum was accepted by both the UI and the offline
decoder. After saving, the DAT token input list was deliberately cleared for a
bounded restoration exercise; histories were left intact. The documented
browser file chooser selected that real file. The restore preview showed one
DAT token being re-added, no removed history, and one duplicate history record
per card. Applying it disconnected the changed DAT card while the unchanged
EMA/CAWELON cards retained their connections. The UI then reported all three
settings, token lists and full histories matching the selected file.

The ordinary Stop control disconnected all cards. Resume did not automatically
connect them. All three were explicitly reconnected to Account 2 / Base Sepolia.
The resulting `ThreeCore-workspace-backup (14).json` was byte-identical:

`97f0ff6650a6beb26077cb2257e6668c337a7cb8d579f687451990c85988efe4`

The browser's download listener timed out for the first identity export, but
the actual file was already present in Downloads; that download was not
repeated. Other exports were likewise checked on disk. No failure was counted
as a pass without the saved bytes.

The [redacted receipt](evidence/2026-11-02-release-regression/live-sepolia-acceptance-summary.json)
and [recording/checking method](evidence/2026-11-02-release-regression/live-sepolia-record-method.mjs)
pin source `8e5079d` and application `7c12a28`. Thirteen original evidence files
are retained in `Downloads/ThreeCore-private-sepolia-acceptance-20261102-HATjJE`,
with checksums and a summary. No product code changed and no full regression
was rerun for this live acceptance.

This closes the scoped Sepolia read/save/restore/reconnect exercise. It does
not establish live `accountsChanged` / `chainChanged` invalidation: the earlier
Mainnet session had been stopped before the operator changed context. Restore
was into the same tab after a token-list edit, not an empty tab or a newly
started candidate server. Native Windows picker traversal, complete candidate
migration/return, dependency disposition and independent review remain open.
No transaction was signed/submitted, no secret key was read and no release
percentage was calculated.

## Fixed-candidate restore on port 4232 — connection pending

Historical intermediate state; the completed follow-up below supersedes its
pending connection and return status. The original receipt is retained.

The operator subsequently opened the separately started candidate on port 4232
in the former Wallet tab. Its empty three-card state was observed before any
import. The agent selected the actual `ThreeCore-workspace-backup (14).json`
through the supported browser chooser, accepted the internal checksum, and
inspected the restore preview: each card changed from zero to one history
record, with no existing record removed. Explicit confirmation restored all
three settings, token lists and histories, leaving every card disconnected.

The in-page comparison reported a complete match with the selected file.
The actual re-export, `ThreeCore-workspace-backup (15).json`, is byte-identical
to `(14)`: 4,371 bytes, SHA-256
`97f0ff6650a6beb26077cb2257e6668c337a7cb8d579f687451990c85988efe4`.
Its saved observations still identify their original port 4231 and blocks.
Restoring them into port 4232 does not relabel them as new candidate reads.

The new origin's ordinary permitted-account probe returned no permitted
account. One normal Connect request was started. The application's wait
expired while the MetaMask confirmation remained unresolved; no second
permission request was issued. The operator was asked to connect Account 2
to this specific origin on Base Sepolia. That response remains pending.
The inactivity protection subsequently stopped connections, while all three
restored histories remained at one record. Reconnection and return to the
original server have not been completed.

The ordinary rehearsal link did not produce a visible new tab. Direct navigation
of the unused error tab to the rehearsal route remained refused. That duplicate
error tab was closed; the restored Wallet tab remains available. The original
4231 server and candidate 4232 server were observed running with their recorded
start times. Original backups were retained. The previous in-memory Wallet page
is not claimed to survive the operator's navigation into the candidate.

The [restore-progress receipt](evidence/2026-11-02-release-regression/live-candidate-restore-progress.json)
pins candidate `f52109a`, identifies the preserved private evidence and records
the incomplete connection/return steps. This is actual new-candidate restoration
evidence, not completion of the entire migration gate. No application code,
remote repository or permission boundary was changed for this sequence.

## Fixed-candidate migration and return completed

After the operator approved Account 2 for the candidate origin, the ordinary
permitted-account probe returned that account on Base Sepolia (84532), with
one permitted address. Each of DAT, EMA and CAWELON was explicitly connected.
All three new portfolio reads completed at block **53,463,168**, block hash
`0xd105046941a06d5a7cfb55d65dc3f678b78b8d457e9fd0ee52117358a1b92b75`.
Contract code was present and the recorded token/native balances were zero.
These are new port 4232 observations; the earlier port 4231 observations retain
their original origins and blocks. Adding each result once produced two records
per card, six overall, with no original observation changed.

The actual candidate download, `ThreeCore-workspace-backup (16).json`, is
7,237 bytes. Connections were stopped before navigating back to port 4231.
That page was empty; data was explicitly restored through the real browser file
chooser, checked preview and confirmation, not claimed to survive in memory.
The in-page comparison matched settings, token lists and complete histories.
`ThreeCore-workspace-backup (17).json` is byte-identical to `(16)`, SHA-256:

`4fabece09fba893fc7339bb976eee752845db8bfa05a6e0411b747f32afc0fdb`

The original origin's permitted-account probe returned Account 2 / Sepolia and
two permitted addresses. All three cards explicitly reconnected. The
[Wallet return receipt](evidence/2026-11-02-release-regression/live-candidate-wallet-return-summary.json)
records the observed sequence and hashes of fifteen preserved private artifacts.

The ordinary rehearsal link subsequently opened a fresh candidate rehearsal tab
when activated with Enter. The earlier direct-navigation refusal was not bypassed
and no origin guard changed. The real `ThreeCore-operation-workspace.json` was
previewed and restored: DAT 3, EMA 2, CAWELON 1 fictional records. Its actual
candidate re-export `(22)` is byte-identical, 4,771 bytes, SHA-256:

`b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`

The existing combined `ThreeCore-rehearsal-session (14).json` then added its
three saved comparison cases through preview and confirmation. Candidate export
`(15)` was imported into a separate empty rehearsal tab at the original origin,
again using the real file chooser and explicit confirmation. No old user
rehearsal tab was reloaded or overwritten. The original, candidate and returned
`(16)` session files are all byte-identical: **17,387 bytes**, SHA-256:

`22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c`

Both live displays recalculated the same fictional totals: DAT 28 SIM profit
and 2.8 SIM reserved, EMA -42 SIM, CAWELON -1 SIM with one open position.
The saved session also passed the existing decoder/recalculation. The
[rehearsal return receipt](evidence/2026-11-02-release-regression/live-candidate-rehearsal-return-summary.json)
and [saved-file checking method](evidence/2026-11-02-release-regression/live-candidate-rehearsal-record-method.mjs)
identify fifteen private artifacts. The checker validates actual downloaded
bytes; UI evidence comes from the observed page actions and saved screenshots.

These steps close migration to the separately started fixed candidate `f52109a`
and return to the preserved running development server for both Wallet and
rehearsal. Original PID 2108 retained its October 30 start time; candidate PID
28252 retained its November 2 start time. The return server serves current client
files, so this is not rollback to a separately pinned older public release.
Actual connected-wallet switch-event invalidation, native OS picker traversal,
dependency disposition and independent review remain separate. No product code
changed, full regression rerun, signature, transaction, key access or GitHub
write was performed in this sequence. No release percentage was calculated.

## Network-switch target follow-up

After restoring the six-record backup again, all three cards were explicitly
connected to Account 2 / Base Sepolia at port 4231. The operator reported changing
the site's network to Base. However, all three cards still displayed chain 84532,
and an ordinary DAT portfolio read completed on Sepolia at block 53,469,807.
The permitted-account control is disabled while connected, so DAT alone was
explicitly disconnected before probing. MetaMask still returned Account 2,
Base Sepolia and two permitted addresses for this tab. All histories remained
at two records per card. The extra diagnostic read was not added to history.

The exact site origin changed in MetaMask is being clarified. This is not
evidence that live chain-change invalidation passed, nor sufficient evidence of
a handler defect: the tab's actual provider continued reporting Sepolia.
The [context follow-up receipt](evidence/2026-11-02-release-regression/live-network-switch-context-followup.json)
preserves the observations and hashes of eight private artifacts.

To make the target easier to compare with MetaMask, `dfc0746` adds the exact
site origin as plain text beside each permitted-account panel. A separate empty
Edge tab displayed the correct `http://127.0.0.1:4231` on all three cards, with
261px client and scroll widths. The working Wallet tab was not reloaded; the
display-only test tab was closed. The existing permitted-account and setup-panel
suites passed 58 cases. RPC behavior, permissions and the fixed `f52109a` source
archive were unchanged. That archive predates this one-line display addition.
