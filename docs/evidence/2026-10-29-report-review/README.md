# Report review evidence

Collected from local source `5acd2b62e65dcb8c030726c5d480f1dd522ee54e`, using Edge and fictional SIM records.

- `before-workspace.json` is actual `ThreeCore-operation-workspace (10).json`; `edge-final-workspace.json` is actual `(11).json`. Their exact bytes match.
- `source-scenario-report.json`, `source-overview-report.json` and `source-restore-comparison.json` are copies of the previously downloaded scenario, overview and restore-comparison reports.
- `tampered-scenario-report.json` is a separate deliberate test copy; it changes only the derived cash value and a source-verification claim. It was never applied as a live input.
- `edge-scenario-receipt.json`, `edge-wrong-checksum-receipt.json`, `edge-tampered-receipt.json`, `edge-overview-receipt.json` and `edge-restore-receipt.json` are the actual five downloaded `ThreeCore-report-review-receipt` files, in that order (unsuffixed, then `(1)` through `(4)`).
- `offline-*-receipt.json` are the verifier outputs for those five cases. `receipt-comparisons.json` records their exact hashes, byte lengths, expected exit codes and matches.
- `edge-ui-observations.json` contains ten real DOM observations. The two PNGs are inspected screenshots of the live panel.
- `final-workspace-offline-check.json` verifies the final saved workspace against its original hash.
- `rehearsal-tests.log` is the completed 347-test run; `batch-validation.json` records the completed twenty-item scope and limitations.
- `SHA256SUMS.txt` covers all 23 evidence artifacts, excluding itself, this README and `.gitattributes`.

Actual browser report entry used paste, with its byte-provenance caveat visible. No native file-selector success is asserted for this batch. Five browser/CLI receipt matches establish reproducible local processing, not authenticity of the fictional source data.
