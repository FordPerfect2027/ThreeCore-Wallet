# Rehearsal recovery observer isolation

Source: `ede238235028a89986c7423aceac9f51b7a87b34`. This is local, fictional rehearsal work; it makes no wallet request and changes no release-readiness percentage.

The combined recovery controller called view listeners directly. A rejected asynchronous listener could escape as an unhandled rejection, and a listener that cancelled again could recursively notify the same views. A listener could also dispose or edit the session before the successful commit returned its receipt.

Completed continuation items **179–182**:

179. Consume asynchronous and malformed-thenable observer failures without interrupting restoration or healthy views, using the existing shared notifier.
180. Bound reentrant notification delivery to two passes while later observers read current state. No repeating microtask chain is created.
181. Skip removed/disposed observers and bound unique subscriptions to 64; removal releases a slot and duplicate subscriptions still notify once.
182. Capture the immutable committed result before calling observers, so subsequent view edits or disposal cannot rewrite the receipt or turn a completed replacement into a reported failure.

The new regression file reproduced nine failures out of fourteen tests before the change. All fourteen pass after the fix. The targeted controller/panel/notifier group passes **75 tests**, and the broader rehearsal plus notifier/server group passes **801 tests**, with zero failures, skips or cancellations. These runs used the committed source above. Test counts are not additional development items.

Evidence: [before](evidence/2026-10-30-session-observers/before.log), [targeted](evidence/2026-10-30-session-observers/related.log), [broader rehearsal](evidence/2026-10-30-session-observers/rehearsal.log), [checksums](evidence/2026-10-30-session-observers/SHA256SUMS.txt).

No new browser acceptance is claimed for synthetic observer faults. The existing native file restoration evidence remains separate. Full wallet validation will follow the next source checkpoint; the prior 12,835-test run does not cover this revision.
