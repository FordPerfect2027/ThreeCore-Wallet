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
