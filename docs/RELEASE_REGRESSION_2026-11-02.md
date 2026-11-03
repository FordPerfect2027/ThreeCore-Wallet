# Local release regression and account recovery — November 2, 2026

Application source is `97dae0f43104ec80ae387e671a86389db9156aad`. The test and
operator-guide correction is committed locally as
`c36ce33f16bfb42dc099324382281300ba9c9f30`; no application, server or integration
source changed between those revisions. This continuation is being collected
locally at the operator's request, without a push or a new remote CI run.

## File deadline assertion

The first complete Node/HTTP run finished with 16,444 of 16,445 cases passing.
`caller deadline passed through allowance` expected one retained worker after a
five-millisecond deadline, but observed zero. The test assumed the worker had
started. The service also correctly permits the deadline to expire before any
file read starts; in that case there is no unsettled worker to retain.

A separate synthetic reproduction deliberately spends 20 ms inspecting file
metadata against a 5 ms deadline. It obtains the expected format-level error,
one timeout, zero underlying reads and zero retained reservations. The original
unconditional assertion would reject that valid result. This establishes a
reproducible failure of the assumption, rather than claiming the exact scheduling
history of the first failed run was captured.

The format tests now check the actual timeout counter, zero waiting clients,
and exact retained-worker/byte accounting against whether a read started.
They settle the synthetic worker in `finally`, even if an assertion fails.
Existing injected-clock tests separately establish both pre-read expiry and
retention after an in-flight native read expires. The timeout and product guards
were not relaxed. The focused deadline/format suite passed all 91 cases.
The corrected complete Node/HTTP run then passed **16,445/16,445 cases** with
zero failures, cancellations or skips (537,050.9589 ms). The initial failing log
is preserved separately; the focused cases overlap this full result.

## Whole-list recovery into an empty database

A new browser case exports a synthetic collection with an archived entry and
opens a separate, empty native IndexedDB database. It checks that preview and
cancellation do not write, reviewed import preserves every saved field, reopening
the destination preserves the entry, and re-export produces identical bytes.
The source database remains unchanged, and no card is automatically populated.
Only the isolated test databases are disposed; no user database is cleared.

The complete browser suite passed **1,019 cases** in two sequential disposable
profiles, including successful browser shutdown and cleanup. The earlier run
received 510 passing cases from its first shard but then failed its shutdown
deadline before running the second shard. That run remains recorded as a failure.
No shutdown timeout or harness behavior was changed to produce the passing retry;
the repeat ran after the heavy concurrent suites had finished. The cause of the
original shutdown failure has not been established.

This is automated browser evidence using synthetic data and no wallet extension
or external RPC. It does not finish the outstanding intended-PC recovery into an
empty persistent store using the actual account files.

## Other verified scope

- DAT, EMA and CAWELON each passed 50 local-EVM compatibility cases with the
  current application, for 150 cases total. The build commands exited 0 and
  reported `No contracts to compile`; they reused the existing compiled artifacts,
  rather than establishing a fresh uncached compilation. The source revisions
  are the pinned revisions listed in the evidence README.
- A fresh export of application revision `97dae0f` passed ten local HTTP/startup
  checks: seven exact served-source comparisons plus rejection of the secret-file
  route, production test route and foreign-origin request. Its own temporary
  server was closed. This was not a browser navigation or wallet test.
- A read-only GitHub check found PR #4 still open and draft at public revision
  `07041f00efdb503cb76a06fbe12e5531cb380930`, with five successful jobs in run
  41311235726. Those remote results do not apply to subsequent local changes.

## Recover public account information before asking again

Nine named workspace-backup files in Downloads passed their embedded checksum
checks. Their settings and accepted histories identify the two previously used
public accounts. The older three-card backup configured DAT with Account 1 and
EMA with Account 2; CAWELON had an empty account input but histories for Account 1.
That is historical context, not confirmation of a future three-account allocation.

The original unnumbered workspace backup and a separately verified checkpoint
collection contain the repeated-digit synthetic accounts. They are not counted
as real accounts. No third real account was established from these saved files.

The existing Microsoft Edge Wallet tab successfully displayed the permitted
account preview: Account 1's previously observed public address, Base Mainnet,
one permitted address. No new permission was requested, no account-input change
was applied, and no new balance was read. Subsequent browser control lost its
debugger attachment; obtaining and claiming that same tab did not restore
screenshot access. No fresh screenshot or later successful connection is claimed.
The existing Wallet/rehearsal pages were not reloaded, and the original port 4231
process was preserved.

The public addresses, file-by-file contexts and precise UI observation remain in
private Downloads records. The operator guide now directs the agent to recover
those records and use the permitted-account preview before asking for only the
missing identity or allocation. It does not inspect keys, seeds or extension
storage. The three-real-account Base Sepolia gate remains incomplete.

Raw automated logs, the failure reproduction and fixed-source scope are in
[the local evidence folder](evidence/2026-11-02-release-regression/README.md).
The collection audit including this new folder matched all 248 manifests and
2,231 file entries (99,579,385 bytes), with no mismatches or unreadable files.
It checks current local files named in the Git index; it is not a new remote CI
or fresh-export result for the new documentation commit.
Counts describe checks, not development percentage or independent review.
