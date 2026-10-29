# Rehearsal recovery evidence — October 29, 2026

Evidence for the [ten-item recovery usability update](../../OPERATION_RESTORE_USABILITY_2026-10-29.md), tested against source commit `1325e8ab325da5e20108a12085728fb381433dc0` on the local rehearsal page in Microsoft Edge. All records are fictional simulation inputs.

- [Original saved workspace](original-workspace.json) and [actual final Edge download](edge-restored-workspace.json): both 4,771 bytes, byte-identical, preserving DAT 3, EMA 2 and CAWELON 1 records.
- [Final-source UI observations](edge-final-ui-observations.json): eleven rendered-state/focus observations beginning with the fresh load of the final source. These were extracted from the ongoing local observation log; earlier preliminary observations remain in the local work folder.
- [Review screen](edge-restore-preview.png): current histories remain visible while the proposed partial replacement explicitly lists removals. That proposal was cancelled, not applied.
- [Completed screen](edge-restore-complete.png): all six original records restored, completion state and receipt shown.
- [Related test log](rehearsal-tests.log): 187 passed, zero failures, including the 51 page tests.
- [Offline recalculation](offline-workspace-check.json), [batch checkpoint](batch-validation.json) and [SHA-256 checksums](SHA256SUMS.txt).

Recalculate the actual downloaded file from the repository root:

```sh
node scripts/check-rehearsal.js docs/evidence/2026-10-29-restore-usability/edge-restored-workspace.json --workspace --json --sha256 b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302
```

Expected: exit 0, three present agents, all modeled constraints satisfied. Per-agent realized P&L remains 28, -42 and -1 SIM. DAT has 2.8 SIM reserved; CAWELON has 100 SIM unresolved principal and 2 SIM closing-fee reserve. These amounts are not combined across agents.

No browser file-access permission or local origin protection was changed. Browser verification used the new ordinary paste field with the user's previously saved rehearsal file. Native file selection and asynchronous read edge cases are covered by controller tests, not claimed as newly completed native browser uploads. Checksums establish byte equality, not provenance, custody or permission to execute transactions.
