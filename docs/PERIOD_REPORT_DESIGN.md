# Historical three-token report design

This local extension consumes the saved period library and the existing exact
balance/history reconciliation engine. It adds an explicitly selected report,
portable evidence, a printable summary, and comparison before report replacement.

## Ownership and boundaries

- The collector owns RPC acquisition and live block-anchor rechecks.
- The library owns immutable named checkpoints and IndexedDB writes.
- The report controller only reads the library; it has no change method requirement.
- The report input is a detached snapshot of selected original records.
- The reconciliation engine owns exact integer arithmetic and history diagnostics.
- The report comparison describes evidence revisions, not asset returns.

Opening the report panel does not open IndexedDB or connect a wallet.
Selection does not perform RPC calls. Applying an imported report does not write
to the library. No signing, approval, transaction or bridge methods are introduced.

## Input format

The input schema is `threecore.period-report-input.v1`.
It contains exactly schema, title, createdAt, slots, historicalOnly and
independentlyVerified. The latter flags must be true and false respectively.

The title uses the existing 1–60 character label policy. The timestamp is a
canonical UTC ISO time with milliseconds; it is a locally supplied report time,
not an authenticated timestamp or chain timestamp.

Slots are an ordinary dense array of exactly three records in DAT, EMA, CAWELON
order. Each slot contains only agent and entry. Entry may be null. At least one
slot must be selected. Each nonnull entry is validated by the period-library
validator and must belong to that slot's agent. Record IDs cannot repeat.

The canonical input is limited to 48 MiB. Nested period and transfer limits
continue to apply. Accepted data is detached and frozen. Unknown keys and
accessor properties are rejected by existing strict shape validation.

## Analysis

Each selected draft becomes one reconciliation slot using all its completed
records. Partial prefixes are allowed as evidence, but are never described as
complete acquisition. A missing observation remains unknown rather than zero.

The original engine supplies exact observed delta, transfer net, residual,
coverage diagnostics and the included event sequence. The report layer adds:

- Selection completeness across the three agents.
- Same-chain and same-endpoint checks.
- Hash consistency across shared block numbers on the same chain.
- Preservation of the requiresNewPlan restriction.
- Visible archived-record and shared-account warnings.

Hash comparison includes endpoint observations, queried window boundaries and
event block hashes. Different chains never share an anchor namespace. A conflict
marks every participating slot; a zero arithmetic residual cannot override it.

Whole-report arithmetic agreement requires all three selected inputs, the same
chain and endpoints, complete acquisition, no restrictive issue, and agreement
for every token. Differing window sizes are allowed because the economic interval
is still (A, B]. Shared accounts and archived entries are visible warnings.

No balances across different tokens are added. EventCount is the sum of per-token
event counts, not a count of unique transactions across the entire blockchain.
All reports retain historicalOnly and false values for liveChainRechecked,
completeHistory, securityAudit, independentlyVerified and provesProfit.

## Source concurrency

A library report is first prepared from the cached list. Applying it performs a
fresh committed read and compares every selected entry's canonical content.
Renames, archive changes, restriction changes, evidence changes and deletion of a
selected entry invalidate the review. Unrelated records or revision changes do
not. No compare-and-swap write is needed because the report never writes.

After acceptance, the report intentionally represents that snapshot. Subsequent
changes to the library do not mutate it. Refreshing explicitly clears the report
and reloads available selections. File export uses accepted input, not an
unreviewed current library value.

## Asynchronous lifecycle

Loading, importing, checking and exporting are mutually exclusive phases.
Generation guards suppress late results after cancellation or disposal. A
cancelled checksum never initiates a download. Observer failures are isolated.
Disposal closes only the report's own adapter; the main library has a separate
connection to the same database name.

File import does not require a loaded or available IndexedDB database. It stages
a review and preserves any accepted report until explicit application. Import
failure does not erase the accepted snapshot. Export clears an older pending
review and can only deliver the currently accepted input.

