# Independent recomputation of saved check details: item 459

Source: `8c3052c`.

459. A new shared reviewer and offline command compare a saved structured checklist with freshly recalculated details from the original report set. The original source payload checksum is verified before the checklist is examined. The checklist's stated query and disclosure options select what is recomputed; saved counts, observation values/hashes, flags and source digest are compared rather than trusted. JSON whitespace and object-key order may vary; array order and complete fields must match.

## Usage

```text
node scripts/verify-report-checks.js source-set.json check-details.json
node scripts/verify-report-checks.js source-set.json check-details.json --json
npm run report-checks:verify -- source-set.json check-details.json
node scripts/verify-report-checks.js --help
```

Use the direct node form for machine-readable stdout. Exit 0 means the stated filtered details match recomputation, including an honest empty selection. It does not mean the source is continuous or correct on chain. Exit 2 emits differences for a well-formed but nonmatching file. Exit 1 emits no partial comparison on invalid arguments, malformed/unsupported input, unreadable files or failed source checksum. The command reads only the two specified files and makes no network or file writes.

The comparison identifies fixed known field names that differ, reports the count of unexpected top-level fields without echoing their names, and retains recalculated totals, summary and query. detailsTextSha256 identifies the checked UTF-8 text. The CLI's decoder may remove a leading UTF-8 BOM before this digest; this is not advertised as a raw-file-byte checksum. Source identity uses the canonical original payload digest. The input limits are 96 MiB for the source and 4 MiB for the detail text, with bounded JSON depth/node/string handling.

The file's own query/options are part of the comparison and are not signed. A matching result is neither authorship authentication, proof of an originally intended filter, nor live-chain verification. A difference can result from changed input or implementation versions as well as manual edits; it does not establish malicious tampering. Preserve the original source and this code revision for reproducibility.

## Validation

Eighteen focused review/CLI cases passed (3,235.2001 ms). Related report-set, checksum, JSON, local-file and CLI tests passed all 537 cases, zero failed/skipped/cancelled (31,349.9068 ms). Coverage includes long integers, changed hashes, missing/reordered items, invented counts/continuity/verification claims, wrong original source, empty selections, unexpected fields, malformed/duplicate/oversized JSON, standalone output, source checksum rejection, invalid UTF-8, safe errors and unchanged files.

Five captured standalone runs verify the previous structured exports: all three original files match with exit 0; changing one observation and supplying a different valid original source both return exit 2. The empty selection matches while still reporting source conflicts. All input files are unchanged. [Evidence](evidence/2026-10-31-report-check-recomputation/) contains the synthetic sources, original/modified detail files, comparison outputs, arguments/results, logs and SHA-256 manifest.

The most recent full-wallet/native checkpoint remains 14,968 tests and 870 Chrome UI cases at 40c28e1. This offline comparison batch uses scoped verification. It counts as one independent verification workflow. No real signing, transfers, approvals, secrets, existing-server restart, publication or deployment occurred.
