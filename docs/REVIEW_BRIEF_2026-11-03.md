# Review brief: ThreeCore candidate after live-switch acceptance

Review status: **prepared; no independent reviewer or release approval recorded**.
The exact Wallet source pin is in the enclosing package's `package-receipt.json`.
Use that pin rather than a moving development branch. Token revisions are DAT
`dc2535732e9b83bddd8c5f4a2208c65fdff0a6d1`, EMA
`cae4130e8e01fd325fdcb6a589a46338be08b27e`, and CAWELON
`9fc0ffa988f5b9a80d75d7f95b80e6a759f1610d`.

## Scope and evidence map

The candidate includes the read-only Wallet, offline operation rehearsal,
saved-data inspection/recovery tools, token-source verification and three token
development projects. The Wallet does not implement signing, sending, swaps,
bridges or custody. Public release, private-helper maintenance approval and
any live contract transaction require their own decisions.

| Requirement | Authoritative evidence | What remains outside that evidence |
| --- | --- | --- |
| Fixed Wallet source and regression | [Full fixed-source regression](FIXED_CANDIDATE_REGRESSION_2026-11-03.md): 16,470 Node/HTTP and 1,024 synthetic browser cases; package build checks implementation/test equality to `bf690f3` | These are developer tests, not independent review or current public CI |
| Real context-change invalidation | [Live observations](LIVE_RECOVERY_2026-11-03.md#actual-network-and-account-changes--13251335-jst): Mainnet → Sepolia, then Account 1 → Account 2; three stopped cards, actual provider probes, explicit reconnect and exact nine-record preservation | One profile and one direction for each change; raw event payloads and a live in-flight race were not captured |
| Current-context read after reconnect | Same live receipt: three Account 1 reads at Sepolia 53,791,215, then three Account 2 reads at 53,793,042; full block hashes saved | Historical observations, not a continuing live-balance guarantee; three tokens are not three distinct accounts |
| Token implementation/identity reconstruction | [Source reconstruction](DEPLOYMENT_SOURCE_RECONSTRUCTION_2026-11-02.md): exact runtime and creation-input comparisons, compiler/replay kit | No economic-security, token-value or independent audit conclusion |
| Applied dependency repair | [Applied source and builds](ZOD_APPLIED_2026-11-03.md), [68-case decoder comparison](HELPER_DECODER_COMPATIBILITY_2026-11-03.md), [local simulation](TOKEN_SIMULATION_2026-11-03.md): final contract suites 115 and local-history suites 30 pass; complete artifact bytes unchanged | Private helper fork still needs source review and an accountable maintenance/release decision; dated audit results are not perpetual clearance |
| File preservation and recovery | [Actual-file recovery](ACTUAL_FILE_RECOVERY_2026-11-02.md), [candidate migration/return](LIVE_ACCEPTANCE_2026-11-02.md#fixed-candidate-migration-and-return-completed), current nine-record exports and checkpoint | Native Windows file-picker traversal is unverified; browser filechooser and saved bytes were verified |
| Rollback compatibility | [Legacy compatibility](LEGACY_HISTORY_RECOVERY_2026-11-03.md): public PR checkpoint `07041f0` rejects shared-account backups; separate history-only copy retains nine records | Do not approve unrestricted rollback to `07041f0`. Final deployment must name and verify its rollback baseline, or explicitly document first-release/history-only recovery scope |
| Reproducible handoff | Exact source archives, complete Git bundles, manifest results and outer-package verification | Hashes establish consistency, not publisher identity or safety |

## Focused review questions

1. Inspect Wallet connection lifetime, context invalidation and late-response
   handling against the source and the synthetic/live evidence. Keep the
   limitations of the two actual switch observations explicit.
2. Review imported-file validation, bounded processing, preview/confirmation,
   cancellation, checksums and recovery of original data. Do not treat a checksum
   as authenticity. Confirm that unsupported older formats fail without silently
   deleting card settings or observations.
3. Review the private helper's [source delta](evidence/2026-11-03-zod-migration-candidate/helper-migration.patch),
   source/license archive and exact dependency changes. Assess strict-object,
   union and error-path behavior and the remaining unbounded-schema exposure.
   Record who would maintain the fork or what upstream replacement is required.
4. Check the token artifacts, existing contract behavior and reproduction commands
   against the fixed source map. The newly executed signatures and transactions
   exist only in the disposable simulated EVM; they are not real-wallet acceptance.
5. Select the intended delivery/deployment scope, a compatible rollback baseline,
   and the outstanding acceptance checks. Record native picker evidence separately
   instead of treating the automation URL-identification failure as a product pass.

## Reproduction and review record

Start with the outer `START_HERE.txt`, then run `node verify-package.mjs` after
extraction. Restore Git bundles into new empty directories and check each exact
commit before examining source. The package build has already compared source
archives and the indexed evidence collection. Use the handoff's commands for
Wallet regression and the dated token-simulation method for its saved scope.
The latter method has local execution paths that must be adapted; it intentionally
does not install dependencies or connect a user wallet.

For each finding, record: reviewed revision, affected file/line, concrete trigger,
expected/observed behavior, severity and impact, reproduction/evidence, proposed
fix, retest result, and resolution or explicit acceptance with the decision owner.
An approval must state the exact reviewed revisions and scope. No completed
review, risk acceptance, release authorization or 90% readiness is inferred
from this brief or from the number of passing tests.

Private full-address backups and screenshots stay in the operator's Downloads
folders. Public summaries contain hashes and bounded observations; request the
authorized originals if a review requires checking the actual captured bytes.
Nothing has been sent to a reviewer or pushed to GitHub by preparing this brief.
