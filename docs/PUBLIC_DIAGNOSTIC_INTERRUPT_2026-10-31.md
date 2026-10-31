# Interruptible diagnostic commands: item 449

Source: `70ce926`.

449. Base probing, Aerodrome holdings, Classic pools and liquidity progress now share a bounded-lifetime interrupt handler. Ctrl+C/SIGINT aborts the active public read and exits 130; SIGTERM aborts it and exits 143. Repeated signals keep the first reason, cancelled work cannot print a successful or partial report, and completion/failure removes only the handlers installed for that operation. Existing help and invalid-argument paths still run without network activity. This is one shared command-line feature, not four separately counted edits.

## Validation

The pre-change simulated-signal command cases failed 12/12 (2,803.9671 ms). After implementation, 130 diagnostic/CLI/lifecycle cases passed with zero failures, skips or cancellations (6,528.8214 ms). Child-process fixtures cover interruption while waiting for response headers or body, no later requests, no stdout, exit status and handler cleanup. Unit cases also cover repeated signals, late successful completion, preserved external handlers, synchronous failures and repeated clean runs. Test signals were emitted through the process event interface; this is not a claim of physical keyboard interaction on Windows. All fetch calls were replaced by synthetic transports.

[Evidence](evidence/2026-10-31-public-diagnostic-interrupt/) retains before and after logs with SHA-256 checksums. No external RPC, wallet, signatures, transfers, approvals, secrets, existing-server restart, publication or deployment occurred. The full-wallet/native checkpoint remains item 444 at b69f5e5 (14,836 and 865 passing cases); these command-only changes have scoped verification.
