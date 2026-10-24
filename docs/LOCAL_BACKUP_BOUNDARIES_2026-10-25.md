# Workspace export and protected handoff — 2026-10-25

Local-only work based on `c6f1c00e575b3be018ac9234b973b0f3cc070de9`.
The previous checkout is preserved. This checkout has no Git remotes and no
changes have been pushed. Only the workspace panel, its regression tests and
this document change; contracts, wallet providers and on-chain behavior do not.

## Reproduced boundaries

1. The plain backup panel checked cancellation before its final `readDraft`
   callback but not after it. A callback that stopped or disposed the panel
   could return identical data, and the old operation would still invoke the
   download adapter. Cancellation in the initial snapshot also unnecessarily
   started hashing. Cancellation inside the download adapter could be replaced
   by a stale success message and backup marker.
2. Import/staging called `controls()` to clear the old review. With an existing
   undo checkpoint this inspects the destination draft, an application callback
   boundary. Cancelling there could still let the outer ready/staging handler
   overwrite newer JSON or report a successful handoff.
3. A protected handoff had not yet marked its text as staged when protection
   arrived. Cleanup therefore skipped that in-flight handoff, allowing erased
   decrypted text to reappear in the restore input. The regression includes
   a page-hide protection event during that handoff.

These are lifecycle/data-preservation defects reproduced with controlled local
callbacks. The 21 failing baseline cases are operation/event variants, not 21
independent vulnerabilities or evidence of an external compromise.

## Changes

- Check the current operation immediately after destination callbacks, before
  starting checksum work or offering a download, and after the download adapter.
  Equal data cannot renew cancelled permission. A later explicit save still
  works, and an old operation cannot release a replacement job's busy state.
- Guard overview, backup-state and control rendering against disposal or a newer
  operation. Bound nested backup-status inspection so callbacks cannot recurse
  through that rendering path.
- Recheck both the panel generation and the reader's current state before
  inserting accepted file text. `stageText` similarly checks after cancellation
  and undo inspection and reports false when the handoff is interrupted.
- Invalidate before external cleanup callbacks. Disposal becomes terminal before
  secure-panel cleanup. Track an encrypted handoff while it is in progress;
  protection revokes that handoff before clearing plaintext and review controls.

If a download callback was already invoked before cancellation, it cannot be
retracted. Tests retain that distinction: the correction suppresses stale
success/backup reporting and prevents invocation when cancellation happens first.
Browser download initiation still does not prove that a file reached the disk.

## Verification and reproduction

`test/workspace-panel-boundaries.test.js` covers initial/final snapshot stop,
invalidation, disposal, plaintext summary exports, download-callback cancellation,
replacement jobs, explicit retry, accepted-file render and protected handoff.
All 21 cases fail against the preserved baseline and pass on the revised code.

Six added browser cases exercise the production panel with native DOM controls,
File/DataTransfer, WebCrypto hashing and isolated lifecycle events. They check
that callbacks do not offer cancelled downloads, refill erased plaintext or
write to any of the three card histories. The encrypted handoff fixture uses a
deterministic decryption adapter to isolate interruption timing; existing suites
continue testing actual encryption/decryption separately.

```powershell
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-concurrency=2 integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4213'
node examples/dev-server.js --ui-test
```

The focused browser route is `/test/browser/?suite=workspace` (31 cases).
The full route is `/test/browser/`. Final counts, logs, screenshot evidence,
baseline reproduction and verified backup archives are stored beside this
checkout in `wallet-backup-boundaries-verification-20261025`.
Repeated focused runs and expected failing baseline runs are not added to the
passing full-suite total. Unchanged contract/EVM tests are not recounted.

## Progress toward the testnet milestone

This completes additional local backup, interruption and plaintext-protection
acceptance checks within the existing read-only milestone. The acceptance scope
in `LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md` still applies. The remaining real-wallet
gate requires three separately prepared DAT/EMA/CAWELON accounts, their actual
permission UI, balances, save/reload/restore and reconnect checks. The user has
deferred that gate until the accounts are ready. Test counts do not establish a
completion percentage; that gate has not been marked complete or scored as 90%.
