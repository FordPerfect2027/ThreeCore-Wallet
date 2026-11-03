# Independently verify saved batch-evidence review receipts

Item 559. Source: 8a99a02.

Wallet and rehearsal batch bundles now accept their separately saved review receipt for comparison against a fresh owned bundle review. Every known field and the exact bundle hash are compared; unexpected fields are counted without echoing untrusted names or values. Inputs are bounded to 256 KiB, cancellation and hash deadlines are observed, and copied/unowned review objects cannot authorize a check. A faithfully recorded negative result can pass the receipt comparison while retaining its negative evidence status. No source extraction or history restoration is authorized by a receipt check.

Both offline commands support `verify-receipt evidence.json receipt.json`, returning JSON and exit 0 for faithful receipts, 2 for changed claims and 1 for invalid inputs. Both browser panels expose the same check, with separate cancellation and per-save acknowledgement. Source replacement clears stale checks. The existing comparison-bundle receipt control remains covered after its encoder/text presentation became configurable. New check receipts are recognized as auxiliary metadata by the file guide.

28 selected checks passed (9419.5012 ms), 66 integration checks passed (6254.027 ms), and 119 scoped native browser cases passed (26874 ms). Eight actual offline command captures match the API output exactly across both formats, faithful positive/negative evidence and altered receipt claims. Tests also cover wrong bundle hashes, every known field, unknown values, limits, timeouts, cancellation, invalid UTF-8, unchanged files and UI invalidation. [Evidence and logs](evidence/2026-11-01-batch-evidence-receipts/).

Last full browser checkpoint: f9856c3 (965 cases). Last full-wallet Node checkpoint: d253e8d (15,720 tests). Native checks use synthetic files/download capture, not the user's tab or OS picker. No signature, transfer, approval, private-key retrieval, external RPC, publication, deployment or existing-server restart occurred. This is one receipt-verification capability across two related formats.
