# Stable configuration capture

Continuation items **189–190**:

189. Capture token-plan envelopes, selected agent/network context and bounded token arrays from their own data descriptors before validation. A live Proxy length can no longer turn a one-token list into an accepted empty list; a changing agent read cannot substitute an EMA context for own-data DAT selection. Sparse/accessor/extra-property arrays remain rejected.
190. Capture wallet-setup envelopes, the exact three-row array and each card's raw/validated fields. The chain checked during validation is the chain returned in the normalized configuration. Existing preview/cancellation checks still guard mutations that can occur during reflection.

Before the fix, **10 of 11 new regressions failed**. After the fix, **230 targeted tests** and **940 related configuration, portfolio, import/export, restore and demo-server tests** pass with no failures, skips or cancellations. [Before](evidence/2026-10-30-configuration-capture/before.log), [targeted](evidence/2026-10-30-configuration-capture/related.log), [integration](evidence/2026-10-30-configuration-capture/integration.log), [checksums](evidence/2026-10-30-configuration-capture/SHA256SUMS.txt).

These regressions exercise JavaScript module/adaptor inputs. They are not evidence of an attack on the user's browser or accounts. Ordinary JSON formats, contract addresses, chains and account configuration remain unchanged. No wallet request, signature, transfer or private-key operation was performed. The earlier full-wallet run at `9a0e477` predates this source change and is not represented as validation of it.

Source: 20bedd8dc2a79bb4bbc6ba757cf9fa6bf3fd150f.
