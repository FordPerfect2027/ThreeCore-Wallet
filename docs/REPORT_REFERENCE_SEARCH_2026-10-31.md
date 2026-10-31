# Locate report checks from exported references: item 457

Source: `8440316`.

457. Report-check search now includes check IDs, source report IDs, hashes recorded on contradictory observations and exact stored integer-value strings. The browser shows each check ID beside its title and states that IDs belong to the selected set, not a global registry. A CSV reader can return to that set and locate the same check. Browser filtering, CSV exports and the offline export command share the same query semantics.

Search remains bounded, case-insensitive, literal and substring-based; it is not a regular expression or numeric conversion. Existing token/severity filters still apply. Searching check-1 can also match check-10 when present. Hash/value search covers observations attached to diagnostics, not an exhaustive search of every event in the source. Global counts, continuity conclusions and source evidence are unchanged by filtering. Selecting a different set can generate different check IDs; retain the original source JSON when citing one.

## Validation

Five missing-behavior controls initially failed (1,725.6973 ms). After implementation, 36 focused search/panel/CLI cases passed (8,790.5387 ms). The complete report-set, checklist, reference-search, CLI and local-file group passed 326 cases, zero failed/skipped/cancelled (24,385.8469 ms). Native Chrome passed 869 UI cases with a synthetic provider and no external RPC, including search by a visible check ID, exact filtered export, unchanged source and restoration of the full list.

Five captured query/export pairs cover check ID, source report ID, full hash, an integer larger than JavaScript's safe-number range, and punctuation that matches nothing. Results include original category totals and the exact selected diagnostics. [Evidence](evidence/2026-10-31-report-reference-search/) contains the two synthetic sources, query results/CSV bytes, failing and passing controls, native log and SHA-256 manifest.

The previous full-wallet checkpoint remains 14,921 at db8fb98; this batch uses scoped checks plus native UI coverage. No real wallet/network access, signing, transfer, approval, secret acquisition, existing-server restart, publication or deployment occurred. This reference-lookup flow counts as one item.
