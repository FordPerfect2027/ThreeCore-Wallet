# Reproduce missing-history proposals offline: item 464

Source: `0b9b889`.

464. The new read-only command verifies a saved report-set checksum and generates the same bounded missing-history proposal as the screen. It requires an explicit group ID, preserves the full selected account/chain/token and includes the original payload digest. JSON also carries source-wide continuity/issues, so an empty selected queue cannot hide unrelated source problems.

```text
node scripts/plan-missing-history.js saved-set.json --group DAT-1
node scripts/plan-missing-history.js saved-set.json --group DAT-1 --page 2
node scripts/plan-missing-history.js saved-set.json --group EMA-1 --window-size 1000 --format text
node scripts/plan-missing-history.js saved-set.json --group DAT-1 --kind unplanned --require-empty
```

The npm alias is history-queue:plan. CLI and screen page numbers start at one; JSON's recorded query.page is the zero-based model index. Group IDs are local to that source. pending selects planned ranges lacking saved records; unplanned explicitly selects gaps between plans. Each page has at most ten windows, newest first. Recorded ranges needing review remain excluded and their count is retained.

Default output is JSON; text reproduces the screen proposal with source digest and whole-source status appended. Output is unencrypted, includes public account/range data and cannot be restored as a report set or executed as a transaction. The command reads one bounded original file and writes stdout; it does not write the input, contact a provider or start any proposed read.

Exit 0 means a proposal was generated. With --require-empty, any missing range in the selected group/mode across all pages gives exit 2 with the full output. Exit 0 under that option still does not mean whole-source continuity, exhaustive history or current chain verification. Invalid flags, checksums, encodings, groups or pages give exit 1 with no partial stdout. Errors do not echo local paths.

## Validation

Focused CLI and queue checks: 17 passed (2,384.1919 ms). Related report-set, check-detail and local-file checks: 395 passed, zero failed/skipped/cancelled (40,568.127 ms). Cases cover exact one-based large page conversion, argument ambiguity, shared-field equality, original checksum binding, second-page strict behavior, empty queues with source conflicts, huge-gap final pages, malformed sources, safe errors and unchanged input files.

Five standalone captures save the first ten windows, the remaining two, partially collected EMA history, the last huge-gap page and an empty selection with source conflicts. The first four reproduce every field of the previously recorded screen proposals; CLI-only metadata adds original-file checksum verification and source-wide findings. All original inputs are unchanged. [Evidence](evidence/2026-10-31-missing-history-queue-cli/) contains the synthetic sources, exact CLI outputs, arguments/exit codes, logs and SHA-256 manifest.

This CLI-only change uses scoped verification. The latest full-wallet/native checkpoint remains 15,020/874 at f1be6ab. No real signing, transfers, approvals, secrets, publication or deployment occurred.
