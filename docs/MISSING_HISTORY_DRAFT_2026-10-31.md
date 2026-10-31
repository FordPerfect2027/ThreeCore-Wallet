# Save missing-history proposals as unread period drafts: item 465

Source: `08d00c9`.

465. A proposed missing-history window, or a contiguous page of up to ten windows, can now be saved in the existing period-file format as a new empty draft. Select a scope under the ten-window proposal, choose “この範囲を下の保存対象にする”, confirm the full account/chain/range shown in the save section, acknowledge the unencrypted contents, then save. The file opens in the existing period-reading screen through its review step. Reading starts only through the separate existing start control.

A page spanning disjoint missing ranges cannot become a single draft, because that would add an omitted gap to the requested reads. The whole-page choice is absent for such pages, and the export helper independently rejects it. Individual windows remain selectable. The fixed suggested filename avoids problems with extremely long block-number filenames.

The draft contains the selected account/context and planned range only: both balance observations are null and saved history is empty. Its checksum protects its own contents; it does not carry or authenticate the original evidence. The original accepted set and saved history are unchanged. Full account addresses are included, with no original notes/events/balances. Saving does not mark any proposed read as completed.

## Acquisition order

The queue preview is newest first. The existing period reader obtains endpoint balances and then reads history from the earlier endpoint forward. A whole-page draft therefore repartitions the exact selected union from its start using the selected window size. For a short oldest window, those partitions can differ from the backward preview. The screen states this explicitly. A single-window draft keeps that interval exactly. No absent gap is introduced.

Changing the page, width, mode or chosen window clears the save selection and acknowledgement. Accepting another source disposes the old controls and clears selection. While a file is preparing, proposal controls are disabled. Cancellation, disposal, refused delivery and asynchronous delivery cannot publish a late success. Existing import/review does not call the provider.

## Validation

Focused draft, panel, queue and timeline checks: 63 passed (8,701.2461 ms). Final related report-set, check-detail, period and local-file checks: 1,497 passed, zero failed/skipped/cancelled (57,832.849 ms). An earlier single-window-only draft also passed 59 focused and 1,493 related checks; that intermediate run is superseded by the final validation and adds no item to the ledger.

Native Chrome passed 876 UI cases with a synthetic provider and no external RPC. New cases select and acknowledge an unread draft, capture its download callback, decode the empty file, verify query-edit invalidation, and save a continuous 20,000-block page as ten planned windows. The isolated browser uses a fresh ephemeral server; this does not verify the user's OS download dialog or reconnect/restart the user's existing tab/server.

Four [captures](evidence/2026-10-31-missing-history-draft/) save the first ten windows, remaining two, a one-block interval and a repartitioned partial page. Shared period-controller import/review reproduces each exact empty draft with zero provider reads. Evidence includes checksummed synthetic original sets, generated period files, exact ranges/progress, logs and SHA-256 manifest. The latest full-wallet checkpoint remains 15,020 at f1be6ab. No real signing, transfers, approvals, secrets, publication or deployment occurred. This complete scope-to-draft handoff counts as one development item.
