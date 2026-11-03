# Extract original period reports from a report set: item 461

Source: `0f0f131`.

461. The accepted report-set screen can save a selected original period report in the existing, checksummed period-report format. Select an original under “個別に取り出す元レポート”, acknowledge the file contents, then choose “選んだ元レポートをJSON保存”. The file can be loaded in the existing period-report screen to inspect that source in detail. Selection is restricted to the displayed set and resets when another set is accepted.

The export preserves the report's entire evidence, including full public addresses, events and notes. The display's note/address-shortening options do not redact this original evidence. The helper text explicitly states that distinction. Set/history-level metadata is omitted; the original report itself is unchanged. A validated UUID supplies the filename; a user label cannot become a path. The file is unencrypted, not authenticated, and not a live-chain reread.

The controller snapshots the accepted source, requires acknowledgement and checks cancellation before delivery. A refused or asynchronous delivery cannot publish success. Cancellation from inside a delivery callback suppresses a late success receipt but cannot undo a file already handed to that callback. Saving does not modify the accepted set or saved history.

## Validation

Focused export/controller/panel checks: 31 passed (7,373.6134 ms). Related report-set, check-detail, period-report, local-file and checksum-format checks: 773 passed, zero failed/skipped/cancelled (45,912.4618 ms). They cover every selected source's exact existing file bytes, digest and decoded evidence; invalid/missing IDs; mutable caller inputs; unsafe labels; acknowledgement; cancellation and retry; delivery refusal; source replacement; and unchanged storage.

Native Chrome passed 872 UI cases with a synthetic provider and no external RPC. The new case selects a source through actual DOM controls, exports through the captured download callback, decodes the report, and confirms a new set clears the old selection. This uses an isolated browser profile and fresh ephemeral server. It does not verify the OS save dialog or reconnect the user's existing tab/server.

Captured synthetic originals and extracted reports are in [evidence](evidence/2026-10-31-report-set-source-export/), with per-file exact-format comparisons, logs and SHA-256 manifest. The captures execute shared export/decode functions under Node; native UI coverage is separate. Latest full-wallet checkpoint remains 14,968 at 40c28e1. No real signing, transfers, approvals, secrets, publication or deployment occurred.
