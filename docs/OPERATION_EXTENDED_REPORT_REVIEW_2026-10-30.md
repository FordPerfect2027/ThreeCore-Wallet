# Saved expectation and search report review — items 101–110

Source: `d7f606a` (local only). The saved-report reviewer now supports the two report formats introduced by the preceding development groups, in addition to its existing four formats.

## Completed work

101. Recompute saved expected-outcome reports from their complete case inputs and expected checkpoints.
102. Recompute saved record-search reports from all source ledgers and validated query conditions.
103. Reject missing or invalid search conditions instead of assuming an unrestricted search.
104. Include recomputed expectation outcomes and origin in the review receipt independently of report fidelity.
105. Retain search conditions, total source records and matched count in the receipt.
106. Distinguish a faithful report of failed expectations from a fully matching expectation run on screen.
107. Render search scope and no-match results in plain language without implying zero real funds.
108. Detect altered summaries, omitted results and changed balance deltas while preserving existing receipt formats.
109. Verify CLI exit semantics, byte-exact receipts, UI rendering, checksum priority and cleared stale outcomes.
110. Exercise four actual browser reviews, download receipts, reproduce them offline and preserve the original session.

## Verification and evidence

498 related tests passed, zero failed, including 17 new cases. [Full log](evidence/2026-10-30-extended-report-review/rehearsal-tests.log).

```powershell
node --test --test-concurrency=2 test/operation-rehearsal*.test.js integration/operation-rehearsal-server.test.mjs integration/demo-server.test.mjs
```

Actual browser checks:
- A manual expectation report honestly recorded two differing cases out of three. Recalculation agreed with that report; the screen still highlighted the expectation differences.
- A recorded baseline report had three matching cases. Its origin remained explicitly a captured calculation.
- A zero-match search report retained all six source records and the search term `missing-record`.
- A controlled altered DAT settlement report claimed zero matches and changed a cash delta. Both altered fields were detected; the recomputed match count was one.

[Observations](evidence/2026-10-30-extended-report-review/browser-observations.json), [expectation screen](evidence/2026-10-30-extended-report-review/edge-expectation-review.png), [altered-result screen](evidence/2026-10-30-extended-report-review/edge-tampered-query-review.png), [checksums](evidence/2026-10-30-extended-report-review/SHA256SUMS.txt).

```powershell
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-30-extended-report-review/expectation-difference-report.json
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-30-extended-report-review/tampered-query-report.json
```

The first command exits **0**: the report faithfully describes failed expectations. Its receipt still has `reportOutcome.allMatched: false`. This command checks report fidelity; use `run-rehearsal-check-suite.js` on the input suite when the process exit code should indicate expectation success or failure. The second command exits **2**, because the saved report disagrees with recomputation. Invalid inputs exit **1** without a receipt.

All four browser/offline receipt pairs are byte-identical:
- Expectation differences: `ace3f46da70aa2262e19537423825d27c0f55bc0445cf25e55862a66008658bb`.
- Matching expectations: `99d7d23f96d075ed1ae2e9c160e7324d842ddf376df98b012d004d64c2e1b91f`.
- Zero matches: `e649541f9909e9b5a0e0209ec71858e02c8cf3feb917dc588e8eddd0d52e345e`.
- Altered query: `a793f023b5b919ccca11e7ec53a7d95da840d847cc9fe17de6797ffe2aad7330`.

The combined session before and after remained byte-identical, SHA-256 `22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c`. No live input was replaced during these reviews. Native file selection remains unverified; the real browser used paste.

## Limits

Agreement means recomputation from the included inputs, not independent validation of the expected values, source authenticity or real balances. These fictional checks do not establish mainnet readiness. No signing, transfers, approvals, private-key retrieval, publishing or deployment occurred.
