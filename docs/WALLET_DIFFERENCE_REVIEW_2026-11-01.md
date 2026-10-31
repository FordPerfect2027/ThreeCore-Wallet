# Recheck a saved JSON-difference result

Item 537. Source: 0681a42.

After computing differences from both selected plain-source files, the wallet guide can explicitly open a saved difference JSON and check every conclusion against the current owned computation. The checker compares locations, kinds, total/listed counts, truncation, array matching, source hashes, source guidance/scope and all capability flags. Missing fields or additional fields prevent a match. Uploaded claims cannot act as the expected calculation.

The result separately reports the exact source bindings and whether the two original JSON values match. A faithfully recorded difference passes verification even when the originals differ; this is not a claim that the sources are equal or authentic. No values, unexpected field names or uploaded text are included in mismatch explanations. Review input is limited to 256 KiB, depth 32 and 10,000 nodes. Hash cancellation/deadline controls remain active, and rejected input never replaces the source calculation.

The browser review uses the last explicit calculation shown above it; it does not silently re-read source files during receipt selection. Re-running the calculation or changing the selected pair invalidates both the displayed review and export state. Stop and disposal suppress late completions. Export requires a fresh acknowledgement. The downloaded review has no restore authority and is recognized only as an auxiliary declaration when re-opened in the general guide.

Independent offline reproduction re-reads both originals:

`node scripts/verify-wallet-saved-differences.js before.json after.json differences.json --json`

Exit 0 means the saved conclusion is faithfully reproduced, 2 means a mismatch and 1 means invalid input. [Evidence](evidence/2026-11-01-wallet-difference-review/) contains a synthetic changed-source pair, its correct receipt, an altered equality claim and the resulting accepted/rejected reviews. Both actual CLI runs exactly match the API receipts. Inputs are preserved.

All 10 focused tests passed (2715.0901 ms) and 1032 related tests passed (59814.0004 ms), with no failures/skips/cancellations. The native Chrome file-read subset passed all 104 cases, including real DOM selection of correct and altered saved receipts plus acknowledged captured export. This scoped run is not full browser coverage. Last full browser checkpoint remains a2eb7e5 (950 cases); last full-wallet checkpoint remains d253e8d (15,720 tests). Evidence hashes are verified against committed Git blobs. No signature, transfer, approval, key access, external RPC, publication, deployment, existing-server restart or user-tab/OS-picker verification occurred. This independent saved-result verification workflow counts as one item.
