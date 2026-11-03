# Shared accounts and the real-wallet acceptance matrix

Update: the [intended-PC Mainnet sequence](LIVE_ACCEPTANCE_2026-11-02.md) now
exercises three cards sharing one actual MetaMask account, all three identity
reads, full workspace save/restore, explicit reconnect and pending-read Stop
with preserved histories. It does not cover a two-account or chain switch,
Sepolia, or full candidate-server migration. The synthetic results below remain
separate evidence.

The supported product has three **token cards**, not a requirement for three
different wallet accounts. The operator confirmed that no new account should
be required merely to use DAT, EMA and CAWELON. Existing accounts may be shared.
The earlier three-distinct-real-account gate conflated a useful isolation test
fixture with an end-user prerequisite. It must not block unrelated development.

## Defect and correction

Inspection found the same mistaken policy in the product: configuration export
and workspace backup rejected a repeated account with `SETUP_DUPLICATE` /
`WORKSPACE_DUPLICATE`, and the permitted-account input refused an address already
used on another card. A separate connection-handler check also rejected the
same account. The footer told users to use separate addresses.
Thus saying shared accounts already worked throughout the product was premature.

The correction permits repeated normalized addresses across distinct DAT/EMA/
CAWELON entries. It reports configured cards and distinct public addresses
separately and identifies sharing. It retains rejection of repeated agent IDs,
malformed addresses, unsupported chains, contradictory histories and stale
restores. Each observation remains bound to its agent, account, chain, token,
origin and block. Sharing does not authorize a connection or combine balances.

New settings/workspace tests reproduce failure with one shared account and with
two accounts across the three cards. Browser acceptance also covers one shared
provider: distinct token balances/histories, save/remount/review/restore with no
permission restored, explicit reconnect, and an account change while a read is
pending. The two independent-provider and shared-provider scenarios complement
each other; one is not evidence that the other was exercised on a real wallet.

The original settings/workspace reproductions failed all four cases before the
correction. The affected unit suites then passed 624 cases. The first complete
browser attempt exposed the remaining connection-handler check: 510/511 cases
passed in its first shard, which failed overall and did not run the second shard.
After correcting that handler, all 13 focused acceptance cases passed, including
the two new shared-provider lifecycles. The final source at
`34d173112d7f45475c52fb64553cfa8b369699d2` then passed all 16,451 Node/HTTP
cases and all 1,021 synthetic browser cases (511 + 510). Focused results overlap
these totals; they are not additional unique cases.

The same Wallet source passed 150 compatibility cases against freshly compiled
DAT, EMA and CAWELON artifacts (50 each). Each pinned token source was exported
into a new directory with no prior build artifacts or cache. Existing dependency
installations were reused; this is a fresh compile, not a fresh dependency install.
These checks use local EVMs and do not exercise the user's wallet or submit
transactions on a public network.

Separately, a read-only public Base Sepolia query at block 53,169,113 observed
zero raw balance for each of the three configured tokens at each of the two
recovered accounts: six observations. Contract code was present for all three
tokens, reads used the canonical block hash, and the header was checked again.
This does not verify MetaMask permission, account ownership, the token's safety,
or the pending browser workflow. The account-specific raw record stays in
Downloads. The evidence package contains only a redacted summary and its source
digest, which is not a substitute for the raw record for independent checking.

See the [logs, source scope and checksums](evidence/2026-11-02-shared-account-acceptance/README.md).

Existing distinct-account V1 backups remain readable and retain their original
bytes. A new V1 backup that uses shared addresses can be rejected by older
versions enforcing uniqueness; keep the original pre-upgrade files when testing
return to an older version. Do not change a source backup merely to satisfy an
older reader. The live original tab still runs its already loaded code until a
separate page is opened; it is not reloaded to deploy this correction.

## Saved-file version return preparation

After packaging the candidate, fourteen actual previously downloaded files
were checked with both the prior `b2270b2` source and candidate `59b63ca` source:
nine checksummed workspace backups, two settings files and three saved-list
collections. Both versions decoded identical records. The candidate's exports
were then read by the prior version with identical decoded content and stable
canonical re-encoding. Original source bytes were checked again and retained
unchanged in a private local return kit. No source backup was overwritten.

The new, unapplied shared-account settings candidate was checked separately:
the current reader accepts it and the older reader rejects it with
`SETUP_DUPLICATE`, as expected. Return to the prior version must use the
pre-upgrade settings, preserving both the old and new files. These checks cover
the data-format round trip; they do not complete browser-storage migration,
real-wallet permission/reconnection, or the intended-PC UI return sequence.

The private kit is in Downloads as `ThreeCore-private-return-kit-20261102`.
Its `verification.json` records the two full source revisions and every source
and export digest; `SHA256SUMS.txt` covers the 28 copied/exported files and the
verification receipt. Raw account records are kept out of the public-ready repo.

## Required observations on the intended PC

| Scenario | Existing identity needed | Evidence to retain |
| --- | --- | --- |
| Three token cards using one account | One already permitted account | All three intended token/chain identities, exact values and blocks; separately labeled observations; no aggregate wallet count of three |
| Save/reopen/review/restore | The same account; no wallet request for the restore | Original downloaded bytes, all three histories, unchanged identities, no restored connection permission and explicit later reconnect |
| Account-switch invalidation | Existing accounts 1 and 2 | Every card bound to the changed provider stops using stale live results; accepted historical records remain; reconnect checks the new address |
| Chain-switch and cancellation | Existing account | Old responses cannot repopulate live results or continue subreads after the context changes or Stop is used |
| Empty destination and version return | Existing saved files and a separate destination | Preserved originals, no replacement of the active store, verified import/re-export, safe return to the original version |

Perform these against the intended testnet where applicable; label Mainnet
read-only observations separately. An unavailable wallet UI does not prevent
implementation, synthetic regressions or offline recovery verification. Do not
ask the operator to create a third account or repeat already recovered addresses.
A three-distinct-account exercise can remain additional coverage when such
accounts already exist; it is not mandatory for this usage model.

This correction does not declare any pending real-wallet check completed and
does not establish 90% progress. Independent review, release decision and the
other gates in the readiness record remain separate. No signing, transaction,
approval operation or secret-key retrieval is part of this matrix. Publication
continues to be deferred at the operator's request.
