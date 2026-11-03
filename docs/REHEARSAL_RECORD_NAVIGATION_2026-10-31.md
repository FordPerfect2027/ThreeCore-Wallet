# Record detail and retained-history navigation

Continuation items 415–416. Source revision `e9c2c9a`.

415. Each row in the rehearsal record search now has a labelled detail button. Selecting it opens that exact record in the existing detail view, moves keyboard focus to the detail chooser and retains the current search/page. Saved query output still contains every matching record and the original inputs; selecting a row does not narrow or modify the export. Buttons retained from an old page, filter, page size or source cannot change a newer view, and a focus-triggered source replacement keeps its newer result.

416. Redisplaying committed history after an unfinished form edit now explicitly says that the previous history was restored and moves keyboard focus to the result heading. It retains the existing calculation/condition explanation, exact saved inputs and undo history. The button becoming disabled no longer leaves keyboard navigation on that obsolete action.

## Validation

- Record navigation, related navigation and source-boundary checks: **51 passed**, zero failed/skipped/cancelled; **794.7982 ms**.
- History retention, field guidance and direct record selection: **44 passed**, zero failed/skipped/cancelled; **1,239.8622 ms**.
- Final related rehearsal/server checks: **1,165 passed**, zero failed/skipped/cancelled; **30,144.6341 ms**.
- Native Chrome at the same source: **850 passed**, including exact row selection, actual keyboard focus, unchanged combined history exports, retired row buttons and focus on the result heading after restoring committed history.
- A separate local documentation audit found all **572 file targets across 180 tracked Markdown documents** present. This checks local file links, not external URLs or fragment anchors.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-record-row-selection/`.

The ledger is **416 / 600**. Tests and documentation-link checks are validation, not additional development items. The most recent full-wallet checkpoint remains 14,512 tests at `0cd49b6`; later changes have their scoped validations recorded separately. Local synthetic data only; no real signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart.
