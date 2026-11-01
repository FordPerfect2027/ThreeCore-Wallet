# Retain accepted transfer records when a connection stops

This local continuation builds on
`7e4a86b47905420b66106da9fb09b75f60f562a8`. The operator requested collecting
changes and evidence on the PC before a combined GitHub update. This work has
not been pushed and has no new remote CI result.

## Reproduction and change

The preceding intended-PC recovery exercise found that ordinary disconnect
erased an explicitly accepted, one-record transfer archive from the screen.
The separately saved JSON survived and was successfully restored, but an
operator who had not saved yet would lose the in-memory archive. A regression
using the existing transfer panel's connection-invalidation method reproduced
the empty archive before the fix.

Connection invalidation now cancels active work and unaccepted previews while
retaining records explicitly added to **期間ごとの記録をまとめる** or accepted
through its reviewed file replacement. The current transfer observation is
still cleared. Merely performing a read does not add it to the archive.

The retained archive keeps its original account, token, chain and exact block
ranges. Selection, removal, capture for combined collections, and additions
check their context. A record from another account, asset or chain cannot be
silently appended. A new matching-context file may replace the old archive only
after its explicit preview and apply sequence. Cancelling that preview retains
the old records.

The archive's own JSON save is an offline operation bound to the accepted,
immutable archive. It remains available even when the account input is blank or
has changed. It does not relabel old records as belonging to the new input.
Stopping while a file read, selection or hash is pending cancels that operation;
a late completion cannot replace records or deliver the cancelled download.
A subsequent explicit save can proceed. The explicit clear action and disposal
still remove in-memory records.

This does not add automatic disk storage, preserve unsaved drafts, or make page
reload/closure recoverable. The panel explains that JSON must be saved before
closing or reloading. Existing account checks, RPC restrictions and protective
stop timers remain in place.

## Verification scope

The focused controller, panel, combined-transfer collection and cancellation
suite passed 540 tests. It covers different-account/asset/chain rejection,
preview cancellation, repeated stops, invalid form input, delayed file/hash
completion, explicit clear, and reentrant cancellation.

The full local regression run passed 16,438 tests with no failures, cancellations
or skips. The focused cases are included in that count, not additive features.

Browser integration cases exercise normal disconnect, a provider account-change
event, and protective stop for DAT, EMA and CAWELON on both supported chains.
These use synthetic providers in disposable profiles, with no real wallet
extension or external RPC. Results, exact commands and the initial browser
shutdown failure are recorded alongside the logs in
[the evidence directory](evidence/2026-11-01-transfer-retention/).
The subsequent clean run passed all 1,017 cases and completed both profiles'
shutdown and cleanup. The initial run's failure is retained separately rather
than overwritten. The unchanged existing server also served exact current
bytes for all three modified application modules; this does not establish that
an already-open tab has loaded them.

A separate offline probe loaded the actual previously downloaded one-record,
1,172-byte EMA archive through its checksum-verifying reader and reviewed
controller import. Export after stop, and export after invalidating the account
input, both matched the original byte-for-byte. The original disk file was
unchanged. This probe made zero network requests; its private report remains in
the operator's Downloads directory.

The intended Microsoft Edge tab could not be controlled during this continuation:
tab attachment timed out, and the supported native view then stopped because
the tool could not establish the current browser URL. No post-fix intended-PC
UI acceptance is claimed. Existing working tabs were not deliberately reloaded
or closed, and the existing port 4231 server was not restarted. No wallet
signature, transfer, approval transaction or key retrieval was performed.

The next intended-PC check is to load this local revision in a backed-up
verification tab, restore the saved archive, connect the previously permitted
account if needed, stop the connection, and save/recompare the retained archive.
Three distinct public-testnet account acceptance, independent review and a
release decision remain separate, unfinished requirements.
