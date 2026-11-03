# Explain the destination of saved report-workflow files: item 470

Source: `7d12bf3`.

470. Selecting a recognized saved artifact in the wrong report-workflow input now explains where to use it. Period drafts, three-token period reports and report sets identify their existing screen and file section. Check-detail files point to source-based check review; comparison files explain that both the accepted original and candidate must be present first. Check/comparison verification receipts, coverage explanations and missing-range proposals identify which original inputs are needed instead of suggesting that those derived files can restore evidence.

The five readers are the existing period, report and set decoders plus the check/comparison reviewers. Their existing size bounds and strict security JSON parsing run before inspecting a known schema declaration. A mismatched known declaration returns a fixed, bounded hint code. The hint only identifies the declared format; it does not assert valid contents, authenticate a source, automatically open another panel, change evidence or start a provider request. Correctly targeted files continue through their full original shape, content, digest and recomputation checks. Unknown, malformed, duplicate-key and unsafe JSON retain their ordinary errors rather than receiving a guessed route.

Messages are static application text resolved from known codes. Arbitrary schema names, file paths, private values and exception prose are not copied into them. Period/report/set views share the new destination messages through their established error-handling paths. A wrong file leaves the accepted input unchanged and cannot enable an apply action.

## Validation

Focused decoder, guidance, comparison-review and panel checks: 196 passed (13,232.607 ms). Final related period, report-set/history, check-review, file-read, rehearsal routing and local-file checks: 2656 passed (85939.0926 ms), with zero failures, skips or cancellations. Native Chrome passed 880 cases using a synthetic provider and no external RPC. The new actual-DOM file-selection case checks a period draft, coverage explanation and saved comparison selected in the set input, their destination guidance, disabled application and unchanged accepted evidence. No user's OS dialog or current tab reconnection is claimed.

The [capture matrix](evidence/2026-10-31-wallet-saved-file-guidance/routing-capture.json) covers nine emitted formats across five readers: 45 routing observations. Five supported inputs pass their correct complete decoder/reviewer; wrong destinations and explanation-only artifacts return their designated guidance. Actual synthetic source/derived files, static messages, validation logs and SHA-256 manifest are retained. These matrix captures use shared decoders under Node, separate from the native UI checks. The latest full-wallet checkpoint remains 15,097 cases and 879 native cases at 5c0a5a5.

This end-to-end destination-guidance change counts as one development item. Test rows, routing combinations and reruns do not increase that count. No real signing, transfers, approvals, secrets, publication or deployment occurred; the existing user server was not restarted.
