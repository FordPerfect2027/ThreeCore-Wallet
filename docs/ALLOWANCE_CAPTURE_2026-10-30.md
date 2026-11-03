# Stable read-only allowance records

Continuation items **199–200**:

199. Capture the selected allowance context, bounded spender list, each target and each result row before validation/use. Required context accessors are rejected without execution. Row flags and amounts cannot change after validation, and the array helper returns a detached frozen snapshot.
200. Capture all three observations in a saved bundle and all three overview cards before processing them. Changing length/method/property reads cannot hide a card or replace the record being summarized. Existing agent alignment and the distinction between separate observation times remain intact.

All **10 new regressions failed before** the fix. The **479-test allowance suite** passes afterward, including models, files, controllers, panels, reader/session integration and CLI behavior. No failures, skips or cancellations. [Before](evidence/2026-10-30-allowance-capture/before.log), [related](evidence/2026-10-30-allowance-capture/related.log), [checksums](evidence/2026-10-30-allowance-capture/SHA256SUMS.txt).

The subsequent **full wallet run passed 12,960 tests**, with zero failures, skips or cancellations, in 486,001 ms. `npm run test:wallet` ran at code source `3a895d1` (checkout `347b1c1` when started); only documentation changed while it ran. This covers the applicable unit and local HTTP-server suites, including items 189–200. It does not include separate compiled token-contract acceptance or real-wallet acceptance. [Full log](evidence/2026-10-30-allowance-capture/full-wallet.log).

These are local synthetic read-only tests. No permission was granted or revoked on chain, and no signature, transaction or private-key operation occurred. The changes do not establish complete discovery of approvals or prove token safety.

Source: 3a895d1889ef4df6786e5923bda5dd68366252d0.
