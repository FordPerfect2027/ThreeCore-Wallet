# Native SHA-256 response validation for saved evidence

Continuation items **263–268**, source `7c476d8`.

263. Capture each digest callback once, preserve its receiver, contain callback/accessor failures, and validate a genuine 32-byte ArrayBuffer using its intrinsic length. Shadowed length fields, array-like objects, typed arrays, shared and detached buffers cannot substitute for a WebCrypto result. Genuine cross-realm buffers remain supported.
264. Apply the shared boundary to single-token transfer files, archives, vault working copies and vault collections, preserving unavailable/failed diagnostic distinctions.
265. Apply the same check to period checkpoints, libraries, period reports, report histories, report sets and reconciliation files, retaining their existing input-size checks and canonical JSON.
266. Reject coercible fake digest outputs in workspace backups and checkpoint collections, while retaining existing restore validation and checksums.
267. Use the shared check for identity observations and read-only allowance files/bundles. No approval or transaction functionality is added.
268. Use the same strict digest result in rehearsal report-review receipts. Recomputed agreement and an unkeyed checksum remain separate from source authenticity.

The corrected pre-fix format run had **48 failures and 16 passes across 64 tests**. The first attempt used an empty vault collection, which the format correctly rejects before hashing; its four fixture failures are preserved separately, and the fixture was changed to one synthetic saved entry before the corrected pre-fix run. The final focused run passed **77 tests**. An initial related run passed **839 tests**; the final integration run passed **894 tests**, including HTTP import-graph checks and existing encrypted-backup compatibility tests, with zero failures, cancellations or skips (40413.8707 ms).

The helper lives in the already-served `security-data.js` module. Three read-only requests to the existing localhost port 4231 confirmed HTTP 200 and exact equality with the saved source for that module, transfer-file, and rehearsal report review. This is an HTTP/source check, not a new browser interaction check. No server restart or new route was needed.

Evidence: [initial fixture attempt](evidence/2026-10-31-public-checksum-boundary/before-formats-fixture.log), [corrected pre-fix format run](evidence/2026-10-31-public-checksum-boundary/before-formats.log), [focused](evidence/2026-10-31-public-checksum-boundary/fixed.log), [related](evidence/2026-10-31-public-checksum-boundary/related.log), [final integration](evidence/2026-10-31-public-checksum-boundary/integration.log), [existing server responses](evidence/2026-10-31-public-checksum-boundary/live-server.log), [SHA-256](evidence/2026-10-31-public-checksum-boundary/SHA256SUMS.txt).

The crypto implementation remains a trusted dependency: a correctly shaped output does not establish that an adapter computed the correct digest. These checks do not introduce cancellation or a timeout for hashing; that remains a separate lifecycle concern. The preceding 13,304-test full run covers source `48eb566` through item 260. All work here is local and uses synthetic evidence, with no wallet signing, transactions, approvals, key retrieval, publication or deployment.
