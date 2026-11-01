# Local collection guide and recovery evidence

Base source: `593916348fadc822de5d6811d694b1f3ce90a183`, plus the changes in the
local commit containing this directory. No push or remote CI run was performed.
All automated tests use synthetic data. Private actual-account files and PC
screenshots remain in Downloads; their bounded observations are described in
[the recovery record](../../VAULT_RECOVERY_2026-11-02.md).

## Successful runs

- `related-regression.log`: exit 0, 938 passed, zero failures/cancellations/skips.
  Command: `node --test test/wallet-saved-*.test.js test/transfer-vault-*.test.js test/file-read-status.test.js`
  This ran before the final destination-focus adjustment.
- `navigation-regression.log`: exit 0, 71 passed after that adjustment.
  Command: `node --test test/wallet-saved-vault-collection-guide.test.js test/transfer-vault-panel*.test.js test/wallet-saved-file-inspection-panel.test.js`
  These overlap the preceding suite; they are not additional features.
- `browser-confirmed.log`: exit 0, 154 file-read UI cases; the disposable
  browser completed shutdown and cleanup. The module preflight validated 261
  served modules. Command: `node scripts/test-browser-ui.js --focus=file-read`
  This is focused coverage, not a full browser-suite result.
- `collection.json` is a synthetic two-entry example, one archived. Both entries
  intentionally reference the same three-token data. `inspection.json` therefore
  reports six archive/record/event references, not six independent reads.
  Reproduce with `node scripts/inspect-wallet-saved-file.js docs/evidence/2026-11-02-vault-recovery/collection.json --json`.
- `batch.csv` is the privacy-minimized generic batch output for that example.
- `source-check.json` records current file hashes and byte equality for modified
  application modules served by the unchanged port 4231 process. It does not
  establish what an older open tab has loaded.

The full Node/browser suites were not repeated. Previous full-suite results
belong to the archive-retention revision, not this follow-up.

## Initial failures retained

- `before.log`: actual collection input rejected by the original generic CLI
  with `FILE_INSPECTION_UNSUPPORTED` (exit 1). The dedicated decoder accepted it.
- `focused-initial.log`: 87/89 passed. New assertions initially assumed a colon
  in existing display text and a destination type outside the route helper's
  supported caller set. Those assertions were corrected to the actual API.
- `related-initial.log`: 934/938 passed. Legacy fixture tests iterated all newly
  added scope fields as if they belonged to old-format outputs. Tests now
  explicitly check the old fields and the absence of collection-only fields;
  old output bytes were not changed to make these checks pass.
- `browser-initial.log` and `browser-navigation-failure.log`: each 153/154 passed.
  The first run included the stale display-text assertion. The second exposed
  that an unopened saved list disables its file input, so the first destination
  implementation could not navigate. The final method focuses the explicit
  list-read button first, then the file input after the list is read. The final
  browser test checks both stages, unchanged data, zero provider calls, and
  disabled actions after a bad checksum.

Logs are copied unchanged, including failures. Checksums cover these artifacts
and this README. They do not attest to source authenticity, token safety, a
complete account history, independent review, or mainnet release readiness.
