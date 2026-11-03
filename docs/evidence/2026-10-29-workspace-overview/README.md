# Rehearsal overview evidence

Collected on October 29, 2026 from source `92c5b2980c14dcae703b733136f712fb844d58a9`, using the existing Edge rehearsal tab at local port 4231. All records are fictional SIM inputs.

- `before-workspace.json`: actual browser download `ThreeCore-operation-workspace (5).json`, before the page upgrade.
- `edge-overview.json`: actual `ThreeCore-workspace-overview.json`, saved while the EMA/position filter displayed zero entries. It still includes every agent and all source records.
- `rejected-test-workspace.json`: actual `ThreeCore-operation-workspace (6).json`, with one deliberate rejected DAT append. This fixture was saved and subsequently undone on the live page.
- `edge-rejected-overview.json`: actual `ThreeCore-workspace-overview (1).json`, exported with the rejected-only filter active. It includes the reservation and open position too.
- `offline-overview.json`, `offline-rejected-overview.json`: output of the offline overview command; byte-identical to the corresponding actual downloads.
- `edge-final-workspace.json`: actual `ThreeCore-operation-workspace (7).json` after undo. Byte-identical to the original six-record backup.
- `final-workspace-offline-check.json`: existing checker result for the final download, including verification of the explicitly supplied original SHA-256.
- `edge-ui-observations.json`: 14 DOM observations after actual browser actions. These are rendered state, not outputs from the unit-test DOM.
- `edge-rejected-record.png`, `edge-final-overview.png`: actual screenshots of the relevant page region, visually inspected.
- `rehearsal-tests.log`: completed related regression run, 255 passed, zero failed.
- `batch-validation.json`: batch counts and independently checked file comparisons.
- `SHA256SUMS.txt`: hashes of all 13 evidence artifacts listed above; excludes itself and this README.

Browser console error collection at the end of the UI check returned no error entries. The overview source commit is local; this evidence does not claim GitHub publication, real fund balances or mainnet readiness.
