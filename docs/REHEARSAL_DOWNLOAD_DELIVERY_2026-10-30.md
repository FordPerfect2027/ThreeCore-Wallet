# Rehearsal download delivery — items 167–169

Source: `15c1b22` (local only).

167. Apply the existing synchronous export contract to all seven rehearsal panels and all sixteen download actions. An explicit refusal, thrown exception, promise, or unreadable/asynchronous thenable must not produce a “save started” message. Successful synchronous adapters remain compatible; no disk-completion claim is added.
168. Verify all sixteen delivery paths, retained workspace/case data and undo, and pending restore preservation. The new boundary tests plus related panel/server tests passed **287 tests, zero failures**. The bug was first reproduced against the combined-session save action; the pre-fix failure is retained.
169. Open a fresh rehearsal through the existing page's ordinary same-origin link in a new Edge tab, restore the original six fictional records and three cases there, perform a real combined download, and independently verify the downloaded bytes. The 17,387-byte file has SHA-256 `22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c`, exactly matching the original session.

```powershell
node --test --test-concurrency=2 test/operation-rehearsal-download.test.js test/operation-rehearsal-page.test.js test/operation-rehearsal-session-panel.test.js test/operation-rehearsal-scenario-panel.test.js test/operation-rehearsal-scenario-set-panel.test.js test/operation-rehearsal-records-panel.test.js test/operation-rehearsal-check-panel.test.js test/operation-rehearsal-review-panel.test.js integration/operation-rehearsal-server.test.mjs
node scripts/check-rehearsal-session.js docs/evidence/2026-10-30-rehearsal-download/edge-session.json
```

[Pre-fix reproduction](evidence/2026-10-30-rehearsal-download/before-fix.log), [passing related tests](evidence/2026-10-30-rehearsal-download/after-fix.log), [actual downloaded session](evidence/2026-10-30-rehearsal-download/edge-session.json), [offline inspection](evidence/2026-10-30-rehearsal-download/session-inspection.json), [checksums](evidence/2026-10-30-rehearsal-download/SHA256SUMS.txt).

The actual download was `Downloads/ThreeCore-rehearsal-session (6).json`. Waiting for the browser's download event timed out and reset the control runtime **after** the file was written. File existence, exact hash comparison and offline parsing confirmed the outcome; the save action was not repeated. Reclaiming either existing rehearsal tab then reported an unattached debugger. The Windows native-app fallback was blocked because Computer Use could not determine the current browser URL with enough confidence to enforce policy. Computer Use explicitly stopped for the turn. No post-download screenshot, final live UI inspection or temporary-tab cleanup is claimed. The original tab was not reloaded or replaced during this verification.

The user-visible source changes are loaded by a fresh page; the existing original tab still has its earlier module instance. No current control connection is claimed after the interruption. Existing capacity screenshots document the earlier successful restoration, not a current live screen.

## Broader regression attempt

An earlier broad command included `test/*.test.js integration/*.test.mjs`, which incorrectly included `integration/token-compatibility.test.mjs`. That harness requires a separately compiled DAT, EMA or CAWELON token checkout and immediately rejected this wallet checkout before loading the local EVM. The attempt ended with **12,586 passes and one failure**, no skips. Its [raw log](evidence/2026-10-30-regression/complete-suite.log) is retained; it is not reported as a passing full suite. It started at `068a339`; the download-source changes were made while that broader process was still running, so it is also not claimed as full validation of one final revision. The separate 287-test run above validates the download change. A future complete wallet run must select the applicable server harnesses explicitly and record its exact source revision.

No live chain request, signature, transfer, approval or private-key retrieval was performed. These are fictional rehearsal data and delivery-adapter tests, not real-wallet acceptance or a mainnet-readiness percentage.
