# File names and rehearsal selection ownership

Continuation items 355–358. Source revision `0b8f082`.

355. Thirteen JSON import paths now validate one captured filename. A changing metadata accessor cannot bypass the first observation's length, extension or path checks. Native File getters remain supported.

356. Unavailable filename metadata returns each format's existing public filename error before opening the payload. Non-string asynchronous metadata is consumed without treating it as a filename or coercing an object. Exception details do not become the filename diagnostic.

357. Rehearsal workspace, session, scenario-set, expected-outcome and report-review imports share bounded display-name handling. Optional metadata is read once, control/directional characters are removed, and unavailable or asynchronous names use an ordinary label while valid content can still be reviewed.

358. Those five views verify that their selection is still current after metadata capture. Cancellation, replacement or disposal during capture cannot revive old review results, source labels or save controls. Workspace import owns its operation before requesting the name.

## Validation

- Original required-name regression set: 78 cases, 52 failed and 26 passing controls.
- Original rehearsal regression set: 25 cases, 23 failed and 2 passing controls.
- Final focused set: **103 passed**. Native File compatibility and invalid-object non-coercion are included.
- File/archive, historical period/report, reconciliation, allowance, identity, rehearsal and demo-server integration: **5,438 passed**, zero failed/skipped/cancelled; 266,464.9961 ms. Source/tests were fixed during integration; the only following change before commit was indentation of a guard.
- Evidence and checksums are in `evidence/2026-10-31-file-name-capture/`.

Latest full-suite checkpoint: 13,948 at `5aa4a25`. Latest native Chrome checkpoint: 836 at `565f960`, through item 354; no new native run is claimed for this batch. All fixtures are local or synthetic. No real signatures, transfers, approvals, secret retrieval, publishing, deployment or restart of the existing server.
