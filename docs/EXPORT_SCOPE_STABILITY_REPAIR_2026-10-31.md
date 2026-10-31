# Export scope stability repair — no item increment

Source: `6bb6fb8`. Completed count remains **478 / 600**.

Two existing exporters consumed mutable query objects only after publishing their busy state. A synchronous observer could change the requested export. With synthetic source records, a selected missing-history window 41–42 became block 42 only after windowSize changed from 2 to 1; DAT-only activity CSV expanded from one row to all three token rows after agent changed to all. Neither reproduction changed the source, read a provider or wrote browser storage.

Missing-history export now validates and captures the normalized query and selected draft before publishing progress. The shared builder returns its immutable normalized query; exported period JSON remains byte-identical for unchanged inputs. Invalid selections preserve an unapplied candidate, and cancellation during query reflection cannot revive export. Vault activity export likewise captures its full filter before the export observer; cancellation, disposal and malformed/accessor queries cannot initiate output. Non-filtered formats continue to ignore unused query objects.

The same reproductions at the repaired source retain the exact requested plan and one DAT row. This repairs already delivered behavior and adds **zero** completed items.

## Validation

78 focused checks passed (3,174.2181 ms). The initial added cancellation fixture used an ownKeys trap, which optional-field capture does not call; the fixture was corrected to exercise the actual descriptor capture and confirm cancellation occurred. Production cancellation was not weakened. The focused failure and final logs are retained.

The related suite passed 1634 checks (82367.7897 ms), zero failed/skipped/cancelled, covering report sets, proposal handoff, vault controllers/filtered export, export guards and wallet cancellation. [Evidence](evidence/2026-10-31-export-scope-stability-repair/) includes before/after observations, logs and SHA-256 checksums. No native browser rerun is claimed for this controller-only repair; the previous UI checkpoint remains 888 cases at 5ef9ea5, and the full checkpoint remains 15,193 cases at 8e8061e.

No real signatures, transfers, approvals, private material, publication, deployment or restart of the user's server occurred.
