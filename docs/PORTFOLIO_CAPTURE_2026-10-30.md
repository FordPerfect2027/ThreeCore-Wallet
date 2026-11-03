# Portfolio plan and observation capture

Continuation items **252–254**, source `a403d66`:

252. Capture supported portfolio options and bounded token-array slots before reading. Reject accessor slots and extra array methods without invoking them; live property traps cannot substitute a different plan.
253. Capture own block-header and contract-code fields before validation/use. Recheck cancellation and session identity before subsequent reads, and classify inaccessible records with bounded public errors.
254. Consume portfolio progress callback results with the shared callback boundary, including malformed asynchronous then-method rejections, while preserving observer-triggered cancellation.

All **16 new regressions fail before the fix**. The **153-test** reader/progress/plan run and **585-test** portfolio/controller/panel/block/observer run pass with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-portfolio-capture/before.log), [targets](evidence/2026-10-30-portfolio-capture/related.log), [integration](evidence/2026-10-30-portfolio-capture/integration.log), [SHA-256](evidence/2026-10-30-portfolio-capture/SHA256SUMS.txt).

These checks use synthetic read-only sessions. Missing bytecode remains an unknown token balance, never zero. This does not change actual chain coverage or provide an independent security audit. No signature, transaction, approval or private-key operation occurred. The full-wallet run at `e50123f` predates this change.
