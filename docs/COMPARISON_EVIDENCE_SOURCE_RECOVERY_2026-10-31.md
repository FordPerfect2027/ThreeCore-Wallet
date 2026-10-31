# Recover originals from verified comparison evidence: item 472

Source: `48a804e`.

472. After independently verifying a portable comparison bundle, the user can recover either the before or candidate original set as a reloadable JSON file. Recovery returns the exact text embedded in the reviewed bundle, including its whitespace; it does not regenerate or merge the source. Both embedded checksums and the comparison are checked before recovery becomes available. A private association binds a completed review object to its verified originals; serialized/cloned/forged/proxy receipts cannot obtain source text. The review receipt itself still omits original note, balance and event bodies.

The screen requires choosing an original and explicitly acknowledging its full unencrypted addresses, balances, history and notes. Choosing a different side or completing another review resets the acknowledgement. Saving the receipt or generic set does not authorize this source export. Recovery does not import or replace the displayed set, alter a pending candidate, read or write saved history, or make a provider call. A failed later bundle retains the labelled last completed review and its recoverable originals. Cancel/dispose during the export announcement suppresses delivery.

A valid original can be recovered when the comparison is inconsistent. That does not turn the recorded comparison into a match: the screen keeps the mismatch and file-delivery metadata includes it. Corruption on either side refuses the entire bundle, including when the corrupt side was not selected. Suggested filenames are fixed before/after names, never taken from untrusted labels.

## Offline recovery

`node scripts/recover-report-set-source.js evidence.json --source before`

Use `after` for the candidate. The command emits full original JSON on stdout and performs no input writes, imports or network requests. Exit 0 means recovered with a matching comparison; exit 2 still emits the verified original but reports the comparison mismatch on stderr. Exit 1 rejects invalid input without original stdout. It does not certify authenticity or current chain state. A deliberate local redirection can save the output; a shell's choice of encoding/newlines is outside this command's exact stdout-byte guarantee.

## Validation

58 focused checks passed in 12,381.2179 ms. The related run passed 2683 checks (87184.2641 ms), zero failed/skipped/cancelled. Native Chrome passed 882 UI cases with synthetic data and no external RPC. The new native case selects both originals, captures their exact file text, checks separate disclosure/reset behavior, preserves the displayed source and verifies that an altered comparison remains visibly inconsistent after recovery.

Six [captured recovery attempts](evidence/2026-10-31-comparison-evidence-source-recovery/) cover both matching originals, both originals with an altered comparison, preserved embedded whitespace, and corruption on the unselected side. The standalone CLI agrees exactly with shared screen recovery and decoded recovered sources remain valid. Bundles remain unchanged. Logs, original/recovered synthetic files, mismatch/rejection output and SHA-256 manifest are retained. Native download callbacks are captured without claiming the user's OS dialog or current browser connection. Latest full-wallet checkpoint remains 15,097 checks and 879 native cases at 5c0a5a5.

This complete recovery workflow counts as one item, including CLI and tests. No real signatures, transfers, approvals, secret retrieval, publication or deployment occurred; the user's existing server was not restarted.
