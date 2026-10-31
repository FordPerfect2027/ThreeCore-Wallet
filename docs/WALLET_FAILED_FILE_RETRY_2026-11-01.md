# Retry only failed selected-file reads

Item 546. Source: 63698e4.

After every selected wallet file has been attempted, an explicit action retries only source-unavailable or hash-unavailable rows. Successful validations, invalid document results and external-checksum mismatches are retained without rereading. It uses the same captured selection and original optional checksum list. Copied receipts and text-only batch results cannot authorize retry. Pending initial rows use the existing Continue action first.

V5 results link the exact previous receipt with SHA-256 and record zero-based target, completed and remaining indexes, sequence and retained-check count. A cancelled or timed-out retry preserves the old failure row for unattempted targets; it does not relabel that failure as a newly completed check. A subsequent retry reads current failures only. The old receipt stays immutable. If lineage hashing fails, no retry file is read and the panel keeps the old result. Normal V1–V4 runs retain their existing schema and output.

The display separates total historical checks from this retry's progress and explains which rows were retained. Save acknowledgement is cleared. JSON/CSV record the lineage; the checksum list becomes available only after a complete result with every source hash. Replacing files or the reference resets retry authority, and late completion cannot restore the prior view. This does not provide an atomic snapshot or refresh successful older files.

All 22 focused cases passed (1755.312 ms), followed by 182 related cases (14396.9717 ms), including prior stream, continuation, comparison and export behavior. All 110 scoped native Chrome file-read cases passed. The new native case selects three real File objects, injects one temporary read failure, then confirms only that file is read again. It does not model an actual disk failure or reconnect the user's tab.

[Evidence](evidence/2026-11-01-wallet-failed-file-retry/) uses four synthetic files with failures at indexes 1 and 3. A retry is stopped after index 1, then only index 3 is retried. The read sequence is 0,1,2,3,1,3; unchanged rows and previous receipts remain exact, both lineage hashes match, and final expected checksums match. The eight read calls required by two complete repeated scans are reduced to two targeted retry reads after the initial four; this is work-count evidence, not a wall-clock speed guarantee. Hashes are verified against committed evidence blobs.

Last full browser checkpoint remains a2eb7e5 (950 cases); last full-wallet checkpoint remains d253e8d (15,720 tests). No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or existing-server restart occurred. This is one completed product capability; test cases and retry attempts do not add development items.
