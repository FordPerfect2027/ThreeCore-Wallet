# Compare a selected report batch against a saved checksum list

Item 512. Source: `646af16`.

The browser batch panel accepts a previously saved SHA-256 list by file or paste. Its 1–20 portable JSON basenames must match the entire selection exactly. List order may differ; case changes, duplicate names, missing/extra files, paths and malformed lines fail before report hashing. The reference is limited to 16 KiB. UTF-8 BOM, CRLF, uppercase hex and standard text/binary checksum markers are accepted without changing the captured reference bytes. Empty uploaded references are invalid; deliberate clear or empty paste explicitly removes the optional reference.

The exact reference text and SHA-256 are retained in a version-2 receipt. Every report's actual hash is compared with its expected value before recomputation. Different bytes receive checksum-mismatch with no semantic-match claim; even formatting-only changes are detected. Matching bytes can still contain an invalid/unsupported report or failed expectations. Reference digest failure cannot fall back to an unreferenced run. Cancelled receipts preserve completed comparisons and mark remaining rows unchecked. No-reference version-1 output remains byte-identical across the earlier 17-file evidence batch.

Changing the selection retains the reference and rechecks the filename binding. Editing/replacing/clearing a reference retires old results and pending readers; late completions cannot publish. A failed replacement keeps Run disabled until a valid reference or explicit clear. The current-content manifest exports under ThreeCore-selected-content-SHA256SUMS.txt when a reference is loaded, so it is not presented as the earlier baseline. The reference and live histories remain unchanged. A matching list does not establish its provenance or authorize execution.

## Validation

144 focused checks passed (3126.7716 ms); 1,783 related rehearsal, file, evidence and HTTP checks passed (97982.7516 ms), with zero failed/skipped/cancelled. Native Chrome passed all 929 cases across two reconciled isolated profiles with cleanup. Its new case loads real JSON and checksum File objects through DataTransfer, detects added-newline bytes, captures both exports, then explicitly clears the reference and confirms the same JSON still matches recomputation. This does not test the OS picker or confirm access to the user's existing tab. The related suite and native harness startup briefly overlapped; no source changed during either run.

Three previously saved reports reproduce all hashes and calculations against a reverse-order reference. Adding one newline to the third keeps semantic content equal but produces one checksum mismatch; a separate run without a reference confirms that distinction. A cancelled run retains one compared and two unchecked files. A subset is refused. Original source files were rehashed unchanged. [Evidence](evidence/2026-11-01-browser-batch-reference/) includes exact sources, controls, outcomes and logs; its manifest is checked against committed Git blobs.

This complete workflow counts as one item. Last clean full-wallet checkpoint remains db69d73 (15,581 tests); this source has the scoped and native validation above. No signatures, transfers, approvals, secrets, external RPC, publication, deployment or restart of the existing server occurred. The item count is not mainnet readiness.
