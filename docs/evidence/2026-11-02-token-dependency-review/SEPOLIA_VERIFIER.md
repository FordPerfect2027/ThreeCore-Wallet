# DAT historical Sepolia verifier evidence

See [the change and scope](../../SEPOLIA_VERIFIER_2026-11-02.md).

- sepolia-results.json: final DAT commit and exact source hashes, test totals and limitations.
- sepolia-baseline.log / before-after.json: old CLI false PASS on transport errors and corrected failure.
- sepolia-full.log: complete 251-entry run; reference-default.log: final path's 24 dedicated cases.
- sepolia-focused-*.log: earlier successful focused stages, retained without counting them again.
- sepolia-verifier.patch: full DAT delta from 355fb93, including the pinned historical reference.
- sepolia-artifact-diagnosis.json and method: isolated LF-only reproduction, unchanged expected hashes.
- sepolia-public-checkpoint.json and method: actual public checkpoint PASS, no signature or transaction.
- sepolia-explorer-summary.json / observation.json: deployed code and constructor input match, partial verification and different source text.
- *-method.mjs: historical local orchestration snapshots; paths and intermediate hashes are retained as recorded.

Raw explorer/compiler input files remain in local Downloads; compact hashes and
methods are retained here. The reference ABI/bytecodes are in DAT, with license
attribution. No private wallet data or credentials were read by this check.
