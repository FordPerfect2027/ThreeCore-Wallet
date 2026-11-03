# Local transfer-archive retention checks

Base revision: `7e4a86b47905420b66106da9fb09b75f60f562a8`, plus the changes in
the local commit containing this directory. No GitHub push or remote CI run was
requested for this continuation.

- `focused.log`: exit 0; 540 passes, no failures, cancellations or skips.
  Command: `node --test test/transfer-archive*.test.js test/transfer-panel*.test.js test/transfer-vault*.test.js test/export-checksum-cancellation.test.js test/history-file-cancellation.test.js`
- `full.log`: exit 0; 16,438 passes, no failures, cancellations or skips;
  reported duration 629,052.8678 ms. Includes the focused tests; do not add their
  counts as distinct features or a completion percentage.
  Command: `node --test --test-concurrency=2 test/*.test.js integration/*-server.test.mjs integration/local-navigation-help.test.mjs`
- `browser-first-run.log`: exit 1. Both isolated profiles reported completed
  results (509 and 508 passing cases), but shutdown of the second owned test
  browser exceeded its deadline. The runner correctly failed and preserved its
  temporary profile. A subsequent process inventory found no Chrome/Edge process
  carrying that exact temporary profile path. This is not a clean successful run.
  Command: `node scripts/test-browser-ui.js`
- `browser-retry.log`: exit 0; 1,017 passing cases (509 and 508), with both
  temporary browsers stopped and profiles cleaned normally. This run occurred
  after the full Node regression had finished; it used the same source changes.
  Command: `node scripts/test-browser-ui.js`
- `server-source.json`: the existing port 4231 server returned exact current
  bytes for all three modified application modules, with no-store headers.
  This read-only source check did not restart the server, read or modify the
  user's browser state, or request external RPC. It does not prove that an
  already-open tab has loaded the new revision.

The original output files are retained without editing their test-result lines.
These automated runs use synthetic fixtures and isolated loopback servers.
Private account-file probes and screenshots are not included here. Intended-PC
post-fix acceptance is still unverified because the UI tool stopped when it
could not establish the current browser URL. See
[the change record](../../TRANSFER_ARCHIVE_RETENTION_2026-11-01.md).
