# Saved-report block lookup and stable CSV scope: items 476–477

Source: `8e8061e`.

476. Both the saved-report catalog and the source selector for report sets now accept an exact decimal block number. Users can choose the planned historical interval (earlier, later] or actual saved history-query ranges, and restrict matching to DAT, EMA or CAWELON. Matching the chosen token and the block must occur in the same slot. Clearing the field restores the ordinary catalog. Existing archive/status/tag/text/order filters compose with the new filter, and filtered catalog CSV uses the same selected scope.

The metadata index adds only immutable from/to ranges, without event bodies or balances. Comparison uses BigInt, including above Number's exact range. Negative, padded, exponential, hexadecimal, over-limit, accessor and object inputs are rejected without coercion. Saved empty-event queries remain searchable; they do not establish that a transfer happened, that none happened, or that a provider returned exhaustive chain history. Endpoint balances alone do not count as saved history coverage.

Filtering never changes stored reports, selected hidden entries or an already accepted report set. The UI states when selected sources are outside the filter. There is no live provider request, new signature flow, automatic report opening or deletion.

477. Saved-report and period-library CSV export now captures and validates the complete filter before announcing the export or waiting for a fresh storage read. Previously, a caller or synchronous observer could mutate the original query and silently broaden an active-only export to include archived entries. Both real controllers reproduced 4 delivered rows instead of the requested 3; the fixed controllers retain 3 while still reading fresh committed source data. Invalid queries fail before storage reads and preserve a pending review. Query accessors are never invoked, cancellation/disposal during reflective capture cannot revive an export, and non-CSV backups ignore unused filters.

## Validation

101 focused tests passed (11,620.6009 ms). The first combined UI test run had one test-fixture failure because its second CSV attempt omitted the existing renewed acknowledgement after refreshing the catalog; the fixture was corrected without relaxing production confirmation. The retained failed log makes that scope explicit.

The separate CSV/controller/server-focused run passed 121 tests (5,832.2755 ms). The first full run at ec46e38 passed 15,180 of 15,181 tests; its single failure was a static server assertion expecting the pre-item-475 mount call without the new proposal receiver. The assertion now checks the receiver wiring and the existing disposal/synthetic-import boundaries. This test maintenance is not a development item. Both that log and the final full run are retained.

The fixed-source full suite passed 15193 tests (372285.5894 ms), zero failed/skipped/cancelled. Native Chrome passed 887 UI cases with a synthetic provider and no external RPC. New browser cases verify saved/planned switching, same-token matching, hidden selection retention, invalid input handling and filtered CSV callbacks. This does not verify an OS save dialog or the user's existing browser connection.

[Captured examples](evidence/2026-10-31-report-block-and-csv-scope/) retain two synthetic source backups, eight exact-scope lookups, before/after CSV mutation reproductions from both controllers, a filtered CSV, validation logs and a SHA-256 manifest. Sources remain unchanged. No real-wallet signatures, transfers, approvals, secret retrieval, publication, deployment or restart of the user's server occurred.
