# Recheck saved replacement comparisons against both originals: item 468

Source: `2e3078b`.

468. While reviewing a replacement set, a saved comparison JSON can now be checked against the currently accepted source and pending candidate. The comparison is regenerated from both original payloads rather than trusting the saved counts, rows or source claims. Changed conclusions, missing/reordered rows, extra fields, reversed originals and hidden metadata changes are detected. A faithful comparison can match while the original sets differ: matching means the comparison is accurate, not that replacement is harmless or the two sources are identical.

The screen shows a pair-bound result and supports saving that result without applying the candidate. Candidate changes, cancellation, failed replacement import and application clear the old result. A malformed follow-up comparison leaves the explicitly labelled last completed result available alongside the error. Late reads cannot publish after cancellation/disposal. Saving requires the separate comparison acknowledgement and synchronous successful delivery.

The reader enforces the existing bounded native-file rules with a 4 MiB limit, strict UTF-8 and security JSON parsing. Semantic comparison ignores object-property order and formatting but preserves array order. Unknown supplied names and values are not copied into diagnostic output: fixed expected field names and an unknown top-level field count are used. The receipt hashes the exact decoded text supplied to the reviewer; native/CLI UTF-8 decoding removes a leading BOM, so this is a text hash rather than an unconditional raw-file hash. Neither original evidence, saved balances, event bodies nor note contents are copied into the verification receipt.

## Offline reproduction

`node scripts/verify-report-set-comparison.js before.json after.json comparison.json --json`

The command validates both original file checksums, uses the same reviewer as the screen, and adds explicit before/after checksum-verification flags. It exits 0 when the saved comparison matches, 2 when it differs, or 1 for invalid input/read failure without partial stdout. It never writes the inputs or accesses a network. File order is meaningful. It does not authenticate authorship, certify safety, recheck the chain or change saved history.

## Validation and evidence

Initial focused checks passed 59 cases (12,418.6662 ms). A subsequent display clarification labels retained results as the last completed review; the final related run, including that clarification, passed 1119 cases (48865.1604 ms), with zero failures, skips or cancellations. Native Chrome passed 878 cases using a synthetic provider and no external RPC, including real DOM File/DataTransfer selection, altered receipt detection, saving through a captured download callback, clearing stale results on another candidate, and unchanged accepted evidence.

The first native run completed with 877 passing cases and one failure in the existing portfolio duplicate-click check: its expected UI state was not reached within the wait budget. The fixture uses a 1-second synthetic session timeout and 4-second state wait. The recorded output does not identify which wait expired, so a timing cause is plausible but unproven. An unchanged-source rerun passed all 878 cases. Both logs are retained; no timeout was raised, check weakened, or code repair claimed for that intermittent failure.

Five [captures](evidence/2026-10-31-report-set-comparison-review/) cover a valid membership comparison, a valid regression comparison, altered conclusions, an unexpected field and reversed originals. Standalone CLI outputs reproduce all shared screen-review fields; all three inputs remain byte-identical. Original files, supplied comparison files, screen-helper/CLI receipts, logs and SHA-256 checksums are retained. These helper captures are under Node, while native UI is checked separately; no user's OS dialog or existing browser connection is claimed. The latest whole-wallet checkpoint remains 15,052 cases at 77e103a. This complete saved-comparison verification workflow counts as one development item.

No real signing, transfers, approvals, secrets, publication or deployment occurred. The user's existing server and tab were not restarted.
