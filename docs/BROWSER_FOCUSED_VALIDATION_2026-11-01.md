# Focused browser validation with explicit coverage

Maintenance source: a493ace. Completed product items remain 532 / 600; test infrastructure adds zero items.

The development runner accepts node scripts/test-browser-ui.js --focus=file-read for changes confined to shared saved-file/read panels. Group membership is assigned when the file-read module registers each test, not by title prefixes; this includes the wallet, rehearsal and capacity cases registered by that module. All registered modules still pass syntax/route preflight. The selected group runs once in an owned isolated Chrome profile against an owned synthetic loopback server.

The completion receipt contains the full registered count/digest, exact group membership and selected indices. The validator requires every member exactly once, matching result totals, no failed cases and no unexpected browser errors. It rejects unknown scopes, empty groups, missing or extra selected cases, truncated registries, injected-control receipts and incomplete results. Its fullCoverage field is false. Full-shard validation refuses a focused receipt; the ordinary two-shard command and the dedicated error controls remain separate.

At this source, 137 runner/receipt/runtime/preflight checks passed. The actual focused run passed 99 native Chrome cases in 21283 ms from server/profile setup through owned cleanup; syntax preflight is outside that timer. This is one local measurement, not a universal speed guarantee or a comparison of equivalent coverage. Two actual native controls separately confirmed that an unexpected error and an unhandled rejection remain failures. [Saved logs and capture](evidence/2026-11-01-browser-focused-validation/) have hashes checked against committed Git blobs.

Use the focus command for scoped iteration only. Use node scripts/test-browser-ui.js for broad browser changes, integration checkpoints or release validation. A focused run is never reported as a full run. Last full browser checkpoint remains ef8f1a0 with 947 cases; last full-wallet checkpoint remains d253e8d with 15,720 tests. No later full run is claimed here.

No installed wallet, user browser profile, external RPC, signature, transfer, approval, key, publication, deployment or existing-server restart is used by these runs. This tooling does not prove connection to the user's existing tab or operating-system file picker.
