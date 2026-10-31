# History selection and regression maintenance

Source: db873d3. Completed count remains **589 / 600**; this repair adds zero items.

An empty or noncanonical removal selection previously coerced to index zero and deleted the first record. Six synthetic before/after reproductions now retain both records; out-of-range selection is covered too. Removal now uses the same canonical, revision-bound selection as record detail. The history recovery panel also receives the root download adapter so its before-change archive is downloadable and testable through that same boundary.

A full-wallet attempt before this repair ran 16,333 tests: 16,331 passed and two failed (517002.965 ms). Both stale assertions expected shared fictional fixture modules to be unavailable even under explicit UI-test mode. The tests now require those exact modules to be unavailable in normal mode and available without caching only in UI-test mode. No server access rule changed; private/CLI files and mutation methods remain blocked.

54 affected checks passed (3899.9786 ms), including both server modes and exact recovery-download contents. 144 focused native browser cases passed (34752 ms), including actual empty select rejection followed by valid removal and exact recovery. [Evidence](evidence/2026-11-01-history-selection-regression-repair/) retains the failed full run and before/after captures. These targeted reruns do not constitute a new full-suite pass. Last full-wallet pass remains d253e8d (15,720); last full browser remains b3254c9 (986).

All fixtures are fictional/local. Existing port 4231 was not restarted. No real wallet connection, external RPC, signature, transfer, approval, secret access, publication or deployment was performed.
