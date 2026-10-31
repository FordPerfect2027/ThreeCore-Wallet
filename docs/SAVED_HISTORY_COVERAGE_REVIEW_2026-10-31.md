# Verify saved history-coverage files: item 479

Source: `5cc20fe`.

479. Saved history-coverage JSON can now be checked against its accepted original report set. The reader accepts bounded 4 MiB UTF-8 files, validates their declared short/full-address option, recomputes every derived group, cell, source reference, count and global flag, and compares the canonical source digest. Exact supplied text receives a separate SHA-256 fingerprint. Unknown fields are counted or reported by their containing known field without reflecting unknown names or contents.

The collapsed wallet section keeps coverage-file fidelity separate from completeness. A faithful partial file passes comparison while retaining pending, unplanned and review-required counts per group. Different tokens, chains and accounts are not added together. The independent receipt retains exact large block numbers, IDs, counts and digests without addresses, event bodies or source notes. It is not a restorable source file, authenticity certificate or live-chain check.

Accepted source, pending replacement and the separate event-comparison review stay intact during inspection. A failed follow-up retains the labelled last completed coverage result. Applying another source clears it; a newly completed review resets its own save acknowledgement. Stopped/disposed operations cannot publish late results. Refused or asynchronous save callbacks do not claim success.

The offline command is `node scripts/verify-history-coverage.js source-set.json coverage.json --json` (also `npm run history-coverage:verify -- ...`). It verifies the source wrapper checksum, writes no inputs and performs no RPC. Exit 0 means file fidelity, 2 means mismatch and 1 means invalid inputs. A faithful partial result can return 0. The CLI adds only `sourceChecksumVerified: true` to the shared receipt.

## Validation

67 focused checks passed (11,187.895 ms). The full fixed-source suite passed 15227 checks (304249.4394 ms), zero failed/skipped/cancelled. Native Chrome passed 889 UI cases with synthetic providers and no external RPC. The new UI case opens the collapsed section, verifies a faithful partial result with 14 pending blocks and 12 unplanned blocks in the DAT group, requires a separate save acknowledgement, detects a changed count and clears the result after source replacement. Browser saves are captured callbacks, not OS dialogs or evidence of reconnection to the user's existing browser tab.

[Seven reproducible captures](evidence/2026-10-31-saved-history-coverage-review/) cover short/full-address partial files, complete saved coverage, changed counts, changed ranges, a different source note and exact endpoints above 2^60 with a restricted source. Every standalone CLI output exactly matches the shared verifier plus its checksum flag; both input files remain byte-identical. All source/coverage/receipt files and test logs are retained with SHA-256 checksums. The full checkpoint also covers the zero-increment export-scope stability repair recorded after item 478.

No real-wallet signature, transfer, approval, secret retrieval, publication, deployment or restart of the user's server occurred.
