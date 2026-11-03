# Field-specific rehearsal correction guidance

Continuation items 383–385. Source revision `38bc3ec`.

383. The main rehearsal calculation identifies the first invalid amount or percentage, explains the allowed format, and focuses that input. Pending-only calculation continues to ignore settlement-only fields. Editing, example replacement and disposal clear the marker; existing accessibility descriptions are restored.

384. Hypothetical comparison identifies the actual failed condition, preserves committed history, and retires invalid markers on edits, resets and source replacement. A failure superseded during owner notification cannot mark the new source.

385. Append preview identifies invalid amounts, fees, reserves or operation/reservation IDs. Unused fields remain ignored for the chosen record kind, failed preview cannot authorize commit, and committed history remains unchanged. Native focus, `aria-invalid`, error-message/description associations and a visible border are shared across the three forms.

## Validation

- Initial selected tests: 133 passed / 4 failed. All four expected the former generic comparison message. Assertions now require the specific field message and invalid marker while retaining checks that the source and save ability survive. Initial log retained.
- Final related rehearsal and server integration: **978 passed**, zero failed/skipped/cancelled; **36,027.7238 ms**.
- Native Chrome real-DOM suite at the same source: **839 passed**. Its new case exercises focus and correction across all three forms and verifies draft changes preserve committed rows.
- Evidence and SHA-256 checksums: `evidence/2026-10-31-rehearsal-field-feedback/`.

The ledger records **385 / 600** completed development items. Tests and test assertions do not count as additional items. Local synthetic data only; no real signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart.
