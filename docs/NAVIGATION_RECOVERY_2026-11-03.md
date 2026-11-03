# Browser recovery and continued live verification — November 3, 2026

The detached browser-control connection was recovered without requesting
another address-bar entry from the operator. Account 1 / Base Sepolia was
observed at the existing port 4231, all three cards were explicitly connected,
and DAT, EMA and CAWELON were read at block **53,572,089**. Six older observations
were retained and three new observations were added to a verified nine-record
backup. No user-wallet signature, transaction, key access or GitHub write occurred.

## Recovery paths

The new implementation at `f6f378cc9b44f33fc7e147f4626e23573de06a6c`
adds one fixed same-origin link to the local navigation-help page. The initial
cross-origin request still returns 403. Only an explicit click starts the new
navigation. The request guard, Origin/Host checks, frame restrictions, RPC
boundary and security headers are unchanged. The guide contains no script,
automatic redirect, form, wallet access or reflection of a supplied URL.
The address-bar instructions remain as a fallback.

The link behavior follows the [Fetch Metadata specification](https://www.w3.org/TR/fetch-metadata/):
an in-page same-origin navigation is distinct from the original cross-origin
request. Tests also confirm that later cross-origin/RPC requests remain refused.
This changes the application's navigation guidance, not the computer-use tool's
URL policy. No native Windows-control retry was used in the successful flow.

1. A separate server on port 4233/PID 19964 loaded the new helper; the original
   4231/PID 2108 and fixed-candidate 4232/PID 28252 were not restarted.
2. The new Edge tab initially displayed the refusal guide. Clicking its
   `ThreeCore Walletを開く` link opened the actual Wallet.
3. The six-record saved file was loaded, previewed, restored and downloaded.
   The re-export was byte-identical. Port 4233 had no allowed Wallet accounts;
   no new permission was granted there.
4. Existing rehearsal tab 148649861 on port 4231 was available through the
   supported browser API. Its visible `ThreeCore Walletを別タブで開く` link opened
   a fresh controllable Wallet tab at the already permitted original origin.

The previously detached automation tabs 148649854/148649857 were absent from
the later inventory. Their in-memory content is not claimed to have survived;
the saved file was used for recovery. The surviving rehearsal page was not
reloaded or edited.

## Actual Wallet and file results

- The allowed-account read returned the existing Account 1 address, network
  84532 and two permitted addresses.
- Restoring the earlier Account 2 card settings retained two records per token.
  An explicit DAT connection using that stale account configuration correctly
  refused the account mismatch.
- Each card then read the currently allowed address, applied it explicitly and
  connected. Three actual portfolio reads completed at block 53,572,089, hash
  `0x545c664840af2782aa11a84dc140c5c8f1b126757b62b76b7af1cba2c06a7922`.
  Each observed native and configured token balance was zero base units.
- One new record per token was added. The downloaded nine-record file passed
  its internal checksum and retained the six older Account 2 observations.
  The two accounts' histories were not relabeled or merged into one account.
- A separate browser-local checkpoint named `復旧確認 1103 — Account 1 / Sepolia / 9件`
  was saved at the original origin. The stored count increased from 2 to 3 of
  5 slots. Reloading the list and inspecting that saved entry verified its
  checksum and all nine records; the two older saved checkpoints were retained.

| Local downloaded file | Bytes | SHA-256 |
| --- | ---: | --- |
| `ThreeCore-workspace-backup (17).json` and restored `(18).json` | 7,237 each | `4fabece09fba893fc7339bb976eee752845db8bfa05a6e0411b747f32afc0fdb` |
| `ThreeCore-workspace-backup (19).json` | 10,103 | `3ebf36e36f94d12fb6b09387c723a3144933918c720ab26cd78a7c1d6ab5d4bc` |

The download-event waiter timed out for the first re-export, but the UI reported
download initiation and the file existed on disk. Its actual bytes were checked
before reporting success; no duplicate click was used as a substitute.

## Verification and limits

All **62** selected server/security/navigation cases passed without failures,
cancellations or skips. This change does not modify Wallet controller code, so
the earlier 453 targeted Node / 1,024 browser results remain separately scoped
to the diagnostic implementation. Source checks and actual Edge observations
cover this navigation change.

[Redacted receipt](evidence/2026-11-03-navigation-recovery/summary.json),
[offline backup inspection](evidence/2026-11-03-navigation-recovery/backup-check.json)
and [raw-log manifest](evidence/2026-11-03-navigation-recovery/SHA256SUMS.txt)
are saved. Full-address screen/read receipts remain in the local Downloads
folder; only their hashes are included here.

This confirms post-switch Account 1 reads and recovery. It does not retroactively
prove the live `accountsChanged` event while the former page was connected;
that page had already stopped for inactivity. Live change-event acceptance,
dependency disposition, independent review and release approval remain separate.
No 90% completion claim is made. The user-requested autonomous work loop is
recorded in the repository's `AGENTS.md` for subsequent work.
