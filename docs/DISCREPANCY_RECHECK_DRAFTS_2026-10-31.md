# Unread recheck drafts from saved discrepancies: item 474

Source: `4d27b1b`.

474. A specific event difference or shared-block hash disagreement can be selected from the saved-event comparison to create a new unread period draft. The screen previews its exact token, chain, full account and inclusive block range before saving. For an event recorded at different positions, the range includes both observed positions and intervening blocks. Query windows stay at most 2,000 blocks and the enclosing period stays within the existing 24,000-block limit. One-block discrepancies use a one-block query with a preceding balance checkpoint.

Event choices correspond to the current 50-item page; block-hash discrepancies are also selectable, even when both event lists are empty. Changing selection, event page, compared source or token clears the draft acknowledgement. Comparison-file acknowledgement does not authorize this export. Empty/malformed/out-of-range references fail rather than choosing another discrepancy. Saved origins are validated and pinned before hashing; cancellation or disposal prevents late delivery.

The output is an ordinary checksummed period file containing an empty draft: both endpoint observations are null and the event records array is empty. It carries the new range/account, not old balances, logs or the comparison proof. The user is told to retain the comparison JSON separately. Reopen the draft in the period-reading panel and verify the target before explicitly starting a read. This workflow does not perform the read, apply the draft, replace displayed sources, discard a pending candidate or write saved history.

## Validation

57 focused cases passed (10,749.9179 ms). The related run passed 2707 checks (105246.1803 ms), zero failed/skipped/cancelled. Native Chrome passed 884 UI cases with a synthetic provider and no external RPC. The new native case chooses an event discrepancy, previews block 35, requires its own acknowledgement, captures the unread draft, preserves accepted evidence and clears the choice when the token changes. Model coverage additionally checks moved event positions over 5,996 blocks, empty-event hash disagreement, malformed selection, mutable source/query capture and cancellation/disposal.

Four [saved draft captures](evidence/2026-10-31-discrepancy-recheck-drafts/) cover a changed value at block 35, a missing event at block 40, moved observations spanning blocks 35–6,030 and an empty-event hash mismatch at block 31. Each file decodes as an unread draft and the existing `node scripts/check-period.js file.json --json --require-complete` verifies its checksum while deliberately returning exit 2 / PERIOD_CLI_INCOMPLETE, with zero collected steps and zero events. A non-existent hash-difference selection is rejected without output. Sources, generated drafts, independent checker results, logs and SHA-256 manifest are retained.

The latest full-wallet checkpoint remains 15,154 checks and 883 native Chrome cases at 6c76e88. Shared captures run under Node; native captured delivery does not claim the user's OS picker or current browser connection. This entire discrepancy-to-draft workflow counts as one item. No real signatures, transfers, approvals, secret retrieval, publication or deployment occurred; the user's existing server was not restarted.
