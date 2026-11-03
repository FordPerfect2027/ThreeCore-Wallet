# Verify saved event-comparison files: item 478

Source: `5ef9ea5`.

478. A saved event-comparison JSON can now be checked against its original accepted report set in the wallet. The validator recomputes the file's declared A/B report IDs and token, compares the complete derived result and flags, verifies the canonical source digest and fingerprints the exact supplied text. The bounded 24 MiB file reader retains the shared strict JSON/UTF-8 and cancellation rules. Unknown fields are counted without reflecting their names or values. A new dedicated UI section presents the result and saves a separate non-restorable receipt after its own acknowledgement. File-type guidance points comparison files to this reader and identifies receipt-only files.

File fidelity and observation agreement are separate conclusions: a faithful file describing event or anchor differences passes recomputation while retaining those differences; a faithful file with no common saved range also passes file comparison while clearly reporting that observation comparison was not established. A match does not authenticate authorship, completeness or current chain state.

The accepted source and pending replacement candidate remain untouched. A failed follow-up check retains the labelled last completed result. Applying a replacement source clears the old receipt and acknowledgement. Stopped/disposed operations cannot publish late results; refused or asynchronous save callbacks cannot claim success. Receipts retain validated source restriction/archive/hash-consistency flags, as well as IDs, digests, counts and expected status, without event bodies, addresses, quantities or source notes.

The offline command is `node scripts/verify-saved-event-comparison.js source-set.json comparison.json --json` (also `npm run report-set:verify-events -- ...`). It verifies the original wrapper checksum before recomputation, writes no inputs and performs no RPC. Exit 0 means file fidelity, 2 means file mismatch and 1 means invalid inputs; exit 0 is explicitly not a claim that the compared observations agree. The CLI receipt adds only `sourceChecksumVerified: true` to the shared review.

## Validation

76 focused checks passed (12,476.2792 ms). Two earlier attempts at constructing a warning fixture were rejected by existing original-record validation (conflicting event/endpoint hashes). The final test verifies that invalid originals are rejected and valid archived/restricted originals retain their flags; production validation was not relaxed. The two failed fixture logs are retained. The related suite, including the report HTTP integration tests, passed 2784 checks (106731.0694 ms), zero failed/skipped/cancelled. Native Chrome passed 888 UI cases with a synthetic provider and no external RPC. The new browser case verifies faithful differences, separate export acknowledgement, receipt output, unchanged source and clearing after replacement. Browser saves are captured callbacks, not OS file dialogs or evidence of connectivity to the user's existing browser tab.

[Six reproducible captures](evidence/2026-10-31-saved-event-comparison-review/) retain agreeing observations, faithful differences, no common range, changed event quantity, different original-source notes and a restricted archived source. Every standalone CLI receipt exactly matches the shared verifier with the documented checksum flag, and both input files stay byte-identical. The source/comparison/receipt files, logs and checksums are retained. Latest full checkpoint remains 15,193 checks and 887 native cases at 8e8061e.

No real-wallet signature, transfer, approval, secret retrieval, publication, deployment or restart of the user's server occurred.
