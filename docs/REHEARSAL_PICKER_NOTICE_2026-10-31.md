# Rehearsal file-selection guidance

Continuation item 375. Source revision `87b9c16`.

Five rehearsal pickers (single record, combined session, comparison collection, expected outcomes and report review) now explain that dismissing the picker or selecting no file leaves existing results and pending reads unchanged. A separate live notice preserves the actual read/review status. Selecting a new file, explicitly clearing the panel or disposing it clears the notice. Disposed listeners cannot revive it.

Each input identifies its notice and existing status with aria-describedby. The workspace picker keeps its existing notice and gains the same explicit accessibility association. Shared presentation support lives in the already served file-read panel module, so the running 4231 server does not require a new route or a restart.

## Validation

- New lifecycle scenarios and existing file/name checks: **111 passed**.
- All selected rehearsal, file-panel and demo/navigation integration tests: **855 passed**, zero failed/skipped/cancelled; **32,510.893 ms**.
- Native Chrome real-DOM suite at the fixed source: **837 passed**, including native File/DataTransfer selection, cleared FileList, retained preview authority, notice references and disposal. The rehearsal template was parsed into a native DOM for this test; no user's live tab was changed.
- Read-only HTTP checks against the existing 4231 process: HTML and all seven affected/required served modules returned **200** with the expected content types. This verifies asset availability, not an active browser-control connection.
- Evidence and SHA-256 checksums: `evidence/2026-10-31-rehearsal-picker-notice/`.

Latest full-wallet checkpoint remains 14,181 tests at `a4d6952` through item 360. No new full-wallet run is claimed here. Synthetic data only; no real wallet signature, transfer, approval, secrets, publication, deployment or existing-server restart.
