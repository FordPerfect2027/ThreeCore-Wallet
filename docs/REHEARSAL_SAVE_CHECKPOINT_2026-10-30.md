# Visible rehearsal save checkpoints

Source: `9a0e4778cd6ac7421689b086654d90bbb573d44e`.

Completed continuation items **186–188**:

186. Show whether committed histories and comparison cases are new, changed, empty, or equal to the last offered combined download/read local file. Compare validated content, ignore the selected-agent view choice, and recognize undo back to the same content. A pasted replacement is not treated as a saved local file. An identical real file can establish the baseline without replacing data or clearing undo.
187. Register a best-effort page-exit warning while committed content differs from that baseline, and remove it on panel disposal. Automated EventTarget tests verify the cancellation decision. The real browser limitation below remains explicit; this is not guaranteed protection against every kind of reload, browser termination or process loss.
188. Prevent disposed recovery panels from being repopulated by a restore callback, and consume rejected/thenable callbacks. When data restoration succeeds but rendering cannot be confirmed synchronously, show that distinction while retaining the committed receipt.

## Validation

**219 targeted tests** and **810 broader rehearsal/server tests** pass. Initial testing exposed an incomplete test DOM fixture (`removeAttribute` was absent) and a test that assumed a streamed native File would finish in one event-loop turn. The fixture now implements the normal DOM method, and the streaming test waits for the panel's bounded busy-state transition. The initial logged failures and corrected runs are retained.

Full wallet validation passed **12,893 tests**, zero failures, skips or cancellations, at the fixed source revision above. The command was `npm run test:wallet`, selecting 363 unit-test files, 30 HTTP-server test files and one local-navigation test file. No tested source file changed during the run. [Full log](evidence/2026-10-30-save-checkpoint/full-wallet.log).

## Microsoft Edge acceptance

The existing local page was reloaded and the original file selected through the real file chooser. The visible checkpoint changed from empty to matched after restoration, stayed matched during an unconfirmed rename, changed after committing the rename, and returned to matched after undo. The offered-download label explicitly says to check that a file exists at the save destination; it never claims the browser finished writing a download.

An attempted tool-driven reload while the label was changed showed **no beforeunload confirmation** and reloaded the page. This is recorded as a limitation, not a successful browser dialog check. The original session was immediately restored from its already-verified local file. No production data was used or lost. The subsequent rename/undo and real export preserved the original bytes.

`ThreeCore-rehearsal-session (12).json`: **17,387 bytes**, SHA-256 `22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c`, equal to the previously preserved original. Offline inspection confirms DAT 3 / EMA 2 / CAWELON 1 records and three comparison cases. No signatures, transfers, approvals, private-key operations, publication or deployment occurred.

Evidence: [targeted tests](evidence/2026-10-30-save-checkpoint/targeted.log), [rehearsal tests](evidence/2026-10-30-save-checkpoint/related.log), [browser observations](evidence/2026-10-30-save-checkpoint/browser-acceptance.json), [changed indicator](evidence/2026-10-30-save-checkpoint/changed-content.png), [final display](evidence/2026-10-30-save-checkpoint/save-status-final.png), [actual export](evidence/2026-10-30-save-checkpoint/edge-session.json), [offline inspection](evidence/2026-10-30-save-checkpoint/session-inspection.json), [checksums](evidence/2026-10-30-save-checkpoint/SHA256SUMS.txt).

The baseline is page-local and includes committed histories and cases only. It does not persist drafts, report views, pending operations, undo stacks, search filters or file handles. A download refusal does not advance it. Test assertions and repeated acceptance actions are not additional development items.
