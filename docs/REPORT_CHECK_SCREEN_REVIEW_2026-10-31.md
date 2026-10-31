# Review saved check details on screen: item 460

Source: `aa114b2`.

460. The report-set screen now accepts a saved check-detail JSON and recomputes it against the currently displayed original set. It explains whether the content and source identity match, retains source-wide findings and lists categories of differences. A completed comparison can be saved as ThreeCore-report-set-check-review.json with the original payload digest and checked-text digest. This is one screen workflow for comparison and its result export; it does not repair or restore either input.

Open the original report set first. Under “保存した確認箇所JSONを元資料と照合”, select the detail JSON (at most 4 MiB). The file's own recorded query/options are used; the visible search controls do not silently replace them. The same acknowledgement controls saving the comparison. Result JSON is unencrypted and contains query text, counts and identifiers, not the original event evidence.

File reading uses the shared page budget, timeout and cancellation. A cancelled older read cannot overwrite a newer comparison. Invalid follow-up files preserve the last completed result with that explicit label and a separate error. Accepting another original set clears the predecessor's comparison and disables its export. Disposal prevents late publication. A matching empty selection can still have source-wide conflicts; matching is not authorship or current-chain verification.

## Validation

Focused file/controller/panel checks: 32 passed (5,537.8609 ms). Related report-set, checklist, local-file, file-budget and file-server checks: 1,078 passed, zero failed/skipped/cancelled (38,698.0325 ms). These cover size/name/encoding rejection, required original, unchanged storage, altered observations, acknowledgement, refused-delivery retry, failed follow-up, stale cancellation, source replacement and disposal.

Native Chrome passed 871 UI cases with a synthetic provider and no external RPC. The new case uses actual browser File/DataTransfer objects to select saved details, show a match, save through the captured download callback, and show a changed-input difference. It does not claim an OS file-picker dialog or the user's current tab was verified. The test uses an isolated profile and a fresh ephemeral server; the existing user server is untouched.

Two captured controller runs reproduce the earlier CLI comparison fields for the unchanged and altered synthetic detail files, and save the exact screen receipt. The CLI additionally reports that its original input file's checksum was verified; the shared screen receipt omits that CLI-only field. Original displayed input and storage are unchanged. These captures execute the shared controller under Node with synthetic File adapters; native UI coverage is separate.

[Evidence](evidence/2026-10-31-report-check-screen-review/) contains the synthetic original/detail inputs, two saved screen comparisons, capture metadata, logs and SHA-256 manifest. Latest full-wallet checkpoint remains 14,968 at 40c28e1; this batch uses scoped and native verification. No real signing, transfers, approvals, secrets, publication or deployment occurred.
