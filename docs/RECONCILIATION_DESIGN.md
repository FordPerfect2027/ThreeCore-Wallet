# Historical balance reconciliation

This local feature compares two saved token observations against saved ERC-20
Transfer records. It has no provider, wallet-connection, signing, approval,
transaction submission, network-fetch, or browser database dependency.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `reconciliation-model` | Fixed slots, validation, immutable replacement reviews |
| `reconciliation-engine` | Exact interval, coverage, event accounting, diagnostic status |
| `reconciliation-file` | Checksummed workspace file and existing-format adapters |
| `reconciliation-controller` | Explicit apply/cancel, async ownership, undo/redo, exports |
| `reconciliation-query` | Bounded event pagination and manual gap-read suggestions |
| `reconciliation-ledger` | Per-block summaries and links back to source periods |
| `reconciliation-view` | Japanese explanations and inert text/CSV output |
| `examples/reconciliation-panel` | DOM controls and synchronous download initiation |

The normal demo reads the existing identity state map and each transfer panel's
archive export. It copies evidence into the new draft only after user review.
The original cards and transfer vault are not mutated by reconciliation actions.

## Evidence model

Workspace schema: `threecore.reconciliation-workspace.v1`.

The slots are exactly DAT, EMA, CAWELON in that order. Each contains `earlier`,
`later`, and `archive`, with explicit `null` for absent data. The envelope also
requires `readOnly: true` and `independentlyVerified: false`.

Existing token observation and transfer archive validators remain authoritative
for their respective nested formats. Unexpected envelope fields are rejected.
Derived reports cannot be loaded as authoritative results.

Partial workspaces can be saved. Valid evidence with incompatible accounts or
chains can also be retained, so the user can inspect the problem without losing
the source data. Such slots have no computed monetary totals.

Addresses and hashes are normalized by the existing validators. Amounts remain
canonical decimal strings. No monetary computation converts a value to Number.

## Comparison interval

Balances represent end-of-block observations. For observations at A and B, the
event interval is `(A, B]`: events in block A are excluded; events in B are included.

Requirements for a comparable pair:

- Same token slot, account, chain, and contract address.
- A is not later than B.
- Both observations match the registered token metadata and supply checks.
- Same-number observations agree on hash and state fields.
- Archive context matches the observation context.
- Any available archive anchors at the endpoint blocks agree with observations.

Different site origins or connection epochs are preserved and disclosed as
warnings. They do not change token identity. In particular, a user can compare
historical files created on different local development ports.
This behavior is intentionally distinct from the older same-origin identity
comparison feature; no existing identity comparison rule has been weakened.

Missing endpoint anchors are `unchecked`, never treated as an actual hash match.
Matching hashes only establish consistency among supplied records.

## Coverage and event accounting

Archive ranges are clipped to the comparison interval, sorted, and merged.
Adjacent and overlapping ranges form one union. Exact gaps and covered-block
counts are derived from this union with BigInt arithmetic.

The algorithm iterates over at most twelve ranges, not block numbers. A uint256
span is supported without allocating an array with one entry per block.

The archive validator requires consistent overlap events, block hashes and log
identities. The engine then counts each transaction-hash/log-index identity once.
Included events remain in block/transaction/log order.

For every included event:

```
received = amount if to == account, otherwise 0
sent = amount if from == account, otherwise 0
delta = received - sent
implied balance = earlier balance + cumulative delta
residual = later balance - earlier balance - sum(delta)
```

Self-transfers appear in both received and sent totals; net is zero. Mint, burn,
and zero-value events remain visible. Event and transaction counts are separate.
Outside-interval events are excluded, with their count disclosed.

Intermediate negative balances, balances above registered initial issuance, and
self-transfers exceeding the inferred available balance are reported as
inconsistent history. These checks concern supplied ERC-20 records, not an
independent reconstruction of chain state.

Status priority is missing observations, incompatible evidence, incomplete
coverage, inconsistent intermediate accounting, then agreement or residual.
Incomplete coverage cannot be upgraded by a zero residual.

All sums and differences are BigInt. The formatter allows signed totals wider
than uint256 because many valid uint256 event values can be accumulated.
Formatting does not use exponential notation or floating-point rounding.

## Reports and source trace

Reports are recalculated from evidence. They retain explicit false provenance,
complete-history, profit-proof and security-audit claims.

