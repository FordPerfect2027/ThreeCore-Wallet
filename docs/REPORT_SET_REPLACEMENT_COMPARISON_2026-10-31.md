# Compare a replacement report set before applying it: item 467

Source: `3371de9`.

467. Importing or preparing a new report set while another is displayed now shows the changes before replacement. Reports are matched by saved ID. Added and removed members, changed evidence, metadata-only changes and unchanged members are counted separately. The review includes token-level acquisition progress, changed observation categories, context or period changes, archive changes and removal of a re-read restriction. Report removal here changes membership only; it does not delete saved history.

The separate comparison checkbox authorizes saving the comparison while leaving both the accepted set and pending review in place. A new candidate clears that acknowledgement. Saved notes, tags, event bodies and balance values are not copied as dedicated fields; set names and report labels can still contain personal text or public addresses. The file is unencrypted and is not an evidence backup. Both original set files must be retained.

The JSON receipt binds the canonical SHA-256 payload digest of each original. The offline command `node scripts/compare-report-sets.js before.json after.json --json` verifies both original wrappers and reproduces the same receipt bytes. `--require-same` exits 2 for any recorded difference, including metadata or ordering; without it, 0 means comparison completed. Invalid input exits 1 without partial output. Text mode explains saved-record differences. No network calls, automatic merges or original-file writes occur.

## Validation

Focused comparison/controller/panel/CLI checks: 88 passed (10799.8004 ms). Related report-set, check-detail, history, period and file checks: 1104 passed (55340.1729 ms), with zero failures, skips or cancellations. Native Chrome passed 877 UI cases using a synthetic provider and no external RPC. The new browser case saves a comparison through a captured download callback, confirms the old accepted set remains displayed, changes the candidate to clear acknowledgement, and then applies it. This does not exercise an OS download dialog or reconnect the user's existing tab/server.

Five [evidence captures](evidence/2026-10-31-report-set-replacement-comparison/) cover membership replacement, metadata-only edits, missing previously saved records, changed chain context and identical sources. Every standalone CLI output matches the shared screen export helper byte-for-byte; input files remain unchanged. Captures, source files, validation logs and a SHA-256 manifest are included. The latest complete wallet checkpoint remains 15,052 checks plus 876 native UI cases at 77e103a; this addition received the targeted and native runs above. This complete replacement-review workflow counts as one item, including its CLI and tests.

All conclusions describe saved historical evidence. Matching checksums or a later timestamp do not authenticate the source, certify token safety or recheck the current chain. No real signatures, transfers, approvals, secrets, publication or deployment occurred.
