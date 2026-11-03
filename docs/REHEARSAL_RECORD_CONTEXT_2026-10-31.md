# Searchable recorded context and complete CSV exports

Continuation items 419–420. Final source revision `18fa5d5`; the initial CSV implementation is `0a31bf8`.

419. Rehearsal record searches can be exported as a viewing-only CSV in the browser and with `scripts/inspect-rehearsal-records.js --format csv`. Export includes every matching record across pages, original record numbers, recorded and stored identities, event inputs, rejection reasons and all six before/after/delta balances. Atomic-unit values are serialized directly from exact decimal strings, without floating-point conversion. UTF-8 BOM, CRLF and quoted cells support spreadsheet import; formula-like search text is prefixed as inert text. Spreadsheet applications should import all columns as text to avoid their own rounding. A zero-match CSV contains headings only, and the UI says so. It does not replace the JSON report's full inputs or absent-agent scope. Failed, asynchronous and superseded download offers preserve current history and never claim completed disk storage.

420. A separate search scope can inspect the account, agent, network, site and spender actually recorded in an event, or combine these with stored-ledger information. The saved-agent filter still selects the owning ledger; it never silently becomes an event-agent filter. Related-record navigation remembers and restores this scope. New scoped reports use `threecore.operation-rehearsal-record-query.v2`; V1 query behavior, exports and historical replay remain unchanged. V2 reports are independently rechecked in the report panel, offline verifier and portable evidence package. CSV and JSON use the same normalized query. Invalid scopes, getters, duplicate CLI flags and version/shape mismatches fail without partial exports.

## Usage

In “3トークンの記録を探す”, choose where the search terms should be matched. The default “保存元の情報（従来の検索）” retains V1 behavior. “記録に書かれた情報” and “保存元と記録の両方” generate V2 reports. Use “全一致記録をCSV保存” for spreadsheet viewing and the existing JSON action for reproducible evidence.

Offline examples, from the repository root:

```sh
node scripts/inspect-rehearsal-records.js workspace.json --format csv
node scripts/inspect-rehearsal-records.js workspace.json --search-in recorded --agent DAT --search wrong_account
node scripts/inspect-rehearsal-records.js workspace.json --search-in both --kind open --format csv
node scripts/verify-rehearsal-report.js docs/evidence/2026-10-31-record-context/recorded-query.json
```

## Validation

- Initial CSV/source/panel/CLI checks: **46 passed**, 1,080.8748 ms. CSV integration checks: **1,201 passed**, 38,585.7383 ms.
- Final scoped search, CSV, legacy compatibility and review checks: **91 passed**, 1,815.5005 ms. Two initial test-fixture defects—an 85-character query beyond the existing 80-character limit, and an incorrect receipt property—were corrected; that first-pass log is retained and is not presented as a successful run.
- Final related rehearsal/server checks: **1,221 passed**, zero failed/skipped/cancelled; **36,399.7191 ms**.
- Full wallet suite at `18fa5d5`: **14,650 passed**, zero failed/skipped/cancelled; **465,560.8859 ms**.
- Native Chrome at the same source: **853 passed**. Added native cases inspect 600 synthetic CSV records beyond the visible page, header-only zero matches, saved-context versus recorded-context queries, rechecked V2 output and unchanged combined session data.
- Saved CLI artifacts contain **600 fictional records**, a **one-match** recorded-context query and an independent review with **zero differences**. Original input bytes remain unchanged. These record counts are not development-item counts.
- All **557 files in 102 previously tracked evidence manifests**, totaling **36,569,998 bytes**, matched their SHA-256 checksums.
- The prior 418-item ledger has 94 documented ranges, with no missing or duplicated item numbers and no missing referenced local documents. This checks the count and references, not mainnet readiness.
- The existing 4231 server returned its rehearsal HTML and seven checked modules with HTTP 200 and correct MIME types. It was not restarted. Asset availability is not a claim that the user's browser-control connection is active.

Evidence, generated synthetic files and SHA-256 manifest: `evidence/2026-10-31-record-context/`.

The ledger is **420 / 600**. Tests, repeated runs, CSV rows and audit checks do not add development items. This is a local synthetic development checkpoint, not a mainnet-readiness percentage. No real signatures, transfers, approvals, private keys, external RPC, publication or deployment.