Download initiation must be synchronous. An asynchronous delivery callback is
drained and rejected as a delivery failure; it cannot later report success.
The UI accurately says download was initiated rather than proving the user has
retained the file on disk.

## Portable JSON

The envelope schema is `threecore.period-report-file.v1` with exactly schema,
algorithm, digest and input. SHA-256 covers canonical validated input, independent
of JSON whitespace and key order. Conclusions are not serialized as trusted data.
Opening a report validates its evidence and recalculates results.

The reader checks filename, declared byte count, actual ArrayBuffer size, fatal
UTF-8 decoding, bounded JSON, schema and checksum. Input is limited to 64 MiB.
The checksum detects corruption; it is neither a signature nor source
authentication. A malicious author can recompute it. Files are not encrypted.

## Summary exports

CSV always contains exactly three rows, with explicit missing statuses and blank
unknown amounts. Values are exact base-unit strings. All cells are quoted;
embedded quotes are doubled. Formula-leading cells, including negative values,
receive an apostrophe. Spreadsheet applications may still round positive large
integers if a user converts the text to numeric cells.

HTML is standalone and scriptless, escapes every user-authored title and label,
and includes print styles, provenance and limitations. Its CSP disables external
loads, connections, form actions and base URLs. HTML and CSV are summaries, not
restorable backups. The original JSON is the recovery format.

All formats contain public addresses and historical financial records. Export
requires an explicit checkbox acknowledging those contents. The checkbox resets
when the accepted input changes. There is no implicit upload or external sharing.

## Event query

The event table is token-specific with exact direction filtering and bounded
literal search over addresses, transaction hashes and block numbers. It uses
25-row pages. Oversized pages clamp to the last page. Empty results remain page
one of one. Search does not evaluate regular expressions or alter full-report
totals. Neither the CSV nor JSON export is silently narrowed by table filters.

## Replacement comparison

When an accepted report exists, preparing or importing a candidate also creates
a comparison. It distinguishes missing/add/remove, metadata-only, different
context, different period, acquisition extension, regression, changed evidence,
and a changed acquisition partition. No comparison picks a trustworthy side or
merges records automatically.

Comparable numerical deltas require equal agent/account/chain/period, no changed
shared block hash, and no restriction or within-report anchor conflict on either
side. Missing operands stay null. The signed deltas describe differences between
saved observations; they are not returns or current asset movements.

Original events are keyed by the existing transfer-event identity. Additions,
removals, content changes and unchanged events are counted separately. These
counts describe saved evidence, not a claim that an onchain transaction was
created or deleted. Endpoint field changes retain provenance differences.

Both adding and removing a requiresNewPlan flag demand attention. A supplied
unrestricted file cannot be certified by this comparison. The UI displays this
before accepting the replacement. Cancelling retains the previous report.

## CLI and local serving

`check-period-report.js` uses the existing bounded read-only file loader.
Its output omits names, addresses, balances and transaction hashes. Exit 0 means
valid input and any requested agreement condition passed; exit 2 means valid
input without that condition; exit 1 means argument/read/format failure.

The localhost server explicitly allowlists the new modules and stylesheet.
Synthetic fixtures, preview and browser tests require --ui-test. Report files,
private repository paths and CLI scripts are not exposed. Non-GET methods cannot
write files through the server.

The preview stores synthetic records under threecore-demo-period-report-v1 and
requires a visible button before seeding. Browser tests use unique random
threecore-test-period-report-* database names and clean up only their own data.

## Verification

Unit coverage includes schema and accessor boundaries, exact arithmetic, partial
prefixes, chain/range/account separation, cross-token anchor conflicts, checksum
and UTF-8 failure, exports, pagination, source concurrency, cancellation, observer
errors, disposal, CLI exit codes, and evidence revision comparisons.

Workflow tests run the real collector against deterministic read-only sessions,
then library backup, report generation, file recovery, filtering and summaries.
They verify that report operations add no provider calls. Browser tests use real
DOM, native IndexedDB and File objects, including reopening and competing source
edits. These tests do not claim a real-wallet asset transaction or an independent
security audit.
