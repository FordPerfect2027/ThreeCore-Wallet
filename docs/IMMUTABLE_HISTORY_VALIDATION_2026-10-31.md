# Faster repeated review of saved historical evidence: item 455

Source: `51c4e42`.

455. Repeated historical review now reuses immutable validated transfer snapshots, archives, token observations and reconciliation workspaces produced by their own validators. It avoids repeatedly walking the same event arrays when calculating archive summaries or filtering saved reconciliation events. This is one end-to-end saved-history optimization, not four items for four modules.

Only fully validated canonical outputs receive a private weak identity mark, after all checks and size limits. Imported caller objects, frozen outer wrappers and proxies still undergo capture and validation. An archive rebuilt from valid snapshots still runs cross-record context, duplicate-range, header/event and overlap checks. Context-dependent event validation is not cached separately. Missing code, metadata mismatch and unverified-history facts remain unchanged. No network response is cached and no statement about current chain state is added.

## Validation and measurement

Before the change, 8 controls passed and 10 failed because the expected identity reuse was absent (408.8582 ms). After the change all 18 controls passed (381.1451 ms), including mutable external inputs, frozen wrappers with changed children, proxies, duplicate/context/overlap checks and retained mismatch facts.

The related reader, token identity, allowance, transfer, period, historical query, reconciliation and immutable-model run passed 4,700 cases, zero failed/skipped/cancelled (62,080.9658 ms). Native Chrome passed 868 UI cases with an isolated profile, a fresh ephemeral server, a synthetic provider and no external RPC. The user's existing server was not stopped. The previous full-wallet checkpoint remains 14,921 cases at db8fb98; this batch uses scoped verification plus native UI coverage.

The benchmark uses ten adjacent one-block synthetic windows with 50 events each, 500 events total. It performs three samples per operation. Median archive summary fell from 19.21 ms to 0.70 ms; reconciliation query from 28.09 ms to 7.85 ms. All six before/after output SHA-256 values match. Both source revisions and the four measured implementation-file hashes are preserved. These local timings do not describe a real account read or a guaranteed production speedup.

[Evidence](evidence/2026-10-31-immutable-history-validation/) includes the original measurements, comparison, reproducible benchmark script, failing controls, fixed controls, related and native logs, and SHA-256 manifest. Run benchmark.mjs with repository path and a new output JSON path. Test counts and timing samples do not increase the development item count. No real signing, transfer, approval, secret access, publication or deployment occurred.
