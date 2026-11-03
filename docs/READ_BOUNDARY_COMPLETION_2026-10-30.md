# Completing read-response and diagnostic capture

Continuation items **239–240**, source `e50123f`:

239. Capture the transfer reader's contract-code response as own data fields, then recheck cancellation and account ownership before metadata or event requests. Malformed responses produce a bounded token-unavailable error; provider failures retain their RPC classification.
240. Read period, library, report, history and report-set diagnostic codes through own data descriptors. Accessors are not executed, inaccessible records fall back safely, and ordinary Error objects retain supported codes.

The corrected regression fixture reproduces **16 failures out of 25 tests before the fix**; all **25 pass after the fix**. The initial fixture accidentally treated Promise assimilation as a contract-field read; its original log is retained, and the corrected fixture separates those boundaries.

A first related run mistakenly included twelve browser-only HTML/JS assets as Node test entrypoints: **1,510 passed, 12 failed**. Those failures concern test selection and are retained in the evidence. The canonical full command then passed **13,194 tests**, with **zero failures, skips or cancellations**, in 571,438 ms at fixed code source `e50123f`. Source and test files remained unchanged during that full run. This covers continuation items through 240; temporary drafts for later items were outside the tested checkout.

Command: `npm run test:wallet` (unit, synthetic panel and HTTP checks). This run does not include the separate compiled-token-contract acceptance matrix or acceptance with real browser wallets.

Evidence: [initial fixture](evidence/2026-10-30-read-boundary-completion/before.log), [corrected pre-fix fixture](evidence/2026-10-30-read-boundary-completion/before-corrected-fixture.log), [fixed targets](evidence/2026-10-30-read-boundary-completion/fixed.log), [first related run](evidence/2026-10-30-read-boundary-completion/related.log), [full wallet suite](evidence/2026-10-30-read-boundary-completion/full-wallet.log), [SHA-256](evidence/2026-10-30-read-boundary-completion/SHA256SUMS.txt).

The existing Edge rehearsal remained connected with six fictional records and three comparison cases. These changes do not add blockchain scan coverage or attest token safety. No signatures, transactions, approvals, private-key access, publication or deployment were performed.
