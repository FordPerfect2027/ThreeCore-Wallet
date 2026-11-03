# Direct page and adjacent record navigation

Items 544–545. Source: 0388e28.

## 544: Jump directly to a matching page

The rehearsal record explorer now offers first/last-page actions and an explicit page-number field with an Enter shortcut. It displays the page count for the current search. Only integer pages inside that result are accepted; invalid input keeps the current records, filters and exports while showing an accessible error. Empty results and invalid filters disable these controls. Page size changes recalculate the range. A source replacement clamps the view to its current result, and disposal removes the actions.

## 545: Walk through matching record details

Previous/next detail actions keep the current filters and move across page boundaries, including between agent ledgers in the existing canonical order. The detail position says which matching record is selected out of the full match count. Within a page, only the detail is refreshed; crossing a boundary updates the visible page and focuses the selected record. Endpoints disable movement. These controls preserve the existing related-record Back view and never edit, replay, import or authorize a record.

Full-query JSON/CSV exports still include all matches rather than the visible page. The 600 synthetic events used for capacity verification are not 600 completed development items, real transfers or block checks. This change adds two counted product capabilities.

All 63 focused tests passed (1677.5314 ms), with 118 related tests (7268.1986 ms) and all 109 scoped native Chrome file-read UI cases. The native 600-record integration case verifies page 60, direct Enter navigation to page 21, movement back across the DAT/EMA boundary, invalid page 61, filtered detail movement and exact session preservation. [Evidence](evidence/2026-11-01-rehearsal-record-navigation/) includes the synthetic source, complete and filtered reports, panel capture sequence and test logs. Committed evidence hashes are verified.

Last full browser checkpoint remains a2eb7e5 (950 cases); last full-wallet checkpoint remains d253e8d (15,720 tests). These scoped runs do not establish full browser coverage or a connection to the user's current tab. No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or existing-server restart occurred.
