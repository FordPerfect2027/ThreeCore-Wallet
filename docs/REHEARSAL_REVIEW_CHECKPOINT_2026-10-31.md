# Complete difference browsing and exact review evidence

Continuation items 392–396. Source revision `4d4329b`.

392. Expected-result verification can show all, matching or differing cases. The complete source summary remains visible; filtering never limits the saved report. No matching cases and no differences are distinct states.

393. Each case can open its complete differences in bounded pages of 40. The core recomputes each window from validated input; the overview and saved report retain their existing first-40 cap. Page navigation handles source/filter replacement, preserves order without gaps or duplicates, and retires old row actions. A real case ID named “all” remains distinct from the overview option.

394. A reviewed document's SHA-256 can be saved as a small text file, matching the digest in its receipt. Invalidation, replacement or disposal revokes the export; a failed download preserves the current review for retry.

395. The exact reviewed source string can be saved beside its receipt, including whitespace and line endings. Pasted documents can therefore be retained for later verification. Discrepant documents remain exportable as evidence, with the discrepancy retained in the separate receipt. No canonicalization silently changes the hash.

396. An invalid optional checksum identifies and focuses the checksum input, explains the hexadecimal format, and permits correction or clearing without repasting the selected source. Clearing restores existing accessibility descriptions.

## Validation

- Difference pagination and existing check-suite tests: **31 passed**, zero failed/skipped/cancelled; **1,670.3278 ms**. A 102-difference case is covered by 40, 40 and 22 rows without gaps or duplicate positions; export remains capped as before.
- Review exports, existing review panel and pagination tests: **47 passed**, zero failed/skipped/cancelled; **1,665.059 ms**.
- Related rehearsal and server integration at `e323c54`: **1,039 passed**, zero failed/skipped/cancelled; **38,376.0834 ms**. The subsequent correction changed only the browser test import and launcher.
- The first native run at `e323c54` timed out because a duplicate import prevented the test module from parsing. The import was corrected and the launcher now checks all 57 browser JavaScript files before creating a browser profile. The failed log is retained; this validation correction is not another development item.
- Full wallet suite at the fixed source: **14,415 passed**, zero failed/skipped/cancelled; **617,667.0753 ms**.
- Native Chrome real-DOM suite at the same source: **843 passed**, including later-page navigation, empty filters, real checksum computation, exact source/receipt exports and checksum field focus.
- Eight read-only requests to the existing port 4231 rehearsal page and related modules returned HTTP 200 with their expected content types. This checks asset availability, not a connection to the user's browser-control session. The existing server was not restarted.
- Before this record, **93 tracked evidence manifests / 511 files / 33,023,915 bytes** matched their recorded SHA-256 checksums. The saved integrity report does not claim this newly added manifest was included in that check.
- Evidence and SHA-256 checksums: `evidence/2026-10-31-rehearsal-review-exports/`. Source and tests stayed fixed through native and full validation.

The continuation ledger records **396 / 600** completed development items. This count is not a mainnet readiness percentage. Tests and reruns do not add items. Local synthetic data only; no real signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart.
