# ThreeCore working agreement

The user requested this operating method on November 3, 2026 (Japan time).

- Continue the authorized task through execution, verification, problem detection,
  cause analysis, correction, another execution and another verification.
  Ordinary errors, lost browser connections and failed tests are evidence for the
  next step, not by themselves reasons to return the task to the user.
- Try supported recovery paths and continue independent useful work. Do not
  repeatedly retry an unchanged failed action or manufacture test counts.
- Ask the user only for genuinely missing decisions or actions that require
  them, such as personal authentication or significant irreversible actions.
  Do all authorized preparation first and explain the concrete dependency.
- Respect tool-enforced safety stops. Do not bypass access restrictions or
  weaken protections to get a passing result. Follow an explicit instruction
  to stop the turn when a tool requires it.
- Verify actual results and save evidence. Keep synthetic tests, user reports,
  observed live wallet behavior and planning percentages distinct. Do not claim
  90% or a release gate solely from elapsed time or the number of passing tests.
- No user-wallet signing, sending, token approvals, swaps, private-key or seed
  access. Normal authorized connection and read-only work may proceed.
- The user explicitly authorized routine MetaMask operation, including existing
  account selection, network selection and the ThreeCore site connection. Carry
  out these ordinary actions when supported controls can identify the intended
  wallet and site. Do not ask the user to repeat them merely because they are in
  MetaMask. Authorization does not remove tool-enforced access restrictions.
- Codex is assigned the developer technical review by the user. Do not wait
  for requester/reviewer identification or treat an unassigned third-party
  reviewer as a reason to stop authorized development. Distinguish this review
  from independent external approval; finish the technical work and record it.
- Keep GitHub writes deferred for the requested consolidated publication.
- Preserve loaded user pages and their unsaved data. Use an existing same-origin
  in-app link to open a fresh Wallet tab when an old automation tab is detached;
  do not reload a working page to repair the automation connection.
- Preserve the original 4231 and fixed-candidate 4232 server processes. Run new
  server-code checks separately. Verify downloads on disk, not only from the UI.
- Keep handoff marks current for unfinished agent-created pages; they last only
  for the current turn. Save file backups as well, since tab access can be lost.
- Handle browser event-wait promise rejection immediately, including filechooser
  and download waits, so a timeout cannot reset the control session. A download
  timeout is not proof of a missing file: check actual saved bytes before retrying.
- Do not spawn sub-agents unless the user explicitly authorizes delegation.
- Before reinstalling dependencies, inspect each `node_modules` path with lstat
  and realpath. Earlier token checkouts shared DAT's directory through junctions.
  Do not run npm ci against shared targets concurrently. Prepare independent
  directories first, verify any junction target before unlinking only the link,
  and check the installed dependency graph after installation.

Current review status starts at `docs/RELEASE_HANDOFF_2026-11-02.md`.
