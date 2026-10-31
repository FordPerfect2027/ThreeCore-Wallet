# Keep and continue rehearsal report-file verification

Items 538–539. Source: 53d2e9c.

## 538: Preserve completed checks across unreadable or stalled files

The rehearsal report batch now reads and recomputes each selected file before starting the next. A decoding/read/size failure is recorded as source-unavailable and does not discard successful earlier or later reviews. Stop or the overall deadline preserves the completed prefix and marks the rest pending. The owned native abort state is used even if an adapter shadows the signal's aborted property. Late reader settlement cannot add a result.

Unknown content bytes are null, with the original selected size kept separately as reportedByteLength. Partial or unreadable-source receipts use V3, with known-byte totals, selected reported bytes and unread reported bytes. CSV carries this scope and leaves unknown content bytes blank. Source-unavailable rows cannot hand off a fabricated detail source or produce a complete checksum manifest. Normal fully read batches preserve V1/V2 JSON, CSV and manifest bytes exactly, including referenced inputs. Existing text-only batch behavior is retained. Limits remain 20 files, 2 MiB each, 8 MiB total and 120 seconds per attempt.

## 539: Continue pending checks from the current selection

The explicit Continue action retains the exact completed prefix, including failed attempts, and reads only pending source indices. It keeps the original captured names/sizes and external checksum reference; callers cannot replace the reference. Current-module unfinished file-batch receipts alone authorize continuation. Uploaded copies, text-only receipts and completed batches cannot. Changing selection/reference or clearing the panel invalidates continuation and detail-source state.

V4 receipts include sequence, retainedReviews, previousPhase and the SHA-256 of the exact previous receipt text. The linkage hash is inside the attempt's cancellation/deadline lifecycle; a failure preserves the prior saveable result, and a pre-cancelled attempt records null rather than inventing a hash. Retained reviews are explicitly labeled as not re-read in this attempt. This is accumulated evidence, not an atomic snapshot or new verification of the retained prefix. CSV includes linkage fields; unknown byte fields remain when retained failures exist.

The existing detail action retains the exact text and earlier expected checksum of completed records. There is no automatic workspace import, account connection or live query. The browser still retains bounded selected text for detailed review; no reduction in total retained browser memory is claimed.

128 focused batch tests passed (4648.896 ms), followed by 179 related review/difference tests (6748.2978 ms). These disjoint test-file groups were run sequentially. The native file-read subset passed all 106 cases, including an undecodable native File between two valid reports and actual Stop/Continue with the first file read once. The browser fixture uses real File/DataTransfer/DOM with controlled hashing and captured downloads; it is not the user's wallet tab or an OS picker.

[Evidence](evidence/2026-11-01-rehearsal-file-batch/) records complete normal/referenced batches, byte-identical legacy output checks, a real local UTF-8 decoding failure, a stopped source and a resumed receipt. The captured read order is 0,1,1,2, and the retained row is the same owned object. Hashes are checked against committed Git blobs. Last full browser checkpoint remains a2eb7e5 (950 cases); last full-wallet checkpoint remains d253e8d (15,720 tests). The new scoped run is not full browser coverage. No signature, transfer, approval, key retrieval, external RPC, publication, deployment or existing-server restart occurred. Two complete workflows count as two items; schema variants, controls, assertions and reruns do not add items.
