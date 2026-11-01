# Shared accounts and the real-wallet acceptance matrix

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
the two new shared-provider lifecycles. Final full-suite results are recorded
separately; focused passes do not imply that the complete suite has finished.

Existing distinct-account V1 backups remain readable and retain their original
bytes. A new V1 backup that uses shared addresses can be rejected by older
versions enforcing uniqueness; keep the original pre-upgrade files when testing
return to an older version. Do not change a source backup merely to satisfy an
older reader. The live original tab still runs its already loaded code until a
separate page is opened; it is not reloaded to deploy this correction.

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