The block ledger groups included events by block and reports opening/closing
inferred balances, mint/burn totals, and the number of earlier gap intervals.
It never calls these inferred values independently observed balances.

Each counted event can be traced to one or more archive period IDs. Multiple
source periods do not imply multiple counted transfers. Source reports retain
the original endpoint hashes, acquisition origins, and connection epochs.

The UI shows at most 25 events per page and at most 25 block summaries at once.
Complete event and block output is available through CSV. Querying the display
does not alter the underlying report or restrict an export.

## File integrity and recovery

File schema: `threecore.reconciliation-file.v1`.

An envelope contains `schema`, `algorithm`, lowercase hexadecimal `digest`, and
the validated `workspace`. SHA-256 covers compact canonical workspace JSON.
The export itself is pretty-printed UTF-8 JSON with a trailing newline.

Checksum consistency does not establish authorship, origin, or truthful data.
An attacker can create a different valid workspace and compute its checksum.

Imports validate filename, advertised size, actual buffer length, UTF-8, JSON,
exact schema, nested evidence, and digest before producing a review candidate.
Legacy file imports retain their original schema and checksum validation.

Canonical workspace limit: 16 MiB. Formatted workspace-file limit: 24 MiB.
Existing per-observation, archive, and vault file limits continue to apply.

JSON is the restoration format. Text and CSV are report artifacts. CSV values
are quoted and formula-leading values are neutralized with an apostrophe.
Consumers should import large integer columns as text to avoid spreadsheet
rounding. Values in JSON are the machine-precision source of truth.

## Controller ownership and cancellation

The controller owns a working draft, revision number, selected agent, current
review, calculated report, and monotonically increasing operation generation.

Each review binds the entire previous workspace key and revision. Card captures
also bind a source epoch. Changing cards invalidates card-derived reviews.
Changing selected token cancels an in-flight import or export preparation.

Import completion checks operation ownership before publishing a review.
Cancellation, disposal, or a newer operation causes stale completion and stale
failure to be ignored. A failed new capture discards an older actionable review.

Replacement and removal require a strict boolean acknowledgement. Additions do
not require an extra checkbox. Applying a change invalidates calculated results.
Exporting results requires an up-to-date explicit calculation.

Download initiation is synchronous after asynchronous file preparation. The
controller checks operation ownership immediately before delivery. UI messages
say that downloading started, not that a file is certainly present on disk.

Undo and redo retain immutable workspaces. Each stack is bounded to eight states
and 32 MiB. They are local memory only. There is no automatic persistent write.

## CLI

```
npm run reconciliation:check -- saved.json
npm run reconciliation:check -- saved.json --json
npm run reconciliation:check -- saved.json --json --require-agreement
```

The CLI uses bounded read-only file access and the same decoder and engine.
Exit 0 means a valid file, 1 means invalid input/read failure, and 2 means strict
mode found a slot without arithmetic agreement. Strict mode requires all three
slots. None of these exits indicates independent security or chain verification.

## Test coverage

- Fixed slots, schema variants, immutable copies, review replacement semantics.
- Earlier-exclusive/later-inclusive boundary regression expressed as `(A, B]`.
- Independent small-range set oracle for coverage unions and gaps.
- Seeded transfer conservation oracle across all tokens and both supported chains.
- Overlapping source deduplication and partition-invariant totals.
- Maximum 6,000-event archive, exact signed arithmetic and bounded pagination.
- Context, endpoint hash, metadata, negative balance and issuance contradictions.
- File tampering, invalid UTF-8, size limits, wrong legacy format and crypto errors.
- Async import/export cancellation, stale completion, selection and disposal races.
- Undo/redo state-machine comparison with a separate history model.
- Native browser File input, save/restore, filters, all three wallet-card bridges.
- HTTP allowlist, MIME/cache headers, test-only fixture isolation and local imports.
- Standalone CLI exit codes and source-file immutability.

All automated scenarios use synthetic data. The preview's CSP prohibits network
connections. No private key, seed phrase, real transfer, signature, or approval
is required by the tests.

## Protocol references

- [ERC-20](https://eips.ethereum.org/EIPS/eip-20): balance observations and Transfer events.
- [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898): block-hash-based state queries used by the existing reader.

An event list is not an authenticated replacement for chain state. Agreement
between records is deliberately presented as arithmetic agreement only.
