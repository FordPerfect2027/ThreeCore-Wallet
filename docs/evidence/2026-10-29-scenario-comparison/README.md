# Condition comparison evidence

Source `3a0cb9982ee8731513675c80eff6a1afb5fb6e7c`, October 29, 2026. All records are fictional SIM inputs. The actual browser used was the existing Edge tab at local port 4231.

- `before-workspace.json`: actual download `ThreeCore-operation-workspace (8).json` before updating the page.
- `edge-source-input.json`: actual `ThreeCore-DAT-operation-rehearsal (2).json`; independently checked against the DAT ledger in that workspace.
- `edge-hypothetical-input.json`, `edge-scenario-comparison.json`: actual `ThreeCore-DAT-hypothetical-input.json` and `ThreeCore-DAT-scenario-comparison.json`, for a 50 SIM per-operation limit.
- `edge-quota-input.json`, `edge-filtered-comparison.json`: actual versions `(1).json` of those two downloads, for a 5% hypothetical quota. The UI displayed one changed row but the file contains all three.
- `offline-scenario-comparison.json`, `offline-filtered-comparison.json`: exact CLI reproductions of the corresponding browser reports.
- `edge-final-workspace.json`: actual `ThreeCore-operation-workspace (9).json`, byte-identical to the original six-record backup.
- `final-workspace-offline-check.json`: existing workspace check with the original expected SHA-256.
- `edge-ui-observations.json`: 18 rendered DOM observations after actual UI actions, including unchanged conditions, invalidation, reset, rejection, agent switches, filtered export and final preservation.
- `edge-console-errors.json`: empty error collection at the end of UI checks.
- `edge-lower-limit-results.png`, `edge-final-scenario.png`: screenshots of the detailed comparison and final comparison summary; visually inspected.
- `rehearsal-tests.log`: completed related regression run, 309 passed and zero failed.
- `batch-validation.json`: verified batch counts and report comparisons.
- `SHA256SUMS.txt`: all 16 evidence artifacts above; excludes this README and the checksum file itself.

The condition changes existed only in a hypothetical comparison; the original workspace was never replaced by a candidate. No publication, real-wallet action or mainnet completion percentage is claimed.
