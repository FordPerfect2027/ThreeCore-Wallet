# Developer-review update: delivery and recovery verification

The follow-up to the sealed b7df758 review package is saved as
ThreeCore-developer-update-36ed431-20261103.zip in Downloads. It is an incremental
update requiring the earlier package, not a standalone replacement.

- Archive size: 57,038 bytes.
- SHA-256: 950faba66f72cd62cc701b384e5f4028c3892bbce08c326dbf3417bb6ecf3278.
- Wallet revision: 36ed4318806b8ee0921471dba5600d0e048b7d7f.
- Token revisions and exact content trees: [update receipt](evidence/2026-11-03-developer-update-delivery/update-receipt.json).

## Verified delivery

The original b7df758 ZIP still matches its recorded 54,302,493 bytes and SHA-256
54ed750ab4cebbe1dec85f3cd2cb2e75dd6be5041cf52fd87d69c0d7de6d8671.
All 32 files in its extracted package and all nine listed files in the new
update matched their manifests. A fresh extraction of the update ZIP matched
again. Altering one copied DAT bundle caused checksum rejection before the
restoration directory was created; replacing the original bytes restored a pass.

The supplied restore-update.mjs restores four repositories into a new directory
that must not already exist. It first verifies both packages, checks the exact
base and update bundles, then restores each pinned revision. It does not modify
an existing user checkout or install dependencies.

The actual restoration produced the four expected commits and content trees,
clean working files, no remotes and successful Git object-integrity checks.
The restored Wallet's evidence checker then matched **271 manifests / 2,946
entries / 124,509,305 bytes**. These counts describe saved evidence, not features
or independent tests. The first evidence-check invocation used a subdirectory
instead of a repository root; correcting that argument produced the recorded
success, without changing the checker or evidence.

## Actual backup through the two review versions

In the separate restored Wallet, a fresh Node process loaded the actual current
Account 2 backup at the new revision, then b7df758, then the new revision again.
Each decoder verified the internal checksum and returned three cards with all
nine observations. Re-export reproduced the original 10,103 bytes in all three
steps. The input file was only read.

- Whole-file SHA-256: 6e4e79f3cb6efcb3cf49169779918e4bd6dd032b54a3c9d6af6d8cf5071e6c2a.
- Canonical histories SHA-256: a450048a9e25861d62561a0db5efa553f664b3efaf15c96f4eb9cb1fe45a3107.

This confirms offline data compatibility of this review update. Runtime code
is unchanged between these revisions. It is not a browser deployment rollback,
new MetaMask acceptance, native-picker evidence or compatibility with the older
public 07041f0 checkpoint. The latter's history-only limitation still applies.

The original processes remained present with their prior start times: 4231
PID 2108, 4232 PID 28252 and 4233 PID 19964. Direct requests returned the Wallet
with HTTP 200 for all three. A socket-list query initially returned only 4233;
the process and HTTP checks did not establish an outage, so no restart occurred.

## Evidence

- [Restoration results](evidence/2026-11-03-developer-update-delivery/restoration-result.json)
- [Archive, alteration control and restored evidence](evidence/2026-11-03-developer-update-delivery/distribution-summary.json)
- [Nine-record compatibility observations](evidence/2026-11-03-developer-update-delivery/backup-rollback-result.json)
- [Offline backup probe](evidence/2026-11-03-developer-update-delivery/probe-backup.mjs)
- [Hash manifest](evidence/2026-11-03-developer-update-delivery/SHA256SUMS.txt)

This receipt is later than the sealed update and is stored separately. The
[developer review](DEVELOPER_REVIEW_2026-11-03.md) defines its scope. No GitHub
write, user-wallet signature, transaction or secret access was performed.
