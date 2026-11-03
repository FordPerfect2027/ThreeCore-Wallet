# Reuse derived analysis of immutable report snapshots: item 466

Fixed source: 77e103a.

466. Repeated period-report analysis, report-set analysis and timeline construction now reuse their derived immutable contents when the input is the exact canonical snapshot owned by the validator. This reduces repeated calculations during searches, coverage inspection and proposal generation. A private WeakMap at each derived layer holds the result; ordinary caller objects are always captured and validated first. A shallow freeze, matching JSON, or a previously valid Proxy does not grant a caller a trusted identity.

Every public call still returns a fresh frozen outer result. That preserves the existing presentation contract used to detect an accepted/replaced report and clear UI acknowledgement/selection state. Nested derived contents are deeply immutable. Changed caller evidence produces new conclusions, later malformed evidence is rejected, and revoked proxies cannot retrieve an earlier result.

This extends the earlier immutable-validation optimization to derived analysis. It does not cache provider requests, accept earlier live-chain checks as current, or change source data. Storage inspection and source validation still occur. It does not remove cold-start decoding/validation/analysis work; the benchmark below measures repeated calls on the same already validated snapshots.

## Local repeated-call measurement

Both runs used a clean committed source checkout: 28f2485 before and 77e103a after. The synthetic set contains seven reports including duplicate evidence, gaps, archived partial evidence and conflicts. Each operation has two warmups followed by fifteen timed repetitions. Serialization and hashing are outside the timing interval. Results are local measurements, not general browser/network latency guarantees.

| Operation | Before median (ms) | After median (ms) |
| --- | ---: | ---: |
| period-analysis | 1.825600 | 0.002200 |
| set-analysis | 49.259600 | 0.001000 |
| timeline | 47.485400 | 0.002000 |
| missing-queue | 34.561200 | 0.065600 |
| check-search | 33.964200 | 0.500900 |
| html-export | 79.505100 | 0.577100 |

All six serialized outputs have identical byte lengths and SHA-256 hashes before and after. The recorded source file matches the same seven-report fixture. The benchmark script, source revisions, changed-module hashes and per-operation measurements are included for reproduction.

## Validation

Focused immutable-analysis, period/set engine and timeline checks: 110 passed (5,281.9933 ms). The new regressions cover fresh presentation identity, deep immutability, mutable and shallow-frozen caller changes, subsequent corruption, revoked proxies and accepting the same owned source twice.

Full wallet at 77e103a: 15,052 passed, zero failed/skipped/cancelled (302,289.197 ms). Native Chrome passed 876 UI cases with an isolated profile, fresh ephemeral server, synthetic provider and no external RPC. The existing user server/tab was not restarted or reconnected.

[Evidence](evidence/2026-10-31-immutable-report-analysis/) contains the synthetic checksummed source, benchmark script, before/after/comparison records, focused/full/native logs and SHA-256 manifest. No real signing, transfers, approvals, secrets, publication or deployment occurred. This optimization across the derived report workflow counts as one development item.
