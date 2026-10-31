# Extract exact named source files from verified batch evidence

Item 556. Source: f9856c3.

Both existing offline batch-evidence commands now accept `extract bundle.json exact-name.json`. They first recompute and verify the entire bundle, then write only the exact named original text to standard output. Names are case-sensitive; callers cannot supply destination paths. Corresponding owned-review APIs expose the source hash and original inspection status. A faithfully recorded negative/invalid source remains negative when extracted; extraction neither validates it nor imports its contents.

27 selected Node checks passed (7257.9064 ms), and the full native browser suite passed 965 cases across two isolated shards. Extraction tests and actual command captures check Unicode, BOM and CRLF bytes, exact source hashes, missing/case-changed names, altered receipts with no extracted output, forged review objects and unchanged input files. The [evidence](evidence/2026-11-01-batch-evidence-extraction/) retains source bundles, exact extracted originals and negative inputs, altered controls and command outcomes. This is one extraction capability across two related formats, not one item per command or test.

The full browser checkpoint is f9856c3 (965 cases, synthetic provider); the last full-wallet Node checkpoint remains d253e8d (15,720 tests). These checks do not confirm the user's browser connection or real file-picker interaction. No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or restart of the existing server occurred.
