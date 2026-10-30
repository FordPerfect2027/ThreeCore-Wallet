# Stable read-only allowance records

Continuation items **199–200**:

199. Capture the selected allowance context, bounded spender list, each target and each result row before validation/use. Required context accessors are rejected without execution. Row flags and amounts cannot change after validation, and the array helper returns a detached frozen snapshot.
200. Capture all three observations in a saved bundle and all three overview cards before processing them. Changing length/method/property reads cannot hide a card or replace the record being summarized. Existing agent alignment and the distinction between separate observation times remain intact.

All **10 new regressions failed before** the fix. The **479-test allowance suite** passes afterward, including models, files, controllers, panels, reader/session integration and CLI behavior. No failures, skips or cancellations. [Before](evidence/2026-10-30-allowance-capture/before.log), [related](evidence/2026-10-30-allowance-capture/related.log), [checksums](evidence/2026-10-30-allowance-capture/SHA256SUMS.txt).

These are local synthetic read-only tests. No permission was granted or revoked on chain, and no signature, transaction or private-key operation occurred. The changes do not establish complete discovery of approvals or prove token safety. A separate full-wallet run is required before claiming current-source full-suite coverage.

Source: 3a895d1889ef4df6786e5923bda5dd68366252d0.
