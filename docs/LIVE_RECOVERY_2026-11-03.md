# Fresh-tab recovery and nine-record preservation — November 3

A fresh Microsoft Edge tab at the preserved candidate server on port 4233
was opened through its explicit same-origin navigation-help link. The original
4231 rehearsal pages were kept; their automation handles did not respond.
No working user page or original server was reloaded or restarted.

The actual nine-record backup was selected through the browser filechooser.
Its checksum passed, the preview showed zero removals and three additions per
card, and the explicit restore completed. The overview showed three configured
cards and nine records. The two recorded account identities and original block
numbers were retained; saved data did not recreate Wallet permission.

The exported file `ThreeCore-workspace-backup (21).json` is **10,103 bytes** and
byte-identical to `ORIGINAL-nine-records.json`, with SHA-256:

`3ebf36e36f94d12fb6b09387c723a3144933918c720ab26cd78a7c1d6ab5d4bc`

The browser's download-event wait timed out, but the single requested file
was present on disk. Its bytes were compared directly before reporting success;
the download was not repeated merely because the event did not arrive.

## Connection state and limits

The permitted-account read for origin 4233 returned no allowed accounts.
Connecting with the restored Sepolia card configuration reported a network
mismatch. Changing only the DAT card's requested network to Base Mainnet led
to a Wallet-permission wait. That subsequent card-setting edit is outside the
byte-identical export above and does not relabel its saved observations.

The MetaMask confirmation was not exposed through the browser-control tab
inventory. The operator was asked only for the existing Account 1 connection
at this exact origin. The page subsequently stopped for protection while the
confirmation was pending. No successful permission grant, connected account,
live account/network-switch event, or fresh balance read is claimed here.
The pending original-profile extension action was not bypassed.

Local full-address originals and a screenshot are preserved in Downloads under
`ThreeCore-live-recovery-20261103-0440/`. The public-ready record contains only
their digests in the [receipt](evidence/2026-11-03-live-recovery/summary.json).
Browser filechooser selection does not prove native Windows picker traversal.
No signature, transaction, private-key access or GitHub publication occurred.

## Later Account 1 permission and connection confirmed

After the operator reported connecting Account 1, a fresh tab at the same 4233
origin read one permitted address matching the previously recorded Account 1
and Base Mainnet. The unresponsive earlier tab was preserved. The actual
nine-record file was restored, and all three cards explicitly connected at
chain 8453. This closes the earlier **4233 permission/connection** dependency;
the earlier paragraph's permission wait is historical.

The new 10,100-byte export, `ThreeCore-workspace-backup (22).json`, has SHA-256
`0c1981e2e49654961fa98b66ea8696e6efd5897af47ca4791715babb124e2ae0`.
Its internal checksum passed. All nine historical records are identical to
the original, including their Sepolia identities and block numbers. Only the
three requested card networks changed to Mainnet; those settings do not
relabel historical records. The historical collections' canonical JSON digest
is `a450048a9e25861d62561a0db5efa553f664b3efaf15c96f4eb9cb1fe45a3107`.

The operator then reported changing the 4233 site network to Base Sepolia.
At **10:48:25 JST on November 3**, all three cards still displayed connected
at 8453, and the protection log contained only its start entry. A subsequent
DAT native-balance read completed and rendered Mainnet block **53,440,599**.
The read path confirms the Wallet's account/chain before and after returning
data; the source was inspected to confirm that boundary. The requested new
chain was not observed, so this does not prove either a successful live
`chainChanged` test or an event-handler defect. Do not equate the operator's
reported selection with the chain returned to the controlled page.

Native window inventory showed Edge's Extensions page. An attempt to inspect
that window ended Computer Use because the tool could not establish the current
browser URL. Its explicit stop instruction was followed. The operator was asked
to select the actual 4233 Wallet tab; no further connection approval was requested.
Browser controls, protections and extension restrictions were not bypassed.

Full-address receipts and the connection screenshot are in the local Downloads
folder `ThreeCore-live-event-20261103/`. The local file named
`after-network-switch.json` records **after the reported change**, not a verified
network-switch event. Its exact hash and the other local file hashes appear in
the [follow-up receipt](evidence/2026-11-03-live-permission-followup/summary.json).
The nine-record equality above is the saved state before this reported switch;
history preservation after an actual observed switch remains to be verified.

## Protection-stop follow-up and active-network selection

The supported browser tab remained accessible in the next turn. Its protection
log recorded a page-hidden stop. After explicit resume, the permitted-account
probe still returned Account 1 and Base Mainnet. All three cards were explicitly
reconnected at **10:58:07 JST**. The exported `(23).json` was byte-identical to
the 10,100-byte before-switch backup: all nine original historical records survived
the protection stop and reconnect.

At **11:04:05 JST**, all three cards were stopped again. The log specifically
reported inactivity, consistent with the unchanged five-minute protection setting.
The subsequent `(24).json`, saved at **11:05:18 JST**, was also byte-identical to
the before-switch backup and passed the saved-file inspector's internal checksum
validation. This establishes preservation and export after those protection stops;
it is **not** a live `chainChanged` acceptance result. The stop's event time is not
recorded by the UI; 11:04:05 is the observation time.

MetaMask's [active-network instructions](https://support.metamask.io/configure/networks/how-to-change-networks)
distinguish the current dapp network from the asset-list filter. Its
[permission instructions](https://support.metamask.io/more-web3/dapps/manage-dapp-permissions/)
separately describe which networks a dapp is permitted to access. The operator was
given the exact active-network path: open the 4233 Wallet tab, open MetaMask's site
icon, select the current **Base** display, then **Base Sepolia**, retaining Account 1.
That follow-up has not yet been observed. The Japanese guide now uses the origin
displayed by the actual card rather than prescribing port 4231 for every session,
and requires recording switch evidence before manual disconnect or setting edits.

Local receipts `after-visibility-stop-and-resume.json` and `after-idle-stop.json`
contain the actual downloads; `active-network-check-pending.json` and
`protection-stop-observed.jpg` record the later stopped state. Export-event waits
timed out but each requested download was found and validated on disk without
repeating the same export. The latest tab is preserved with protections enabled.

This follow-up is outside the sealed `128ee11` review ZIP. It does not change
source code, rerun the full test suite, perform a transaction, establish
independent review, or assert 90% completion.
