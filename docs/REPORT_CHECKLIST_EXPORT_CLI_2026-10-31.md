# Offline report-checklist reproduction: item 456

Source: `0a3535d`.

456. A new offline command reads one saved report-set JSON, verifies its payload checksum, recalculates diagnostics and produces the same complete filtered checklist CSV as the browser. Token, severity and literal search filters are supported. An optional JSON wrapper includes query/options, digest, total/matched counts, unfiltered category counts, continuity and the CSV. Notes are omitted and structured addresses shortened by default; explicit options enable notes and full structured addresses. This is one export workflow.

## Usage

Run from the repository with an existing saved report-set file:

```text
npm run report-checks:export -- saved-set.json --agent EMA --severity conflict
node scripts/export-report-checks.js saved-set.json --search "report name" --format json
node scripts/export-report-checks.js saved-set.json --include-notes --full-addresses
node scripts/export-report-checks.js saved-set.json --format json --require-continuous
node scripts/export-report-checks.js --help
```

The command writes to stdout only; redirect to a new destination if needed, never over the input. Use the direct node form for machine-readable stdout because npm can add banners. Search uses the fields supported by the browser; at this checkpoint that includes names, kinds, descriptions, context and block numbers.

Exit 0 means a valid export, not a clean or trustworthy chain history. Exit 1 means argument/read/validation failure and no partial stdout. With --require-continuous, exit 2 means the unfiltered source is not continuous; the export is still emitted. An empty filtered selection cannot hide this condition. A mandatory CSV summary row preserves source-wide counts even on zero matches.

Output is unencrypted and is not a restorable backup. Labels/search can contain addresses despite structured-address shortening. Notes require --include-notes. CSV formula protection matches the browser; import integer fields as text to preserve all digits. sourcePayloadDigest identifies the verified canonical payload, not exact source-file bytes, authorship or present-chain truth.

## Validation

Eight focused cases passed (4,328.4736 ms). Combined export, diagnostic, existing checker, file and bounded-local-read checks: 124 passed, zero failed/skipped/cancelled (12,050.0116 ms). They cover argument limits, standalone output, byte equality, unchanged source, empty-filter metadata, strict global status, privacy options, checksum tampering, wrong file kind, invalid UTF-8, safe errors and help.

Three standalone captured exports select 15 checks, 8 EMA conflicts and 0 matches. All CSV bytes exactly match the earlier browser-export capture at db8fb98. The empty selection returns strict exit 2 while retaining the source's eight conflicts. [Evidence](evidence/2026-10-31-report-checklist-cli/) contains the synthetic input, original JSON outputs, arguments/results, logs and checksums. No network, signing, transfer, approval, secret access or source-file writing is involved. No publication or deployment occurred. The prior full-wallet checkpoint is 14,921 at db8fb98; the latest native checkpoint is 868 at 51c4e42. This command-only batch uses scoped tests.
