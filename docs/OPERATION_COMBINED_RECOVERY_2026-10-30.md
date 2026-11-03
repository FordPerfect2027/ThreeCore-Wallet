# Combined rehearsal recovery — continuation items 81–100

Source commit: `44a5144` (local only).

Three-token fictional histories and named comparison cases can now be saved in one file and restored together after review. Both components are validated and prepared before one state replacement. Existing separate-file workflows remain available.

## Completed work

81. Run the broader wallet test suite and retain its source revision and result.
82. Define a strict combined-file schema with an explicit simulation-only boundary.
83. Normalize and bound both nested input collections before accepting a file.
84. Show workspace and case changes before combined restoration.
85. Prepare both replacement stores before permitting confirmation.
86. Replace the two stores atomically so invalid cases cannot leave a partially restored workspace.
87. Forward existing workspace and case operations to the active combined state.
88. Preserve independent normal undo histories during ordinary editing.
89. Clear both undo histories only when a combined restoration is confirmed.
90. Invalidate a pending combined restoration when its underlying state changes.
91. Disable confirmation when the proposed file changes nothing.
92. Export current histories and case inputs together in one file.
93. Bound file reads and reject malformed UTF-8 before interpretation.
94. Provide paste import with stale asynchronous completion protection.
95. Keep current data when a combined review is cancelled.
96. Retain a visible restoration receipt with source and per-agent/case counts.
97. Distinguish successful state restoration from a later screen-rendering error.
98. Add offline inspection with the exact input SHA-256 and explicit scope.
99. Exercise partial-failure, reentrancy, controller lifecycle, UI and CLI behavior.
100. Verify the browser restoration end to end, saved downloads and byte-preserved original inputs.

## Verification

The full wallet suite passed **12,022 tests, zero failed**, at the earlier source `ff3b6a26e43b6c43f505d8f2dc88894d02253e21`:

```powershell
node --test --test-concurrency=2 test/*.test.js
```

The combined recovery change was subsequently checked with **481 related tests, zero failed**, including 36 new tests:

```powershell
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs
```

These are separate runs at separate source revisions; the full suite is not claimed as a test of the later combined-recovery commit. Test assertions are not counted as individual development items.

The real Edge page reviewed a six-record / three-case file from an empty page, cancelled without importing, then restored both components with one confirmation. A second fixture proposed changing the active agent to EMA while including an invalid case identity; the whole file was rejected and DAT remained active. An unconfirmed case rename was cancelled by a subsequent condition edit. Reimporting identical input disabled confirmation.

## Evidence

[Evidence directory](evidence/2026-10-30-combined-recovery/), [screen](evidence/2026-10-30-combined-recovery/edge-combined-restoration.png), [observations](evidence/2026-10-30-combined-recovery/browser-observations.json), [checksums](evidence/2026-10-30-combined-recovery/SHA256SUMS.txt).

```powershell
node scripts/check-rehearsal-session.js docs/evidence/2026-10-30-combined-recovery/edge-session-before.json
```

Valid inspection exits 0. The included invalid-case fixture exits 1 with `SCENARIO_CONTEXT_OR_EVENTS_CHANGED` and no partial JSON output.

| Preserved input | SHA-256 |
| --- | --- |
| Combined file before, restored export and final export | `22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c` |
| Three-ledger workspace before/after | `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302` |
| Case collection before/after | `0914d537e54362f7882884f904358d36f028d557c5bd385ee01b5c94938445e3` |

The combined file is 17,387 UTF-8 bytes. Its offline inspection reports DAT 3, EMA 2, CAWELON 1, and three cases.

## Limits

The file contains committed fictional input only, not unconfirmed drafts, undo history, search filters, report-review results or expected-result review displays. No automatic persistence is implied. Browser proof used the ordinary paste fallback; native file selection remains unverified in this connected browser. The inspector does not authenticate source data or authorize execution.

No signing, transfers, approvals, private-key retrieval, publication or deployment occurred.
