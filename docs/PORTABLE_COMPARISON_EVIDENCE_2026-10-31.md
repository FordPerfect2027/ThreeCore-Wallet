# Portable paired-source comparison evidence: item 471

Source: `a96dfeb`.

471. A pending replacement comparison can now be saved together with both original report sets in one portable evidence file. The file contains two complete canonical set exports and the same comparison text produced by the existing comparison exporter. It is bounded to 24 MiB and fails rather than truncating. Canonical source payloads and their checksums are preserved; whitespace or property order from an earlier uploaded file is not retained as original upload bytes.

This bundle includes full public addresses, balances, history and notes from both sources. It uses a separate explicit full-source acknowledgement; the normal comparison acknowledgement and display shortening/note controls cannot authorize or redact this export. A new candidate clears that acknowledgement. Saving leaves the accepted source, pending candidate and local saved history unchanged.

An independent screen section verifies a saved bundle even before any set is displayed. It verifies both embedded source wrappers, recomputes the recorded comparison and hashes the decoded evidence text. It never applies either source to the current workspace. Its result is clearly separate from the displayed set and can be saved with its own acknowledgement. A failed follow-up retains the labelled last completed result; cancelled/disposed reads cannot publish late success. Verification receipts omit original note bodies, balances and event bodies. The text hash follows existing UTF-8 decoding, including removal of a leading BOM; it is not an unconditional raw-file hash.

Known bundles and their derived review receipts also participate in the saved-format destination guidance. A bundle points to its independent evidence verifier; its review receipt requests the original bundle. Inner checksum errors are rejected before a successful result. Valid originals with altered comparison conclusions produce a mismatch result instead of being accepted as faithful evidence. Matching establishes internal recomputation agreement only, not authorship, token safety or present chain state.

## Independent verification

`node scripts/verify-report-set-evidence.js evidence.json --json`

Only the evidence file is required. The command reproduces the screen review exactly and performs no network requests, imports or input writes. Exit 0 means the comparison matches, 2 means its conclusions differ, and 1 means invalid input/read failure with no partial stdout. A matching comparison can describe different original sets. The source files remain embedded for future independent verification.

## Validation

Initial model/controller comparison checks passed 29 cases (9,276.1486 ms). Focused evidence, CLI, panel and existing destination checks passed 58 cases (8,586.6625 ms). Additional regressions cover bundle/receipt destinations and a wrongly typed embedded file: its message must describe the bundle contents rather than direct the outer bundle to the inner file's screen. The final related run passed 2672 cases (88148.9789 ms), zero failed/skipped/cancelled. Native Chrome passed 881 UI cases using a synthetic provider and no external RPC. The new case reads a bundle with no displayed source, saves a verification receipt, verifies separate full-source export acknowledgement, retains the accepted source, clears acknowledgement for a different candidate, and checks the embedded-content error in the real DOM.

Five [captures](evidence/2026-10-31-portable-comparison-evidence/) cover a faithful changed-source comparison, identical sources, altered conclusions, reversed originals and a corrupt embedded checksum. The standalone one-file CLI exactly reproduces shared screen-review outputs or the same rejection code, and leaves the bundle unchanged. Evidence files, results/errors, logs and SHA-256 manifest are retained. Shared-helper captures run under Node; native file selection and captured download delivery are verified separately, without claiming the user's OS dialog or current browser connection. The latest full-wallet checkpoint remains 15,097 checks and 879 native cases at 5c0a5a5.

This entire portable evidence workflow counts as one item. No real signatures, transfers, approvals, secret retrieval, publication or deployment occurred. The user's existing server was not restarted.
