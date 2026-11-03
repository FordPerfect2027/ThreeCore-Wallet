# Consistent strict text decoding

Continuation item **185**: the older offline rehearsal reader now preserves a UTF-8 BOM for the existing strict JSON parser to reject, matching browser input and the newer shared offline reader. Previously the decoder silently removed this prefix, so the same file could fail in the browser but succeed in five older offline command modes.

The change covers the single-ledger and workspace checks, workspace comparison, condition comparison and workspace overview. A checksum match does not make invalid-format input valid. Valid CRLF input still hashes the exact original bytes, and no partial report is printed after a rejected input.

**49 related tests passed**, including nine new cross-reader/command regressions. [Log](evidence/2026-10-30-cli-encoding/related.log). No network, wallet, signature or transfer operation was used. The test count is not an additional development-item count.

Source: 38208945f7081f948d06fbb7aae8624bb17bc472.
