# Export saved history coverage with original-record references: item 469

Fixed source: `5c0a5a5`.

469. The saved-history coverage shown on screen can now be exported as JSON or CSV, or reproduced offline from a checksummed original set. Every token/account/chain group is retained, independent of check-list filters. The file distinguishes recorded query ranges, planned ranges without records and intervals outside any included plan. Source-wide findings and missing-token report IDs remain visible. Overlapping ranges count each block once within their group; different groups are never summed.

Each recorded cell points to the original report ID and zero-based query-record index. Its original inclusive query window, source status, restriction/archive flags and whole-window event count are retained. An event count is not redistributed across split cells and must not be summed over those cells as a transaction total. The exact ranges, overlap/review counts, block conflict references and original payload SHA-256 support independent checking. This is presence of saved query records, not proof that a provider returned complete history or that no transactions happened in an empty span.

CSV has a source-summary row, one group-summary per context and range rows. Their separate row types avoid treating summary totals as extra range rows. CSV quoting preserves JSON reference arrays and names; formula prefixes are neutralized where applicable. JSON preserves integer block counts as strings, including gaps above Number.MAX_SAFE_INTEGER. Both formats are bounded to 4 MiB and fail rather than silently truncating.

Structured account and contract addresses follow the existing shortening control. Full addresses require that control to be disabled; names may still contain addresses. Note bodies, balance values and event bodies are not included, even if the separate notes control is checked. Original evidence remains in the checksummed set JSON; coverage output is not a restorable backup. Exports use the existing acknowledgement/cancellation/delivery controls and do not mutate accepted evidence or stored reports.

## Reproduction

`node scripts/export-history-coverage.js source.json --format json`

Use `--format csv` for the table, `--full-addresses` for full structured addresses, and `--require-continuous` to exit 2 when the complete source analysis still requires review. Default exit 0 only means export succeeded; invalid input exits 1 without partial output. The CLI validates the source wrapper and reproduces the screen export byte-for-byte. It performs no network calls or input writes.

## Validation

Focused coverage, CLI, model and panel checks: 51 passed (8,247.1772 ms). A draft test initially attempted to construct a report with all three slots absent, which the existing schema correctly rejects; the fixture was corrected to retain DAT and test missing EMA/CAWELON. No product validation was loosened and that draft failure adds no completed item.

Full wallet at 5c0a5a5: 15,097 passed, zero failures/skips/cancellations (302,736.129 ms). Native Chrome passed 879 UI cases, including JSON/CSV callback capture after a zero-match checklist filter, address disclosure controls and unchanged original input. The suite uses an isolated profile, fresh ephemeral server and synthetic provider, with no external RPC. No user's OS dialog or original tab reconnection is claimed. The earlier intermittent portfolio wait at 2e3078b is recorded with both failure and unchanged-source passing logs in the item-468 evidence; this full/native checkpoint records its own results without erasing that history.

Eight [captures](evidence/2026-10-31-history-coverage-export/) cover partial acquisition, overlapping/conflicting evidence, an exact very large gap and full versus shortened addresses in both formats. Every CLI output is byte-identical to the shared screen export helper, and original source files remain unchanged. Sources, outputs, logs and SHA-256 manifest are retained. This complete coverage-export workflow counts as one item.

No real signatures, transfers, approvals, secret access, publication or deployment occurred. The existing user server was left running. Counts of development items and tests are not mainnet-readiness percentages.

## Evidence collection checkpoint

At committed record 388797d, all 132 tracked manifests and all 890 referenced files matched their SHA-256 checksums (54,498,841 bytes). The read-only audit is retained as `prior-evidence-audit.log`. That observation predates adding this audit log itself to this folder and regenerating its manifest; it does not claim to authenticate authorship or current chain state. This record-only update adds no development item.
