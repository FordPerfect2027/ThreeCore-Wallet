# Stable identity observations and catalog confirmation

Continuation items **191–192**:

191. Capture own data for token metadata, identity observations, selected catalog context and the exact three identity overview cards. The validated values are the values used in the result; live getters, array iteration overrides and changed connection epochs cannot substitute a second value. Revoked records receive a stable identity error.
192. Invalidate an earlier catalog review when a new preview or apply attempt begins, including invalid attempts. Check the generation after input reflection so cancellation or a newer reentrant preview cannot be overwritten by the older call. An apply attempt consumes its review once.

All **10 new regressions failed before** the fix. After the fix, **543 identity tests** and **2,484 related allowance, period, reconciliation and transfer tests** pass, with no failures, skips or cancellations. Source was fixed at `184e91b` throughout the broader run. [Before](evidence/2026-10-30-identity-capture/before.log), [identity](evidence/2026-10-30-identity-capture/related.log), [integration](evidence/2026-10-30-identity-capture/integration.log), [checksums](evidence/2026-10-30-identity-capture/SHA256SUMS.txt).

These tests use local synthetic inputs and providers. They do not assert new blockchain coverage, an attack on the user's accounts, or mainnet readiness. No signature, transfer, token approval or private-key operation was performed. The earlier full-wallet result at `9a0e477` predates these changes. Other legacy validators that ignore the returned capture are not claimed as fixed by changing the shared helper alone.
