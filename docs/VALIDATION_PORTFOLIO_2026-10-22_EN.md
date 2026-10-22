# Portfolio features and validation — October 22, 2026

This update integrates the preserved local work and the subsequent portfolio UI
development. Original migration patches and historical validation reports remain
available. This is development tooling, not production wallet or contract deployment.

## Resulting behavior

- Recheck chain/account identity after every asynchronous wallet read. Discard
  stale values after silent switches, reconnects or provider invalidation.
- Fail closed when experimental connector store mutations fail or diagnostics
  contain unexpected privileged RPC requests.
- Read one to 32 explicitly selected token contracts at a pinned canonical
  block, with exact decimal strings for uint256 base units.
- Treat missing contract code as unknown balance rather than zero.
- Coordinate DAT/EMA/CAWELON portfolios through distinct already-connected
  accounts. Each agent pins its own block; the result is not atomic across agents.
- Export/import historical JSON observations without reviving permissions.
- Compare observations only for the same agent/account/chain/site origin;
  reject reversed block order and conflicting observations at the same block.
- Preview token-list JSON before explicitly replacing the input list. Recheck
  agent/chain and text at application time. Never connect or read automatically.
- Show bounded, validated progress phases and completed-token counts. Final
  canonical-block verification is required before a report becomes exportable.
- Cancel local waits, discard late results/progress and show finite error labels.

Token plans contain configuration only. Imported reports are not authenticated
and cannot authorize wallet connections or transactions. Values are raw base
units; no asset totals, prices, profits or transfer-history claims are inferred.

## Recorded validation

| Check | Result | Scope |
| --- | --- | --- |
| Node unit suite | 1,078 passed; zero failed/skipped/cancelled | Offline/synthetic providers |
| In-app browser UI suite | 84 passed; zero unexpected browser errors | Synthetic provider, no external RPC |
| HTTP serving/isolation | 2 passed | App modules, hidden test routes in normal mode |
| Manual progress scenarios | 3 passed | Waiting, cancellation/late reply, explicit successful retry |

These are recorded local results. GitHub Actions separately validates the
published commit; its status is not implied by this report. The previous
historical reports' test counts describe their own earlier snapshots.

The Linux headless runner is updated to expect 84 cases. Local Windows browser
validation used the existing in-app browser. The headless runner and pinned
token-contract integration matrix will run in GitHub Actions.

## Reproduction

    npm test
    npm run test:demo-server
    npm run demo -- --ui-test

Open the displayed loopback URL:
- / — normal development UI
- /test/browser/ — complete synthetic UI suite
- /test/browser/progress-demo/ — manually released synthetic balance response

The progress demo uses invented addresses/balances, no real wallet, and
connect-src 'none'. Test routes are not served in normal demo mode.
On Linux with the CI browser installed:

    npm run test:browser-ui
    node scripts/test-browser-ui.js --verify-error-detection

## Count and limits

The code/test changes in this update add 6,026 physical lines compared with
Wallet baseline 5ea6f9d3737662a09741e33e288c295a74476e47. This includes tests
and blank lines; it excludes prose, logs, JSON evidence and archives. The
previous preserved-project aggregate of 21,358 plus this local delta gives
27,384; that aggregate is not the line count of this Wallet repository alone.

No production contracts, token supplies, deployments, signing, approvals,
fund transfers, swaps, bridges, custody or autonomous spending were changed.
Real-wallet compatibility and completed third-party dApp login remain unverified.
This validation is not an independent security audit. Local backups and raw
development logs remain on the PC and are not published with this update.
