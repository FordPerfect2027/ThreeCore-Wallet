# Expected-outcome checks — continuation items 41–60

Final source commit: `ccfe184f7920aa8499a19b2515be38f5cf21e29a`, following implementation `ac88a0a` (local only).

Saved comparison collections can now include a recorded baseline for later regression checks. A separate read-only panel and CLI recalculate both sides of every case and compare their results with the saved expectations. They retain the distinction between a recorded calculation and manually specified expectations. Neither label authenticates an author or proves correctness.

## Completed work

41. Define a bounded expected-outcome suite containing all case inputs and expectations.
42. Capture immutable calculation baselines for later change detection.
43. Accept explicitly labeled manually specified expectations without claiming their provenance.
44. Preserve exact integer amounts and signed P&L in expected values.
45. Require complete ordered case and record coverage; reject partial or mismatched scope.
46. Compare each record's decision and reasons, not only final balances.
47. Compare open-position counts and allocation blockers separately.
48. Check original and hypothetical conditions separately within every case.
49. Report per-case results with agent, chain, account and asset context.
50. Bound visible differences while retaining their full count.
51. Produce a reproducible report containing its inputs and concrete differences.
52. Export all committed cases' expectations independently of display filters.
53. Add a separate expected-outcome review panel without changing the live workspace.
54. Show monetary differences in asset units and known rejection reasons in Japanese.
55. Read bounded UTF-8 files without accepting truncated or malformed input.
56. Support paste, clear and stale-read cancellation without retaining old results.
57. Export completed checks for both matching and differing expectations.
58. Add an offline checker with distinct match, difference and invalid-input exits.
59. Check hand-calculated expectations, tampering, source isolation and CLI behavior in tests.
60. Verify actual browser export/review, exact offline reproduction and preserved workspace/collection; save evidence.

## Validation

418 related tests passed, zero failed:

```powershell
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs
```

The 33 added tests include manually specified profit and rejection results, exact amounts, incomplete coverage, old-schema retention, bounded differences, stale asynchronous reads, collection-filter-independent capture, and preservation of ledger undo and pending collection edits. This is not a new full-wallet-suite run.

In the actual Edge page, capturing expectations while only EMA was visible still saved all three committed cases. The original baseline matched all three cases. A separate controlled fixture changed DAT's expected hypothetical cash from 1000 to 999 SIM, changed an expected DAT decision/reason, and changed EMA's expected original P&L from −42 to 0 SIM. The page reported two differing cases and four exact differences. Restoring the original baseline returned three matching cases. Editing or submitting malformed input cleared the old result and disabled saving it.

The fixture modifies expectations only. It does not represent an observed bug or a change to the six original fictional records.

## Saved evidence and reproduction

[Evidence directory](evidence/2026-10-30-expected-outcomes/), [browser observations](evidence/2026-10-30-expected-outcomes/browser-observations.json), [difference screen](evidence/2026-10-30-expected-outcomes/edge-expectation-differences.png), [matching screen](evidence/2026-10-30-expected-outcomes/edge-expectation-match.png), [checksums](evidence/2026-10-30-expected-outcomes/SHA256SUMS.txt).

```powershell
node scripts/run-rehearsal-check-suite.js docs/evidence/2026-10-30-expected-outcomes/edge-expected-input.json
node scripts/run-rehearsal-check-suite.js docs/evidence/2026-10-30-expected-outcomes/mismatch-fixture.json
```

The first exits 0; the second exits 2 with a completed difference report. Invalid input exits 1 without partial output. No file is rewritten. Byte equality was verified for:

| Pair | SHA-256 |
| --- | --- |
| Browser/offline matching report | `23700e3d71c74a84296128e1de8a4a19a2d5bdb431950d144d623d97aa1c8e0c` |
| Browser/offline difference report | `d0740ccd499741396cff4999da58d510be018f4e1e1023baf188de4fd422650a` |
| Workspace before/after | `b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302` |
| Comparison collection before/after | `0914d537e54362f7882884f904358d36f028d557c5bd385ee01b5c94938445e3` |

Original records remain DAT 3, EMA 2, CAWELON 1; no wallet signing, transfer, approval or private-key access occurred.

## Limits

Suites are limited to one MiB and twelve nonempty cases; the complete encoded suite can reach the size limit before its collection does. Each input retains the original 200-record cap. Checks cover the nine final scenario metrics, open-position count, allocation blockers and per-record decisions/reasons. Intermediate monetary rows and all possible operational behaviors are not separately asserted by this format. Differences are displayed up to forty per case, with the true count retained.

Browser imports used the normal paste fallback. Native file loading, cancellation, invalid UTF-8 and stale reads were covered by tests, not claimed as successful native chooser actions. A recorded baseline is useful for detecting future behavior changes; it is not an independent accounting oracle, audit, mainnet-readiness percentage or evidence of real funds.
