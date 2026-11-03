# Permitted-account input: current summaries and backup status

## Finding and correction

Implementation revision: `7bdb23d3398e1e92582a602bb22f06d364825412`.
Parent: `4837cd3`.

The actual Wallet at port 4233 showed two distinct configured addresses after
all three account inputs had been changed to the same permitted account. Its
newly downloaded backup contained one configured account across the three
cards and retained all nine saved observations. The overview was stale; the
backup contents were not corrupted.

The permitted-account confirmation invalidated pending reads, restore previews
and summaries before writing the new account input. That ordering correctly
prevented old operations from committing, but the summaries rendered the old
input and were not refreshed after the new input was written. The same ordering
could leave the backup indicator describing an earlier saved address as current.

The correction keeps every pre-write invalidation and current-context check.
After committing the reviewed address, it refreshes only the configuration
summary and backup-state display. These refresh operations reuse the existing
disposal, generation and reentrancy guards. They do not dispatch another input
event, grant permission, connect a card, query balances or save a file.

The checkpoint panel was also inspected: its invalidation marks an in-progress
save as changed and publishes controller state; it does not cache a new current
account summary, so it needs no corresponding post-write refresh.

## Verification scope

Two browser regressions cover the complete application flow: confirming the
same permitted account for the final card must immediately show one distinct
address and shared status on all three cards; changing a previously saved
address must immediately mark the backup as changed without a second download.
Both use the existing synthetic provider. Provider calls are restricted to
existing-permission and network reads; the test intercepts the synthetic
download offer and restores its interceptor in a finally block.

The pre-fix browser run failed the backup-status regression as expected. It
completed the first shard with 512 passes and one failure, and did not execute
the second shard. The first post-fix run reported 513 passes in each shard,
with no case failures, but its final browser-process cleanup timed out. That
run is retained as a failed command, not a clean full-suite pass. A subsequent
process inventory found no surviving test-profile browser processes; the failed
run's temporary profile was retained.

The four targeted Node suites passed all 81 cases. The complete Node/HTTP run
then passed **16,470 cases**, with no failures, cancellations, skips or todos
(729,360 ms). After that command finished, the complete browser rerun passed
**1,026 cases**, 513 in each shard, including successful process/profile cleanup
and exit code 0. The earlier cleanup failure was not suppressed and no runner
timeout or shutdown rule was changed to obtain this result.

The two new browser cases extend the previous 1,024-case suite; the 81 targeted
cases overlap the full Node run. These counts must not be summed into features.
The implementation and test files match the fixed revision above; later changes
are documentation and collected receipts only.

## Actual data preservation

The actual current backup was downloaded before the correction and read from
disk. Its 10,103 bytes match the prior backup exactly, including all nine
histories and three cards. Both originals remain in the operator's Downloads.

- Whole-file SHA-256: `6e4e79f3cb6efcb3cf49169779918e4bd6dd032b54a3c9d6af6d8cf5071e6c2a`.
- Canonical histories SHA-256: `a450048a9e25861d62561a0db5efa553f664b3efaf15c96f4eb9cb1fe45a3107`.

## Actual Edge follow-up

The separately restored prior review (`36ed431`, ordinary server at port 51031)
accepted the actual file through the supported browser file chooser. Reviewed
restoration displayed three cards and nine records. Its 10,103-byte re-export
matched the original. The separately restored correction (`7bdb23d`, ordinary
server at port 61862) then loaded that export, displayed the same nine records
and re-exported identical bytes. Neither file restoration connected a wallet.
The new origin correctly reported no existing wallet permission.

For the actual permission-input regression, a fresh tab used the already
permitted origin at port 4233. The three affected JavaScript responses were
first compared byte-for-byte with the corrected source and carried `no-store`.
The original running server and user tab were not restarted or reloaded. This
establishes the corrected client behavior there, not a server-version migration.

That fresh tab restored the nine-record file. DAT's configured address was
temporarily changed to the known Account 1 public address and saved, while the
site's actual MetaMask permission remained Account 2 / Base Sepolia. At that
point the overview correctly showed two configured identities and the backup
indicator reported the current contents had been offered for download.
The permission read returned one permitted address, Account 2, on chain 84532.
Confirming that address immediately changed the overview to one identity shared
by all three cards and changed the backup indicator to `changed`. No Connect
button was used. The final re-export matched the original bytes exactly; even
the temporary two-identity backup retained the nine histories unchanged.

Download-event waits sometimes timed out although the browser had saved the
file. Actual files (32) through (36) were inspected on disk rather than treating
those observation timeouts as missing data. Screenshots and full backups remain
in the operator's Downloads recovery folder; the receipt includes their hashes.

## Evidence and limits

- [Commands and outcomes](evidence/2026-11-03-account-input-refresh/test-results.json)
- [Implementation inventory](evidence/2026-11-03-account-input-refresh/implementation-inventory.json)
- [Actual restoration, permission-input check and file hashes](evidence/2026-11-03-account-input-refresh/live-restoration-and-refresh.json)
- [Four exact restored source trees](evidence/2026-11-03-account-input-refresh/source-restoration.json)
- [Hash manifest](evidence/2026-11-03-account-input-refresh/SHA256SUMS.txt)

This is developer verification, including the bounded actual Edge exercise
above. It does not extend the earlier MetaMask account/network-switch acceptance
to new directions or in-flight races. The original native Windows picker path
remains unobserved; the supported browser chooser and saved bytes were checked.
No user-wallet signatures, transactions or secrets were used. No percentage,
independent audit or public release is inferred from these results. Original
servers and working tabs are preserved. GitHub publication remains deferred.
