# ThreeCore Wallet: security and recovery update

Date: October 25, 2026.

This source release brings the 15 local development commits after
`f14ba98e1748a266569010df7db0a07d3c4f3f94` into the public repository.
The tested development snapshot is
`6a869ab9ae05ab8761a686a7be9beab2401ed1ad`; publication documentation is added
separately without changing that runtime or its tests.

## What changed

The update strengthens the read-only DAT, EMA and CAWELON wallet workflow,
especially the boundaries between stopping work, saving data, reviewing a
restore, applying it, and confirming what actually happened.

- **Stable save content:** capture the accepted input before asynchronous
  storage preparation. Check cancellation, deadlines and disposal again before
  allowing a write. Admission rules bound pending operations and data sizes.
- **Stop and reconnect:** propagate cancellation through composite reads and
  storage consumers. Late replies cannot repopulate a stopped view or continue
  the next read. Resuming protection does not reconnect a wallet automatically.
- **Clock and timer failures:** reject invalid or asynchronous timer handles,
  stop the affected operation, clear retained backup credentials, and limit
  resumption after a timing fault.
- **Reviewed restoration:** recheck authorization after callbacks and cleanup.
  Refused preparation prevents a write. Explicitly failed writes cannot be
  reported as success. Unsettled writers preserve recovery data and block a
  further restore rather than claiming an unverified rollback.
- **Three-card confirmation:** read back DAT, EMA and CAWELON settings after
  applying a reviewed plan. Partial updates and no-op writers cannot display
  an all-card success message. A new preview uses the actual current fields.
- **Import and export lifetimes:** cancellation and closing a panel prevent
  reentrant restart and stale success messages. Failed delivery preserves the
  original recovery copy for an explicit retry.
- **Callback and provider cleanup:** contain rejected or malformed asynchronous
  callback results, bound notification feedback, release provider references
  before external cleanup, and ignore late discovery events after disposal.

A successful browser download receipt means the download was offered. It does
not prove that the operating system completed a disk write. Arbitrary work
already started by a nonconforming external adapter cannot be cancelled by a
local guard; its late result is rejected and further authorization is blocked.

## Verified numbers

The final local verification for the tested snapshot is:

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Node unit regression tests | 11,351 | 0 |
| HTTP routes and fixture isolation | 397 | 0 |
| In-app browser UI tests | 811 | 0 |
| **Total, excluding repeated runs** | **12,559** | **0** |

There were no skipped or cancelled tests in those final suites. The comparable
subtotal at the previous publication was 10,382: **2,177 additional cases**.
An earlier unit run reported one worker failure after that file's 63 cases had
passed. Its cause was not established; all 63 passed in isolation and the full
final TAP run passed. The initial and final records are retained locally.

The compiled DAT/EMA/CAWELON local-EVM matrix is a separate check. Its 150 cases
passed at an earlier development snapshot and are not included in the final
12,559 local subtotal. The published revision's GitHub Actions run repeats the
token matrix along with the unit, HTTP and browser checks. Consult
[GitHub Actions](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/workflows/ci.yml)
for the result associated with the published commit; repetitions are not new
unique tests.

Across tracked `.js`, `.mjs` and `.html` program and test files, the physical
line count increased from **97,408 to 112,098**, a net increase of **14,690**.
These figures include comments and blank lines, exclude documentation and CSS,
and describe accumulated work since the previous publication. Line count is
not a measure of security or completion.

Before publication documentation, the full development diff touches 183 files:
17,063 inserted lines and 709 removed lines. Earlier source copies, local
reports and verified recovery archives remain preserved.

## Read the implementation directly

- [Storage admission, cancellation and write boundaries](../src/storage-guard.js)
- [Workspace restore, readback and recovery](../src/workspace-controller.js)
- [DAT / EMA / CAWELON settings review](../src/wallet-setup.js)
- [Encrypted backup lifecycle](../src/secure-backup-controller.js)
- [Deadline enforcement](../src/secure-deadline.js)
- [Wallet read cancellation scope](../src/wallet-read-scope.js)
- [Provider discovery lifecycle](../src/provider-registry.js)
- [Restore confirmation regression tests](../test/restore-confirmation.test.js)

## Scope and remaining acceptance

This remains a read-only development wallet connector. Source publication does
not deploy a website or a smart contract and does not enable signing, transfers,
approvals, swaps or autonomous spending.

The separate real-wallet acceptance exercise for three distinct DAT, EMA and
CAWELON accounts remains pending account availability. Synthetic browser tests
and local-EVM checks do not substitute for that exercise or an independent
security audit. This release does not assert 90% completion.

The `LOCAL_*_2026-10-25.md` reports describe their original local-only iterations.
Their code is included in this source publication; the historical reports retain
their original verification scope and dates.
