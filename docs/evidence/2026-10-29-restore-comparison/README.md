# Restore comparison evidence — October 29, 2026

Evidence for the [ten-item comparison batch](../../OPERATION_RESTORE_COMPARISON_2026-10-29.md), using source commit `aaa4489a2cf941ee5d6745f735ecc2375d823763`. All accounts, amounts, destinations and records are fictional simulation data.

- [Before workspace](before-workspace.json): actual browser backup of the original six records, saved before updating the page.
- [Proposed workspace](proposed-workspace.json): deliberately changed fixture used only for preview and comparison; never applied.
- [Actual browser comparison download](edge-workspace-comparison.json) and [separate CLI result](offline-comparison.json): byte-identical 20,352-byte files.
- [Thirteen rendered-state observations](edge-ui-observations.json), [DAT identity comparison screenshot](edge-DAT-context-comparison.png) and [final original workspace screenshot](edge-final-original-workspace.png).
- [Final browser workspace download](edge-final-workspace.json) and [offline workspace check](final-workspace-offline-check.json): the original six records were retained; exact checksum matched.
- [Related regression log](rehearsal-tests.log), [completed checkpoint](batch-validation.json), and [SHA-256 checksums](SHA256SUMS.txt).

Reproduce the saved comparison from the repository root:

```sh
node scripts/compare-rehearsal-workspaces.js docs/evidence/2026-10-29-restore-comparison/before-workspace.json docs/evidence/2026-10-29-restore-comparison/proposed-workspace.json --json
```

Expected SHA-256 of that UTF-8 JSON output with its final LF: `245284bcc3672ae90eec54ada6837780775d8bc4670f6a0ee3fe4a612d144193`. This verifies a deterministic comparison of the supplied inputs; it does not authenticate their provenance or permit transactions.

The final workspace and original backup each have 4,771 bytes and SHA-256 `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`. Browser use relied on the ordinary paste input. No file-access permission, local origin protection or wallet access scope was changed.
