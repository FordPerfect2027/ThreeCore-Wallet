# Report history: contract and verification

## Scope

This module stores fixed three-token period-report inputs with local organization
metadata. It introduces no provider calls, signing, approval, transfer, RPC,
telemetry, remote storage, deployment, or GitHub synchronization.

The existing period library remains the source of acquisition checkpoints.
Report history captures copies of selected evidence, rather than references whose
meaning changes when an acquisition checkpoint is edited later.

## Data boundaries

The document schema is `threecore.report-history.v1`. Each entry contains exactly
`id`, `label`, `note`, `tags`, `savedAt`, `updatedAt`, `archived`, and `report`.
All objects are shape-checked and rebuilt through validators. Unknown properties,
accessors, sparse arrays, malformed IDs, invalid timestamps, and duplicate evidence
are rejected. Returned documents and nested evidence are immutable.

The document holds at most 12 entries and 64 MiB of canonical UTF-8 JSON.
Archived records count toward both limits. Labels are limited to 60 UTF-16 code
units, notes to 500, tags to six unique lowercase ASCII slugs of 24 characters.
Notes reject control characters and directional overrides; ordinary newlines and
tabs are permitted. The UI renders user-provided text with `textContent`.

Report identity is the canonical validated period-report input, including its
title and creation time. It is not an economic identity, transaction identity,
or a promise to deduplicate different presentations of equivalent evidence.

## Transactions and cancellation

`createReportHistoryStorage` supplies the history policy to the established
checkpoint storage adapter. The production namespace is
`threecore-report-history-v1`, separate from acquisition and transfer storage.
IndexedDB access starts only after an explicit operation.

Writes carry the expected revision and run inside one read/write transaction.
Concurrent stale writers fail instead of overwriting a newer document. Validation
finishes before `put`, and success is reported only after transaction completion.
Quota, transaction, blocked-open and version-change paths preserve existing data.
No-op edits and duplicate-only restores do not consume revisions.

Generation checks suppress stale async results. Save reviews capture both the
history revision and current source-report identity. The identity is checked
again before commit. Cancelled writes invalidate the controller's cached loaded
state. Cancellation is not advertised as rollback after a native commit.

Opening an entry rereads storage and compares the exact selected record before
staging it into the period-report controller. A separate application step in that
controller replaces the accepted display. Existing accepted reports survive
invalid inputs, cancelled reviews and failed restoration.

## Portable backup

The envelope schema is `threecore.report-history-file.v1`; it contains an
algorithm, lowercase SHA-256 digest, and validated document with revision zero.
The revision is local concurrency state and is deliberately not portable.
The digest covers canonical JSON after validation, not arbitrary source bytes.

Input is bounded to 96 MiB, with strict UTF-8 decoding, a bounded JSON filename,
exact declared byte length and required schema fields. Checksums detect accidental
changes; they do not authenticate a sender or encrypt public financial evidence.

Restore planning is additive and deterministic:

| Incoming condition | Behavior |
| --- | --- |
| Unseen ID and report | Add after review |
| Same report under any ID | Keep existing record and its metadata |
| Same ID, different report | Conflict; block by default |
| Explicit skip-conflicts choice | Omit conflicting incoming records only |
| Count or byte limit exceeded | Reject the planned operation |

There is no destructive replacement or permanent delete operation.
Selected-report JSON uses the existing period-report envelope and excludes
history-specific notes. Catalog CSV is filtered, formula-escaped, and is not a
backup format. Export rereads persisted records and rejects a changed selection.

## Source inspection

Source inspection reads the current acquisition library without modifying it.
It distinguishes exact matches, metadata changes, changed evidence, changed
requires-new-plan markers, missing IDs, and equivalent evidence under other IDs.
Multiple equivalent copies remain ambiguous. Candidates are never substituted.

Removing a restriction marker does not certify evidence. Historical report
conclusions remain derived from the original captured input. Inspection records
the acquisition-library revision and local inspection time, not a chain finality
or trusted timestamp assertion.

## Continuity

Continuity uses BigInt block numbers and token base units. It compares the same
token, chain, contract and wallet context. The acquisition intervals are `(a,b]`.
Results distinguish missing slots, changed context, identical periods, reverse
order, overlap, gaps, conflicting boundaries and incomplete evidence.

Adjacent periods qualify only when the shared boundary's block hash and balance
agree, both per-token reports have arithmetic agreement, and neither source is
restricted. Global continuity additionally requires both three-token reports to
have cross-token agreement. A changed boundary hash suppresses a numerical delta.
Events and quantities are never merged, deduplicated across periods or valued.

## UI and lifecycle

The main demo mounts the history panel immediately after the period-report panel.
Filters affect the catalog, not underlying records. A selected record filtered
out of the list remains explicitly selected rather than silently substituted.
All async work exposes a busy state. Controls invalidate obsolete reviews.
Disposal removes listeners, closes adapters and suppresses late results.

The synthetic preview uses separate history and source databases and a CSP with
`connect-src 'none'`. It is available only with the server's `--ui-test` option.
The ordinary server only serves an explicit asset allowlist. It rejects mutation
methods with the existing 404 policy and exposes no database or upload endpoint.

## Offline diagnostics

```sh
node scripts/check-report-history.js backup.json --json
node scripts/check-report-history.js backup.json --require-agreement
```

Exit code 0 means a valid file (and agreement if requested), 1 means invalid input
or a read failure, and 2 means a valid file failed the all-reports-agree condition.
An empty history does not satisfy strict agreement. Archived records are included.
Output includes counts, states and digest, but no notes, labels, addresses or
financial quantities. A successful check is not a security audit.

## Reproducing checks

```sh
node --test test/*.test.js
node --test integration/*-server.test.mjs
node examples/dev-server.js --ui-test
```

Open `/test/browser/` on the local test server for native browser checks.
The separate `integration/token-compatibility.test.mjs` requires execution inside
a compiled DAT, EMA-Draft or CAWELON-Draft repository with its pinned Hardhat
dependencies. It is not a wallet static-server test and is not run by the command
above. This change does not modify token contracts or wallet transaction code.

Verification covers schema boundaries, duplicate and conflict rules, quota and
transaction aborts, stale reviews, async cancellation, safe exports, corrupted
files, source changes, exact large quantities, temporal discontinuities and DOM
rendering. Native IndexedDB, downloaded JSON restore and reload persistence are
also checked in the in-app browser using isolated synthetic records.
