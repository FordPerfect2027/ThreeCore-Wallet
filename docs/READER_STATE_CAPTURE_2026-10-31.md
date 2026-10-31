# Stable reader state and historical query inputs: items 438–444

Fixed source: `b69f5e5`.

## Completed corrections

438. Portfolio balance reads copy supported own state fields before checking identity and read-only capabilities. A data object's getters or property traps cannot substitute a different checked value. Adapter failures become the reader's public error.
439. Token identity reads use the same captured state for metadata/balance context and capability validation. State is recaptured for the existing subsequent-read checks.
440. Allowance reads capture state for the binding key and target-context check together, removing the second initial state observation. Guard checks still reject changed sessions.
441. Transfer history reads bind to captured account, agent, network, origin, epoch and capabilities before their ordinary bounded queries.
442. Period collection captures its connection binding before sequential historical reads and retains its existing resumption, cancellation and changed-session checks.
443. Portfolio history query/export uses captured optional own filter values. A property trap cannot swap the selected account; revoked or disappearing descriptors give a public query error. Existing default, null and undefined optional behavior is preserved.
444. Reconciliation coverage captures at most twelve own range slots and exact endpoints. Array-provided map methods cannot replace the ranges, and endpoint getters are rejected before use. Existing integer arithmetic, clipping and overlap handling remain intact.

These are seven corrections to distinct workflows. Shared capture code, regression cases, reruns and file checks do not add development items. The outer session state getter remains a supported adapter call. Reflection may run adapter code; copying cannot establish external authenticity or make a multi-object wallet state atomic.

## Verification

- Before: 25 failures and 5 passing controls out of 30 regression cases, 1,169.3274 ms, against the pre-fix code. No real provider was used.
- Corrected regressions: 30 passed, zero failed/skipped/cancelled, 617.588 ms.
- Related reader, portfolio, history, allowance, period, reconciliation and scope suite: 4,664 passed, zero failed/skipped/cancelled, 103,189.5971 ms. This run preceded the content-identical source commit.
- Fixed-source full wallet suite: 14,836 passed, zero failed/skipped/cancelled, 518854.3433 ms.
- Fixed-source native Chrome: 865 passed with a synthetic provider and no external RPC.
- Five actual synthetic reader captures performed 5, 6, 11, 9 and 48 read calls, with zero property-read traps invoked. Saved history filtering retains the requested account; saved range coverage records two covered and eight missing blocks.
- All 635 files across 110 previously tracked evidence manifests match their recorded hashes (41,623,606 bytes).

[Evidence directory](evidence/2026-10-31-reader-state-capture/) contains exact local outputs, capture metadata, before/after logs, integration/full/native logs, prior-evidence audit and SHA-256 checksums. Source and tests were frozen during each related/full/native run. Checksums show consistency, not authenticity. No wallet signatures, transfers, approvals, secrets, live external RPC, existing-server restart, publication or deployment occurred. Native checks use a disposable profile; they do not establish reconnection to the user's browser.
