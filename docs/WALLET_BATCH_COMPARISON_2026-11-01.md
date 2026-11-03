# Compare two saved-file selections and recheck saved comparison conclusions

Items 520–521. Source: `2fab027`.

## 520: Comparison of two original-file batches

The browser can retain one owned batch as its baseline, then compare another selection by exact basename. The table distinguishes identical originals/text, formatting-only changes, changed original content, different formats, unverified pairs, before-only selections and after-only selections. Missing selections are explicitly not filesystem deletions. Prior checksum mismatches, invalid content, auxiliary declarations and pending rows never become validated identical originals even when raw hashes happen to match. Scope-count equality does not mask changed annotations or other original content. Partial batches preserve their incomplete status.

The baseline survives a new selection, failed read or clear of the current selection; a separate baseline-clear action removes it. New comparisons invalidate old acknowledgements and exports. The user can save complete JSON or CSV views with both sides, actual/expected hashes, reference states, comparison classifications and limits. Formula-like filenames are escaped. Source bodies are not retained in these receipts and no originals are changed, imported or restored.

## 521: Recompute a saved batch-comparison receipt

A separate file picker accepts a saved comparison JSON up to 1 MiB and checks all fields against a comparison recomputed from the currently owned before/after batches. It detects changed conclusions, summaries, hashes, direction, missing fields and extra fields; property reordering is harmless. The result binds the exact supplied text and both current batch receipts through SHA-256, while distinguishing recomputation agreement from equality or completeness of the original files. Even a faithfully reproduced partial or changed-file comparison does not claim all originals are identical.

The review has a bounded deadline, native cancellation, listener cleanup and stale-result rejection. Stopping, replacing the pair or clearing the baseline cannot publish a delayed review. A separately acknowledged JSON export records agreement or differences, without copying arbitrary imported text. Failed or asynchronous saves cannot claim success. Newly generated receipt-format guidance is supporting maintenance and adds no extra item.

## Validation

The initial comparison-focused run passed 79 checks. The combined focused run passed 110 checks (3334.6646 ms), and all 1,168 related original-format, file-reading, inspection, manifest and batch checks passed (45917.5649 ms), with no failed/skipped/cancelled cases. Native Chrome passed 938 cases across two reconciled isolated profiles with cleanup. New native cases use File/DataTransfer and the actual integrated panel to retain a baseline across sequential selections, distinguish changed formatting and omitted/added selections, export a comparison, detect an altered saved conclusion and export its separate review. These are isolated synthetic/captured-download checks; they do not establish OS-picker operation or control of the user's existing tab.

[Evidence](evidence/2026-11-01-wallet-batch-comparison/) contains synthetic original files and an explicit mapping of each before/after filename to its source artifact. The eight-row union exercises identical, formatting-only, annotation-content, different-format, unverified and before/after-only cases. It includes JSON/CSV comparison captures, a correct review, a deliberately altered conclusion/summary review, reversed-pair rejection and a partial comparison whose review reproduces successfully while retaining incomplete scope. Original artifact hashes are rechecked unchanged, and committed Git blobs are verified. API-generated evidence is distinguished from the separate native browser execution log.

Last full-wallet checkpoint remains d253e8d (15,720 tests). This source has the scoped/native validation above. No signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart occurred. Only the two complete capabilities count as items; tests and evidence files do not. Counts do not measure mainnet readiness.
