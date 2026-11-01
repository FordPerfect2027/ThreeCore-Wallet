# Token dependency review evidence

See [the review](../../TOKEN_DEPENDENCY_REVIEW_2026-11-02.md) for scope, source pins, changes and publication order.

- graphs.json / repaired-graphs.json: all three dependency graphs matched before and after; one clean dependency installation was shared across the repaired token builds.
- npm-audit.json: initial registry audit, eight high-severity package entries.
- npm-audit-after.json: two patched package findings removed, six entries remain from one Zod root advisory.
- npm-audit-production.json: earlier production-only audit, zero reported findings before the runtime dependency reclassification. It does not clear the development finding or represent an audit of the revised graph.
- *-check.log: each token's full compile, contract, typecheck, read-only and local-history command.
- *-wallet-compatibility.log: fifty compatibility cases per token against the fixed Wallet source.
- wallet-compatibility-receipts.json: artifact hashes and scope. Initial whole-file identity failed because buildInfoId changed; ABI and both bytecode fields match.
- repair-commits.json: local commit pins and results; no public CI or publication is claimed.

The registry audit is a dated advisory lookup, not an independent security review. Logs and audit bytes are preserved. The original 4231 server and user browser were not operated.

The subsequent [runtime installation evidence](RUNTIME.md) fixes missing runtime dependencies and verifies an independently installed minimal read-only profile for all three tokens.

[The bounded Zod compatibility probe](ZOD_COMPATIBILITY.md) records an observed break in the unchanged Hardhat helper under Zod 4.6.6; no major-version override was adopted.
