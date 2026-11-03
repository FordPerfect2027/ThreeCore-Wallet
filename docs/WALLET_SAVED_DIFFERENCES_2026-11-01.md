# Locate changes in selected plain saved JSON files

Item 536. Source: 7b42cd5.

After comparing supported plain source files in the wallet saved-file guide, the user can explicitly request the locations of changed JSON values. Both files are read again, independently validated and bound to the exact SHA-256 values of the selected comparison. This supports public setup, portfolio snapshots/history and the five rehearsal source schemas. Both sources must use the same schema; internal-checksum originals and auxiliary declarations are not accepted by this workflow.

The result separates exact UTF-8 source equality from parsed JSON-value equality. Whitespace or object-member ordering can differ while values match. Differences contain field paths and kinds only, with an exact total and the first 40 locations. Array rows are compared by position; changed lengths are reported at the array path without enumerating values in extra or removed rows. This is not matching by event identity. The result omits addresses, balances, settings values and notes and is not a restoration artifact, authenticity claim or live-chain check.

Each source is limited to 2 MiB; traversal has bounded depth and node count. The existing comparison remains available for larger sources. Cancellation, pair replacement and disposal suppress late results; an overall asynchronous deadline releases stalled hash/import waits. The user must acknowledge export. Changing the selected pair clears the displayed locations and export state. The new receipt is recognized only as an auxiliary declaration if re-opened in the general file guide.

Independent offline reproduction:

`node scripts/inspect-wallet-saved-differences.js before.json after.json --json`

Exit 0 means parsed JSON values match, 2 means differing values and 1 means invalid inputs. The command uses bounded local reads and never writes its inputs. [Evidence](evidence/2026-11-01-wallet-saved-differences/) contains synthetic source pairs, changed/formatting-only receipts with exact API/CLI agreement and an eight-format formatting matrix. It also preserves the initial test failure: the test expected the wrong existing auxiliary status name, unverified instead of declared-only. The assertion was corrected; the schema behavior was already correct.

All 13 focused tests passed (1679.691 ms) and 1178 related tests passed (68015.1065 ms). A scoped native Chrome run passed 103 file-read UI cases, including actual DOM File selection, pair comparison, location display and acknowledged captured export. It does not count as full browser coverage. Last full browser checkpoint remains a2eb7e5, 950 cases; last full-wallet checkpoint remains d253e8d, 15,720 tests. Source and evidence are local commits; evidence hashes are verified against committed Git blobs. No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment, existing-server restart or user-tab/OS-picker verification occurred. This complete workflow counts as one item.
