# Offline historical event export: item 452

Source: `efcef8a`.

452. A new offline command verifies a saved reconciliation or period-report JSON before generating the same all-match CSV as the browser. Select a token, direction and literal search; no page limit is applied. The optional JSON wrapper preserves query, counts, verified payload digest, CSV bytes and unfiltered source statuses, including when the selection is empty. It is a viewing artifact, not a restorable backup. This is one command workflow supporting both existing file formats.

## Usage

Run from this repository. The command only reads the explicitly supplied source and writes output to the terminal; it does not create output files or access a wallet/network. Redirect output to a new file if needed, never over the source file. Output contains unencrypted public account and history data.

```text
npm run history-events:export -- reconciliation saved-reconciliation.json --agent DAT --direction incoming
node scripts/export-historical-events.js period saved-report.json --agent EMA --format json
node scripts/export-historical-events.js reconciliation saved-reconciliation.json --search "no result" --format json --require-agreement
node scripts/export-historical-events.js --help
```

Use the direct node form when capturing machine-readable stdout; npm may add its own command banner. Period reports default to DAT and require one token; reconciliation defaults to all. Direction values follow the relevant screen (period: all/incoming/outgoing/self; reconciliation additionally supports mint/burn). Search is bounded, literal and case-normalized. Duplicate/unknown flags, an unsupported source kind or malformed query fail before file reading.

Exit 0 means successful export from a valid checksummed source, not trustworthy chain data. Exit 1 means invalid input/read/export failure, with no partial stdout. With --require-agreement, exit 2 means the source does not establish arithmetic agreement for all three tokens; the output is still emitted and reports those original statuses. Filtering cannot hide this exit condition. The payload checksum detects content disagreement, not authorship or current-chain accuracy. Numeric CSV columns should be imported as text to retain exact integer digits.

## Validation

Ten focused CLI cases passed (2,474.0994 ms). Combined local-file, existing verifier, export and CLI checks: 89 passed, zero failed/skipped/cancelled (4,779.7558 ms). Tests cover byte equality with browser exports, standalone process output, unchanged input, JSON metadata on empty matches, strict source-wide status, checksum tampering, wrong file type, malformed UTF-8, safe errors and help.

Four captured standalone runs reproduce the previous browser-export CSVs byte for byte: reconciliation incoming 31, reconciliation empty 0 with strict exit 2, period incoming 57, and period empty 0 with strict exit 0. The original synthetic inputs are unchanged. [Evidence](evidence/2026-10-31-historical-event-cli/) contains the sources, outputs, arguments, statuses, logs and SHA-256 checksums.

No external RPC, wallet connection, signatures, transfers, approvals, secrets, existing-server restart, publication or deployment occurred. The previous full-wallet checkpoint remains 14,836 cases at b69f5e5; the latest native checkpoint is 867 cases at 56fb266. This command-only batch uses scoped verification.
