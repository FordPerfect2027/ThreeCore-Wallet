# Direct reviewed handoff of unread period proposals: item 475

Source: `3d2fc3d`.

475. Missing-history windows/pages and selected saved-event/hash discrepancies can now pass a newly prepared empty draft directly to the period-reading panel's review. The integrated wallet wires this action and moves focus/scroll to that panel only after successful staging. Standalone report-set panels without a receiver keep direct-transfer controls disabled and explain the existing JSON-save/open fallback. No browser file permission or protection setting changes are involved.

The receiver accepts only fully validated empty drafts, labels them as new unread proposals and does not look up a connected wallet or start a read. Existing collected evidence remains unchanged while the proposal is reviewed. The established replacement acknowledgement is still required to apply a different draft over collected evidence; reading remains a separate explicit start, which checks the current account and chain. Nonempty or invalid proposals preserve an existing pending review. Busy or disposed receivers refuse staging without stopping a read. Source-side cancellation/disposal and asynchronous/refused callbacks cannot publish a successful handoff.

The source report set and pending replacement candidate remain intact. The direct action performs no source history reads/writes, file saving or checksum work. Shared synchronous draft builders back both direct handoff and existing exports, retaining the same exported JSON. Changing the chosen scope or comparison clears stale handoff controls. This is one complete interaction workflow across both kinds of proposed scopes, not two item counts.

## Validation

87 focused controller/panel tests passed (8,801.4824 ms), covering no-context/no-read staging, separate replacement acknowledgement, rejected nonempty input, explicit-start context mismatch, busy/disposed receivers, byte-equivalent draft builders, unchanged accepted/pending source and cancellation. The related run, including wallet-panel cancellation, passed 2733 checks (79187.4379 ms), zero failed/skipped/cancelled. Native Chrome passed 885 UI cases with a synthetic provider and no external RPC. Its new integrated panel case stages a discrepancy into a period panel that already holds collected evidence, checks the new-proposal label and blocked start/apply, acknowledges replacement, and confirms zero provider/context calls and no downloads.

Two [captured handoffs](evidence/2026-10-31-direct-period-proposal-handoff/) cover discrepancy-to-collected-period and missing-page-to-empty-period cases using the real controllers. Proposed period JSON is retained as evidence after the handoff, not as a prerequisite to it. A nonempty proposal rejection preserves the pending review. Four recheck files captured at item 474 are reproduced byte-for-byte after sharing draft builders. Captures include source and proposed/previous synthetic files, state transitions, logs and a SHA-256 manifest. Latest full-wallet checkpoint remains 15,154 checks and 883 native cases at 6c76e88. Native tests use an isolated browser; no claim is made about a restored connection to the user's currently open tab.

No real signatures, transfers, approvals, secret retrieval, publication or deployment occurred. No real wallet read was initiated, and the user's existing server was not restarted.
