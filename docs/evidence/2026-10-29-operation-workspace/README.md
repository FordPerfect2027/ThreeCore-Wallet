# Three-agent workspace restore evidence — October 29, 2026

Evidence for the [ten-item development batch](../../OPERATION_WORKSPACE_2026-10-29.md), using source commit `8e16dbd`. Every amount, event and address is fictional rehearsal input. No wallet signatures, transfers, approvals or private-key access occurred.

Chrome created and exported DAT (3 records), EMA (2) and CAWELON (1). The browser connection was lost before the final restore. After the local server was restarted, the user opened `http://127.0.0.1:4231/rehearsal/` in Edge and selected the saved file. The agent observed the review while all three current ledgers were absent, confirmed restore, switched through each restored ledger, returned to DAT and exported again. This is a cross-browser save/restore check, not a claim that Chrome's interrupted restore succeeded.

## Files

- [Original Chrome download](chrome-operation-workspace.json) and [Edge export after restore](edge-restored-workspace.json): exact downloaded bytes; each is 4,771 bytes with SHA-256 `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`.
- [Earlier Chrome observations](chrome-observed-checks-before-reconnect.json): a summary reconstructed from actual tool-visible observations after the original in-memory buffer was lost; not a raw trace.
- [Edge restore observations](edge-workspace-restore-observations.json): rendered preview, restore response and per-agent values captured during the actual UI sequence. The user performed file selection; the agent performed restore, switching and export.
- [Chrome offline check](chrome-workspace-offline-check.json) and [Edge offline check](edge-workspace-offline-check.json): separate recalculations of the downloaded files.
- [Duplicate-agent negative control](duplicate-agent-negative-control.json): intentionally invalid fixture. Earlier Chrome rejection preserved current histories; the offline checker returned exit 1 with `DUPLICATE_AGENT`.
- [Restored screen](edge-workspace-restored.png), [completed checkpoint](batch-validation.json) and [SHA-256 checksums](SHA256SUMS.txt).

The overview shows DAT P&L 28 SIM with 2.8 SIM reserved, EMA P&L -42 SIM, and CAWELON P&L -1 SIM. CAWELON retains an unresolved 100 SIM principal and a 2 SIM closing-fee reserve. Each restored ledger has zero undo checkpoints. These are separate simulations, not combined balances or independently verified custody.

## Reproduce

From the repository root:

```sh
node scripts/check-rehearsal.js docs/evidence/2026-10-29-operation-workspace/edge-restored-workspace.json --workspace --json --sha256 b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302
```

Expected: exit 0, three present agents, six records, all modeled constraints satisfied. A matching checksum proves byte equality only. Reports retain `simulationOnly: true`, `sourceVerified: false` and `authorizesExecution: false`.

The recorded automated suites passed 168 focused tests, 11,747 unit tests and 406 integration tests, with zero failures. Counts overlap and must not be added. The token compatibility integration test is excluded because it requires its separately compiled token checkout. Full logs remain in the local `workspace-development` evidence folder; their hashes are recorded in the checkpoint. No source code changed after those runs. This evidence update does not claim a production release or a mainnet completion percentage.
