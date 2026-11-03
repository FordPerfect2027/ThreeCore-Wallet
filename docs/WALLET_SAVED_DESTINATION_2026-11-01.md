# Find the destination of an inspected saved file

Item 535. Source: a2eb7e5.

The saved-file guide offers an explicit button to move to an existing section of the current wallet page after supported source validation. Nine routes are wired: period, period library, three-token report, report history, report set, wallet workspace backup, public wallet setup, transfer vault and reconciliation. A separate top navigation link now focuses the three-wallet backup/restore panel directly. Other formats retain their textual destination guidance and do not gain an unsupported navigation action.

The action focuses and scrolls an existing section only. It does not open a file picker, connect an account, make a wallet/RPC request, load the selected JSON into a controller or apply/restore data. The guide retains its current result and explicitly tells the user that the JSON still needs to be selected in the destination. Auxiliary schema claims cannot enable the button. Routes are configured by local application code; a file's prose or extra fields do not provide a callback or URL.

Callback descriptors are captured without invoking getters, later replacement is ignored, and unsupported/failed/asynchronous callbacks do not claim successful navigation. A source change during the callback suppresses a stale success message. Disposal removes the action listener and invalidates the navigation map. No imported data is handed to the navigation callback.

7 focused cases passed (540.6872 ms); 1009 related checks passed (37083.3028 ms), with zero failures/skips/cancellations. Because this change also touches top-level wallet navigation, a full native Chrome run passed all 950 cases across two reconciled isolated profiles. The new actual wallet-DOM case selects report-history and workspace sources, focuses the correct existing sections and verifies zero synthetic wallet requests. The earlier navigation case now verifies all 13 distinct top-level links.

[Evidence](evidence/2026-11-01-wallet-saved-destination/) records nine source-guidance dispatches with source paths/hashes and preserved inspection results. Those captures use the shared panel with controlled callbacks; the separate native run verifies actual application focus. The initial focused test passed 6/7 cases: its disposal assertion queried a node after the panel had removed it. The test now retains the button reference before disposal and verifies that the removed listener cannot run. The failed test log is retained.

The new full browser checkpoint is a2eb7e5, 950 cases, including the preceding continuation and plain-text comparison changes. Last full-wallet checkpoint remains d253e8d (15,720 tests). Evidence hashes are checked against committed Git blobs. No signature, transfer, approval, key access, external RPC, publication, deployment, existing-server restart or user-tab/picker verification occurred. This navigation workflow counts as one item; counts do not measure mainnet readiness.
