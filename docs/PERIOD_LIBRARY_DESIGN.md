# Saved historical period library

Status: local development. No GitHub publication is part of this change.

## Purpose

The period collector already supports a contiguous completed prefix and a single
working draft. This extension preserves multiple such drafts across browser
restarts without turning historical records into current balances.

A save captures one reviewed immutable draft. Subsequent acquisition creates a
new record; there is no operation that overwrites a saved draft's evidence.
Names and archive flags can change independently.

## Integration boundaries

- The existing collector owns acquisition, endpoint validation and resumption.
- The library owns named persistence, metadata queries and portable collections.
- The existing reconciliation screen owns arithmetic comparison.
- The wallet session remains the only source for live read-only chain calls.
- Restoring a library record stages a candidate in the collector.
- The collector still requires an explicit apply and explicit start.
- A known invalidated block checkpoint retains requiresNewPlan.
- Current working data is not automatically saved on unload.
- The transfer vault and workspace checkpoint databases remain separate.

The library does not call provider APIs, request accounts or dispatch transactions.
The CLI reads bounded files and performs no network or storage mutations.

## Modules

| Module | Responsibility |
| --- | --- |
| period-library-model.js | Canonical records, strict validation, atomic mutations |
| period-library-storage.js | Dedicated IndexedDB policy and namespace |
| period-library-file.js | Canonical portable envelope and SHA-256 |
| period-library-query.js | Metadata filters, ordering, summaries and CSV |
| period-library-view.js | Japanese presentation and safe error messages |
| period-library-controller.js | Reviewed operations, lifecycle and concurrency |
| period-library-panel.js | Accessible controls and text-only rendering |
| check-period-library.js | Bounded offline collection inspection |

## Storage document

The schema identifier is threecore.period-library.v1.
A document contains a nonnegative safe-integer revision and an entries array.
Each entry contains exactly:

- id: canonical lowercase version-4 UUID.
- label: trimmed, 1–60 characters, without control or bidi formatting characters.
- createdAt: canonical UTC ISO timestamp including milliseconds.
- updatedAt: canonical timestamp, not earlier than createdAt.
- archived: boolean.
- requiresNewPlan: boolean.
- draft: fully validated historical period draft.

Unknown keys, accessors, decorated arrays and duplicate IDs are rejected.
A record requiring a new plan must contain some acquired evidence.
The collection is limited to 12 records and 48 MiB of canonical UTF-8 JSON.
Archived entries count toward both limits.

Validation detaches and freezes accepted input.
The caller cannot modify a returned document through the original input object.
Canonical field order also defines portable digest input.

## Mutations

Every write requires the last observed revision.
IndexedDB reads and conditionally writes inside one readwrite transaction.
Success is reported only after the transaction completes.

Supported operations are save, import, rename, archive and purge.
A mutation increments the revision exactly once.
A true no-op does not increment it.
Revision exhaustion rejects a change but permits a no-op.

Save rejects an existing ID and an already saved identical draft with the same
restriction marker. A changed acquisition prefix receives a new ID.
No old record is evicted automatically when capacity is reached.

Import preserves all incoming IDs, timestamps, archive flags and restriction
markers. An exact existing ID/content pair is idempotent. A conflicting pair
rejects the entire operation. Content-equivalent records with different IDs may
coexist after import because they can represent independently named backups.
Their metadata and amounts are never automatically merged.

Rename and archive preserve acquired evidence and creation time.
A clock rollback before the previous updatedAt is refused.
Purge requires an archived entry and acknowledged === true.

## IndexedDB lifecycle

The namespace is threecore-period-library-v1.
The generic committed-transaction adapter provides the database implementation.
Opening the component does not open IndexedDB.
Only an explicit library operation opens it.

The adapter preserves schema, blocked, timeout, quota, cancellation and
transaction errors. Corrupt stored data is rejected rather than reset.
Version changes close the old connection.
Disposal aborts pending transactions and closes the adapter.

The controller uses a generation token and an AbortController per operation.
Late reads, parsing, digests and callbacks cannot update a cancelled/disposed UI.
A write failure or cancelled write invalidates the cached loaded flag.
The user must refresh before another write.
A commit may win a race with cancellation; refresh is the source of truth.

