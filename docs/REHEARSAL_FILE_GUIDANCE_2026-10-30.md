# File-reading guidance and cancelled selection

Source: `801f24a`. Completed continuation items **183–184**:

183. All six rehearsal file inputs now distinguish timeouts, occupied reading capacity, invalid text encoding, empty/oversized/inconsistent files, read failures and cancellation. Shared fixed Japanese guidance explains the next action without displaying raw exception text or paths. Existing format-specific validation remains separate. No automatic retry or new permission is introduced.
184. Cancelling the single-record file chooser now preserves the existing review and applied history, matching the other five inputs. An empty file-selection change no longer clears the display.

Validation: **920 related tests passed**, with no failures, skips or cancellations. The first broad run found one assertion still expecting the old generic error wording; it was updated to require the new UTF-8 guidance and an empty checksum display. Both [initial](evidence/2026-10-30-file-guidance/initial.log) and [final](evidence/2026-10-30-file-guidance/related.log) runs are retained. Capacity rejection/recovery, true File streaming, encoding faults, cancelled choice and unchanged committed history are exercised through the mounted page.

## Microsoft Edge acceptance

The existing 4231 page was saved, reloaded normally to load the changed modules, and restored using the native file chooser. No server restart or security-setting change was performed. All six inputs were then given the local one-byte invalid-UTF-8 fixture. Each showed the specific UTF-8 guidance. The first input's initial read was observed before completion; its final text was recorded in a subsequent DOM read. Other panel operations can invalidate the combined recovery review, so the recorded per-input messages describe the observation at each check rather than six simultaneous independent reviews.

The original DAT 3 / EMA 2 / CAWELON 1 records and three comparison cases remained intact. Real downloads before and after these checks, `ThreeCore-rehearsal-session (10).json` and `(11).json`, both contain 17,387 bytes with SHA-256 `22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c`. This matches the previously preserved original session. Diagnostic error displays were cleared afterwards.

One link click timed out before dispatch. A fresh read showed the existing tab responsive and unchanged; the next ordinary semantic click succeeded. No replacement tab, manual user input, alternate control route or protection bypass was needed.

Evidence: [actual input messages](evidence/2026-10-30-file-guidance/browser-file-errors.json), [error screenshot](evidence/2026-10-30-file-guidance/file-error-guidance.png), [final displayed state](evidence/2026-10-30-file-guidance/browser-final-state.json), [preserved records](evidence/2026-10-30-file-guidance/records-preserved.png), [exact file comparison](evidence/2026-10-30-file-guidance/round-trip.json), [checksums](evidence/2026-10-30-file-guidance/SHA256SUMS.txt).

This is fictional local rehearsal validation. There were no signatures, transfers or private-key operations. Counts of tests and repeated browser checks are not additional development items.
