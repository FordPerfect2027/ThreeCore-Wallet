# Local workspace restore preparation — 2026-10-25

This iteration starts from `93f309eb50ca23390a601a6132458615ad5211cb`
in an isolated PC checkout. No GitHub changes are published.

## Observed problem

Restoring or undoing all three cards previously interleaved wallet disconnection
with form/history assignments. A provider's synchronous listener cleanup could
edit a different card, cancel, or close the application while assignments were
already in progress. That could overwrite a newer input, leave teardown
incomplete, or expose the first changed card before all affected wallets stopped.

On the unchanged runtime, the focused browser suite recorded 31 passing and
5 failing cases, with no unexpected browser errors. The five failures cover:

- Editing another card during restore cleanup.
- Closing the app during restore cleanup.
- Editing another card during undo cleanup.
- Closing the app during undo cleanup.
- Cancelling from the second provider's cleanup before the first card changes.

These are timing variants of one integration boundary problem, not five
independently established fund-loss vulnerabilities.

## Change

`createWorkspaceController` accepts an optional synchronous `prepareWrite`
adapter. It receives immutable, detached target/source drafts and a guard that
checks whether the current operation is still active. Preparation cannot start
another preview/apply. It can be cancelled or disposed before any data write.
Asynchronous adapters are rejected and their rejected promises are consumed.

After preparation, the controller checks permission again and recaptures the
current draft. Any edit prevents the old proposal from overwriting it. The
existing checks immediately before and after the transactional writer remain.

The full application moves provider disconnection and panel invalidation into
preparation. All affected cards are prepared before the first form/history
assignment. Each external cleanup is followed by the guard. The writer performs
local assignments only and does not repeat provider cleanup during rollback.

An interrupted preparation may leave a connection stopped or a derived preview
cleared; it does not reconnect automatically. The account settings and saved
histories remain unchanged, including a newer input entered during preparation.
A fresh review is required before another restore.

Existing transaction rollback and emergency recovery remain for errors during
actual assignment. Disposal during that synchronous write is still rejected:
the new boundary moves provider callbacks out of that interval rather than
silently dropping rollback data. Histories-only restores retain the previous
behavior of leaving an unchanged wallet configuration connected.

## Validation

The focused workspace unit suite passes 380 cases. Its 19 new cases cover
restore/undo cancellation, disposal, edits, guarded steps, recursive attempts,
immutable preparation inputs, permission expiry, rejected asynchronous work,
prior recovery preservation, no-op handling and panel teardown.

The initial 19-case API baseline failed because the old controller ignored the
new preparation hook. This establishes missing-hook coverage, not 19 separate
bugs; the five browser failures above establish the actual old UI behavior.

The corrected focused browser suite passes all 36 cases, including all five
reproductions, normal restoration/undo, histories-only restore, rollback,
encrypted handoff and real browser Blob/file handling with synthetic data.

Full-suite results are recorded in the adjacent
`wallet-restore-preflight-verification-20261025` directory:

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Unit | 10,811 | 0 |
| HTTP isolation/routes | 348 | 0 |
| In-app browser | 730 | 0 |
| Total | 11,889 | 0 |

There are 24 new cases compared with the preceding 11,865-case subtotal.
No cases were skipped or cancelled, and the browser reported no unexpected
errors. Focused reruns and baseline failures are excluded from this total.
The unchanged contract EVM suite was not rerun and is not counted here.

```powershell
node --test --test-timeout=60000 --test-concurrency=2 test/*.test.js
node --test --test-concurrency=2 integration/*server.test.mjs
$env:THREECORE_DEMO_PORT='4214'
node examples/dev-server.js --ui-test
```

Browser: `/test/browser/`; focused: `/test/browser/?suite=workspace`.
The test harness uses synthetic providers and no wallet extension or external RPC.

## Completion gate

The scope and remaining real-wallet gate in
`LOCAL_TESTNET_ACCEPTANCE_2026-10-25.md` remain in effect. Three distinct real
accounts are not yet ready. Their permission, balance, save/reload/restore and
reconnect checks are pending. Passing more local cases is not a measured 90%
overall completion score, and this work does not enable signing or spending.
