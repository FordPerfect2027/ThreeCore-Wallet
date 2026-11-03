# Guided record entry and comparison-case management

Continuation items 386–391. Source revision `84c9c6f`.

386. Append entry enables only the fields used by the selected record kind and explains their purpose. Switching kinds retains entered values and revokes a previously confirmed draft. Missing, old-format or closed sources cannot offer editable append controls.

387. Settlement and reservation-release drafts can select an existing open operation or reservation ID from the current agent's committed ledger. Selecting an ID only fills the draft and revokes an old preview; it does not commit. Choices follow commits, undo, source replacement and agent selection and ignore invented option values.

388. Record entry shows the current count and remaining space against the same 200-record constant used by source validation. A full ledger remains readable and saveable, with append disabled. Preview alone does not consume space; commit does, and undo restores it.

389. Comparison-case edits identify malformed, duplicate or missing IDs and invalid names in their actual input fields. The user can correct the field or choose an existing case. Import errors are kept separate from local form errors. Failed edits preserve committed cases and cannot authorize apply.

390. Case collection capacity is visible independently of filters. At 12 saved cases, adding is unavailable while saving, replacing, renaming and deleting remain possible. Removal and undo update the capacity; retired source comparisons cannot re-enable add/replace.

391. Each visible case row has a named selection button that fills its exact ID/name, opens its details, moves keyboard focus to the detail selector and cancels pending edits. Actions from replaced, filtered or disposed rows are retired.

## Validation

- Append guidance with existing page/field-feedback checks: **127 passed**, zero failed/skipped/cancelled; **4,904.7114 ms**.
- Combined new case/append guidance and existing page/field-feedback checks: **141 passed**, zero failed/skipped/cancelled; **5,260.9796 ms**.
- Final related rehearsal and server integration: **1,008 passed**, zero failed/skipped/cancelled; **35,143.541 ms**.
- Native Chrome real-DOM suite: **841 passed** at the same fixed source, including real select options, disabled controls, description targets, duplicate-ID focus and saved-row selection.
- Evidence and SHA-256 checksums: `evidence/2026-10-31-rehearsal-case-guidance/`.

The ledger records **391 / 600** completed development items. Tests, assertions and reruns do not add items. Local synthetic data only; no real signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart.