A restore rereads storage and verifies the selected entry still matches the
reviewed content. Unrelated changes may be adopted; a change to that entry
requires another review.

A save also checks the currently reviewed source key before starting the write.
The stored value is the reviewed snapshot, not a later mutable working object.

## Portable collections

The envelope schema is threecore.period-library-file.v1.
Fields are schema, algorithm, digest and document.
The supported algorithm is SHA-256 with a lowercase 64-character hex digest.
Portable document revision is always zero.

The digest covers the canonical validated document, not arbitrary JSON whitespace.
Compact JSON avoids multiplying the size of event arrays through indentation.
An empty collection is a valid backup.
The file input limit is 64 MiB.

Before decoding, file input validates the name, declared size, returned byte count
and fatal UTF-8 decoding. JSON must then satisfy both envelope and document schema.

The digest is a corruption check, not a signature or origin proof.
An attacker can recompute it after changing a document.
The decoder therefore returns authenticated: false.
No encryption is provided.

## Queries and exports

Queries operate on validated metadata.
Supported filters are token, archive state, acquisition state and bounded text.
Text search covers label, record ID, token, public account, chain and block bounds.
Sorting supports updated time, name and completed-step ratio.
Record IDs provide a stable tie-breaker.

The token summary counts records, not unique transactions.
Account/chain contexts are counted separately.
Balances from different saved records are never added.

CSV includes public account and record metadata, but no balance amounts.
It uses current filters, quotes all fields, doubles embedded quotes and prefixes
spreadsheet formula-leading characters with an apostrophe.
CSV is an index, not a restore format.
Its event count describes that record and is not deduplicated across records.

Full JSON export includes archived records.
Single-entry export uses the same envelope with one record.
Export performs a fresh committed read and clears any older pending review.
File delivery is synchronous; rejected asynchronous callbacks are drained.

## Offline inspection

Run:

    npm run period-library:check -- saved-library.json --json

Optional strict acquisition check:

    npm run period-library:check -- saved-library.json --require-complete

Exit codes:

- 0: valid file, and the optional collection-completeness condition passed.
- 1: invalid arguments, read failure, invalid format or checksum failure.
- 2: valid file that fails the optional completeness condition.

An empty collection fails --require-complete.
Archived partial or blocked records are included in that check.
A complete collection still does not prove complete blockchain history.

Output omits user labels, public accounts, balance amounts and counterparties.
It reports per-token counts, the digest and explicit verification limitations.
The reader rejects a file whose length changes during inspection.

## Verification strategy

Unit tests cover strict schema boundaries, immutable snapshots, capacity,
optimistic revisions, clock rollback, atomic imports and metadata-only changes.
They cover stale reviews, failed storage, cancelled work, asynchronous callbacks,
disposal and absent current data.

Collector/library workflow tests exercise every completed prefix for all three
tokens on Base and Base Sepolia using deterministic sessions.
Resuming preserves original endpoint provenance and rechecks block anchors.
Reorg tests preserve the original saved draft and retain its restriction marker
through export, import and reopening.

Browser tests use native IndexedDB in unique test-only database names.
They cover reopen persistence, transaction concurrency, malformed-data retention,
abort behavior, reviewed save/import, filtering, text-only rendering and handoff.
Cleanup removes only the database generated by that test.
The native raw-read corruption test waits for transaction completion before
closing and removing its database.

The isolated preview uses threecore-demo-period-library-v1.
It visibly labels all balances and histories as synthetic.
Its Content Security Policy disallows connect-src, form-action and object-src.
The normal demo uses the production library namespace for that local origin.

The server exposes only explicit allowlisted module paths.
Test fixtures require --ui-test.
Backup files, repository metadata and CLI scripts are not served.
Non-GET requests cannot mutate local files through this server.

## Scope limits

This change does not establish an independent security audit.
It does not test a real wallet or real asset transfer.
No deployed token contract is changed.
No wallet signing or transaction API is added.
The library is origin-scoped browser storage, not an encrypted backup service.
Browser data removal can erase it; portable JSON remains necessary.
