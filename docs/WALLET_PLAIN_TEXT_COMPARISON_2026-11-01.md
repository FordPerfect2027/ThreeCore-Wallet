# Compare exact source text without claiming an internal checksum

Item 534. Source: bfd1396.

The single-file guide and local comparison CLI now compare the exact UTF-8 source hashes of freshly inspected plain configuration, portfolio/history and rehearsal files. Identical selected texts report a source-text match. Changes, including whitespace-only differences, report a difference without assuming a semantic change. A plain/checksummed mixed pair can also report text equality/difference. Auxiliary declarations with no validated source hash cannot gain this comparison, and uploaded inspection claims cannot substitute for owned fresh inspections.

Original-evidence semantics remain separate: kind stays unverified, sameOriginal and the legacy sameText field remain null for these pairs, and authentication/authorization remain false. A V2 comparison adds an explicit sourceTextComparison object. Existing checksummed-original comparisons keep their byte-compatible V1 shape. The existing compareWalletSavedInspections API stays unchanged; compareWalletSavedTextInspections enables the additional scope in the shared panel and CLI. Original-only evidence bundles still refuse structure-only sources.

Saved V2 comparison review regenerates the result from both selected sources, binds their exact text digests and rejects altered conclusions or bindings. Review output distinguishes text binding from original-checksum binding. Old V1 comparisons and reviews remain reproducible with their original semantics. The comparison command still exits 2 for an unverified original pair even when exact text matches; the verify command exits 0 when the supplied comparison is faithfully reproduced, not when the originals are authenticated or identical.

12 focused tests passed (1308.486 ms); 1002 related checks passed (38847.4055 ms), with zero failures/skips/cancellations. The scoped native Chrome file-read run passed 101 cases in 21867 ms, including exact-text comparison, comparison export, V2 recheck and altered-conclusion rejection. This is not a full browser run. The last full browser checkpoint remains ef8f1a0 (947 cases); last full-wallet checkpoint remains d253e8d (15,720 tests).

[Evidence](evidence/2026-11-01-wallet-plain-text-comparison/) preserves synthetic original/identical/reformatted sources, actual CLI comparisons and reviews, an intentionally altered comparison, old V1 compatibility and byte-identical shared-panel output. No address, balance or note values appear in comparison summaries. Hashes are checked against committed Git blobs. One comparison capability counts as one item, not one per format or test.

No signature, transfer, approval, key access, external RPC, publication, deployment, existing-server restart or user-tab/picker verification occurred. Counts are not mainnet-readiness percentages.
