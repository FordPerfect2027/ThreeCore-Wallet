# Fixed review package and complete regression — November 3, 2026

Wallet source `bf690f38b070362aab1369fbf22c8e68b1a6567f` passed the full
Node/HTTP and synthetic browser suites after restoration from its standalone
review package. This closes the gap between the earlier full run at `2126019`
and the newer diagnostics, navigation recovery and evidence-checker changes.
The restored checkout remained clean after both runs.

| Check | Observed result |
| --- | --- |
| Node/HTTP | 16,470 passed; zero failed, cancelled, skipped or todo |
| Synthetic browser | 1,024 passed in two separate 512-case profiles |
| Browser module preflight | 261 local modules |
| Wallet source export | 4,783 files matched the fixed Git source |
| Saved evidence in that source | 258 manifests / 2,676 entries matched |
| Separate startup check | 11 checks passed; its temporary server closed |
| Final package extraction | All 42 listed files matched, with no extra files |
| Negative control | Altered entry instructions rejected; restored bytes accepted |

The Node/HTTP run started at 2026-11-02 17:54 UTC and ended at 18:03 UTC
(November 3, 02:54–03:03 JST). The browser run ended at 18:04 UTC (03:04 JST).
These are test cases, not independent features or a release completion score.
No real-wallet operation or public RPC was involved in this regression.

## Fixed package

File in Downloads: `ThreeCore-review-bf690f3-20261103-r1.zip`

- Size: 52,755,739 bytes
- SHA-256: `df9c6d20beefd1e4079cbf296f413f7d9257f07b851148da6e81056de36cb60e`
- Wallet: `bf690f38b070362aab1369fbf22c8e68b1a6567f`
- DAT: `ada78f5ecbd8654860d818b774ef31beb6f0b871`
- EMA: `c4765efe92857e7060c0efaa44b271c67d8d68c3`
- CAWELON: `a94d61be77c0c14109910879cdd6a7f377176101`

All four complete Git histories were restored into empty directories with no
remotes and clean checkouts. Each source ZIP matched that repository's committed
bytes. The token follow-up changes only four-case validation guards; contract
artifacts match the separately verified prior builds. No token dependencies were
installed or contracts rebuilt during this packaging operation.

The first sealed package's entry instructions still omitted the newly completed
full regression. The `-r1` package corrects that omission; code and test results
are unchanged. The earlier ZIP is retained, not overwritten.

Start with `START_HERE.txt`, `VALIDATION.txt` and `REVIEW_NOTES.txt` in the outer
package. `validation/` contains raw logs and exact start/result receipts.
`REVIEW_SCOPE.json` maps six implementation/tooling files changed since the last
full regression. The frozen source's older handoff references are historical;
the outer package receipt supplies the exact current pins. Verify extraction:

```powershell
node verify-package.mjs
```

The returned `allMatched: true` establishes file consistency. It does not certify
provenance, token safety, current on-chain state or independent approval.

## Reproduce the regression

From the restored Wallet checkout, with the documented Node/browser prerequisites:

```powershell
node --test --test-reporter=tap --test-timeout=60000 --test-concurrency=2 test/*.test.js integration/*-server.test.mjs integration/local-navigation-help.test.mjs
node scripts/test-browser-ui.js
```

The browser harness uses synthetic providers and disposable profiles. Preserve
the user's loaded pages and the original 4231/4232/4233 servers. Never substitute
these synthetic results for actual MetaMask event observations.

## Evidence and remaining conditions

- [Regression receipt](evidence/2026-11-03-fixed-review/summary.json)
- [Node/HTTP log](evidence/2026-11-03-fixed-review/node-http-tests.log)
- [Browser log](evidence/2026-11-03-fixed-review/browser-tests.log)
- [Package receipt](evidence/2026-11-03-fixed-review/package-receipt.json)
- [ZIP extraction and alteration control](evidence/2026-11-03-fixed-review/zip-receipt.json)
- [Evidence checksums](evidence/2026-11-03-fixed-review/SHA256SUMS.txt)

Actual connected-account and site-network switch invalidation remain unverified.
The prior live session stopped for inactivity before a new switch was observed;
it is not counted as an event-invalidation pass. Native Windows picker traversal,
any required prior-public-release rollback, the Zod development finding,
independent review and explicit release decision also remain separate gates.
GitHub publication remains deferred for the requested consolidated update.
