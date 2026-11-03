# Saved rehearsal report review — continuation items 1–20

Source commit: `5acd2b62e65dcb8c030726c5d480f1dd522ee54e`.

The rehearsal page can now reopen a saved overview, restore comparison or condition comparison and recompute it from the inputs inside the report. A separate receipt records content agreement, exact reviewed-text SHA-256 and an optional expected checksum. Review never applies the report's input records to the live workspace.

This completes items **1–20 of the requested 600-item continuation**. The earlier twenty-item condition comparison is separate and is not counted again. The [continuation ledger](DEVELOPMENT_CONTINUATION_600_2026-10-29.md) describes the twenty distinct tasks: three schema recomputations, strict input bounds, discrepancy detection, deterministic comparison, bounded field paths, provenance limits, exact text digest, optional checksum, independent panel, file reading, paste fallback, workspace preservation, stale-result cancellation, scope display, receipt export, CLI, automated validation and actual browser evidence.

## What was verified

- 347 related tests passed, zero failed; 38 tests were added across the model, review panel, CLI and page integration.
- Edge reviewed all three existing report types. The normal condition report matched both recomputation and its supplied original SHA-256.
- Supplying a deliberately incorrect expected checksum produced a checksum mismatch while recomputation still matched.
- A separate test copy changed `/sourceVerified` and `/metrics/0/after`. The panel detected both locations and kept its own `sourceVerified` flag false.
- All five actual downloaded review receipts matched the corresponding offline verifier output byte for byte.
- Ten actual rendered UI observations cover normal, checksum mismatch, tampering, all supported report formats, malformed input, clearing and final workspace preservation.
- The original and final six-record workspaces are byte-identical: 4,771 bytes, SHA-256 `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302`.

[Tampering detection screen](evidence/2026-10-29-report-review/edge-tamper-detection.png) · [Final review screen](evidence/2026-10-29-report-review/edge-final-report-review.png) · [Receipt comparisons](evidence/2026-10-29-report-review/receipt-comparisons.json) · [Test log](evidence/2026-10-29-report-review/rehearsal-tests.log) · [Evidence manifest](evidence/2026-10-29-report-review/SHA256SUMS.txt).

## Offline reproduction

```sh
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-29-report-review/source-scenario-report.json --sha256 e6fda59527db16b19c6d55107b050bf54fff5b43ff81e9e78045d12e4d9d0f22
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-29-report-review/source-scenario-report.json --sha256 0000000000000000000000000000000000000000000000000000000000000000
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-29-report-review/tampered-scenario-report.json
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-29-report-review/source-overview-report.json
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-29-report-review/source-restore-comparison.json
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs
```

Exit 0 means content recomputation agrees and any supplied checksum matches. Exit 2 produces a receipt describing a content or checksum mismatch. Exit 1 means arguments, file reading, encoding, structure or included inputs prevented review; no partial receipt is emitted. The command is read-only and does not contact a provider.

Object property ordering and whitespace do not alter JSON-content agreement; array order and value types do. Exact text checksums still change when bytes such as line endings change. Difference counts refer to mismatch locations, with the first 40 listed. Reports are bounded to 2 MiB, 24 levels and 100,000 JSON nodes; unsafe or duplicate keys are rejected. Receipts themselves are not accepted as input reports.

## Limits of the evidence

The browser workflow used the ordinary paste fallback. Its digest labels the UTF-8 bytes of the pasted text, which can differ from a file after copying. In these saved cases the hashes matched the original report files. Native file selection, fatal UTF-8 decoding, size checks and delayed reads were covered by automated tests; a new actual native file-chooser success is not claimed.

A self-consistent report can still contain fictional or false source inputs. Recalculation does not authenticate them, observe live balances, validate token safety or authorize execution. Flags remain `simulationOnly: true`, `sourceVerified: false`, `authorizesExecution: false`. The receipt does not embed its source report; retain both files.

No signatures, transfers, approvals or private-key retrieval occurred. No publication or deployment occurred. The regression count is for rehearsal and local-server tests, not a new full-wallet test claim. The 600-item continuation remains in progress after these first twenty items.
