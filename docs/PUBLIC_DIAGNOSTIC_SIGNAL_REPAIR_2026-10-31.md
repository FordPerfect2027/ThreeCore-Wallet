# Diagnostic cancellation lifecycle repair

Source: `b56237a`. Maintenance follow-up to item 445; completed item count remains **457 / 600**.

A direct synthetic Node probe found that a signal proxy could pass the native aborted-state read but throw while registering its event listener. Registration was outside the public error/cleanup boundary, so its raw exception escaped. Partial registration or a later state-read failure could leave a callback installed; an abort followed by a registration failure could leave the interruption promise unobserved. Cleanup exceptions could replace a successful response.

Registration and the subsequent state check now run inside the same protected request lifecycle. Cleanup is attempted even after partial registration, registration errors become INVALID_SIGNAL, the first cancellation/timeout reason remains authoritative, and the interruption promise is observed before registration can fail. Cleanup exceptions are consumed rather than replacing the public result. Ordinary signal behavior and fixed read-only endpoints are unchanged. A malicious signal that also refuses cleanup cannot be promised to detach; the tested native cleanup and post-removal failure cases are covered explicitly.

Five corrected regression controls failed before the fix (447.2873 ms). The fixed controls plus existing cancellation cases passed all 22 (702.9843 ms). The diagnostic, probe, liquidity, CLI and lifecycle group passed 107 cases, zero failed/skipped/cancelled (5,841.6952 ms). The direct proxy probe now returns INVALID_SIGNAL and makes zero transport calls. These tests use synthetic responses; no external RPC or wallet is used.

[Evidence](evidence/2026-10-31-diagnostic-signal-repair/) preserves the controls, related log, reproducer and observed before/after result, with SHA-256 checksums. This repairs an already counted feature; it adds **zero** development items. The latest native checkpoint remains 869 at 8440316 and full-wallet checkpoint 14,921 at db8fb98. No real signatures, transfers, approvals, secrets, server restart, publication or deployment occurred.
