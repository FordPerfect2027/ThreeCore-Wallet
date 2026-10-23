# Resumable historical period collection

This local feature adds an acquisition path to the existing balance/history
reconciliation workflow. It does not add transaction capabilities or change
deployed contracts. Existing read-only sessions remain the provider boundary.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `period-plan.js` | Strict context and endpoint validation, bounded partitioning |
| `period-draft.js` | Immutable contiguous checkpoints and reconciliation conversion |
| `period-reader.js` | Sequential acquisition, session guards and block rechecks |
| `period-file.js` | Bounded UTF-8 envelopes and SHA-256 consistency checks |
| `period-controller.js` | Reviewed replacement, cancellation and stale-result isolation |
| `period-view.js` | Safe messages, exact amounts and plain-text summaries |
| `period-progress.js` | Bounded, sanitized progress descriptions |
| `period-recovery.js` | Explicit restart and smaller-window proposals |
| `examples/period-panel.js` | Form, progress, file controls and handoff UI |
| `scripts/check-period.js` | Offline, read-only JSON inspection |

The main wallet mounts the period panel beside the reconciliation panel.
The selected card supplies a connected session; the panel never connects a card
or asks for accounts itself. Each card can have a different account and chain.

## Plan and interval semantics

The plan schema is `threecore.period-plan.v1`.
It contains a strict `{agent, chainId, account}` context, decimal `earlierBlock`,
decimal `laterBlock`, and integer `windowSize`.
Unknown fields and noncanonical block values are rejected.
Blocks use integer strings and BigInt arithmetic, avoiding Number rounding.

For endpoints A and B, A must be smaller than B.
The initial balance includes changes through A.
Consequently, history covers precisely `(A, B]`.
Windows are nonoverlapping, contiguous and ordered.
The final window can be shorter than the configured window size.

Plans allow at most 12 windows of at most 2,000 blocks each.
Planning is pure and does not require a provider call.
A preview does not mutate the current checkpoint.

## Checkpoint invariants

The draft schema is `threecore.period-draft.v1`.
Its members are the plan, nullable earlier/later observations, ordered records,
`readOnly: true`, and `independentlyVerified: false`.

The accepted sequence is:

1. An empty draft.
2. The earlier observation.
3. Both observations.
4. Both observations plus a contiguous prefix of planned history windows.

A later observation without an earlier observation is invalid.
Records without both observations are invalid.
Records cannot skip a planned window or appear out of order.
Every observation and record must match the planned token, account and chain.
Token identity assessment must be matched before a balance is accepted.
The endpoint block numbers must be exactly A and B.
The last history window must agree with the later observation's block hash.

Existing observations are never overwritten by an appended checkpoint.
The controller independently checks the reader's append-only contract.
A malformed callback aborts that run and retains the last accepted prefix.
Successful callbacks receive deeply validated, immutable snapshots.

Draft-to-workspace conversion requires every planned window.
Conversion uses existing reconciliation validation and transfer-archive merging.
The UI bridge replaces only the selected token slot after review, leaving the
other two slots available. Receipt of a candidate does not auto-apply it.

## Acquisition and chain consistency

The reader uses the current session's six existing read operations:

- `getBlockSnapshot`
- `getContractCode`
- `getNativeBalance`
- `getTokenMetadata`
- `getTokenBalance`
- `getTransferEvents`

It requires `canSign`, `canSendTransactions`, and `canBridge` to be false.
The agent, account, chain, site origin and connection epoch are bound at start.
Guards execute before and after each awaited operation and observer callback.
A disconnect or context change stops the run.

The identity reader now accepts an optional explicit decimal block number.
It validates the returned block number and pins the dependent reads to that
block hash using the existing adapter. Omitting the option retains latest-block
behavior for older callers.

On resume, the collector enumerates distinct block anchors in the saved draft:
both observation blocks, history-window endpoints and all event blocks.
Conflicting saved hashes for the same number are rejected.
Each anchor is requested by number and must retain its saved hash.
Missing steps are then acquired sequentially.
All anchors are rechecked again at the end.

This detects inconsistent views and reorganizations visible to the provider.
It does not prove that the provider is honest or authenticate imported balances
and events. Rechecking a complete imported draft checks its block anchors; it
does not reread every payload. A malicious source can produce a self-consistent
file with a newly computed checksum.

## Failure and resource bounds

The default whole-operation deadline is 120 seconds.
Identity and transfer reads default to 30 seconds per step.
Both timeout options accept integer values from 1 through 120,000 milliseconds.
The overall deadline also covers resume and final anchor checks.

Cancellation aborts future work and ignores late results.
It cannot recall an RPC already sent to the provider.
The reader clears its timer and abort listener in a finally block.
It never retries automatically, changes network, or chooses a fallback provider.
An RPC failure does not become a zero balance or a successful empty history.

Existing transfer limits remain: 500 adopted events and 100 distinct event
blocks per window. Maximum structural capacity is 6,000 events over 12 windows;
latency and byte limits can require smaller real requests.

Progress validation accepts only known stages and bounded counters.
Untrusted exception text and provider-supplied HTML are not rendered.
The UI uses textContent for user-facing values.
Progress means completed evidence steps, not elapsed-time percentage.

Canonical validation and reconciliation can be expensive on a large checkpoint.
The reader caches progress until the next accepted checkpoint.
The controller caches its canonical draft key at mutation boundaries.
The panel caches its summary and table until the immutable draft changes.
Lightweight progress notifications therefore do not repeatedly parse 6,000 events.

## Lifecycle and review rules

The controller tracks operation generation, draft revision and source epoch.
Asynchronous import/export/read results must belong to the current generation.
Cancellation, selection changes and disposal invalidate outstanding work.
Review records bind the previous draft key and revision.
Plan reviews additionally bind the connected source epoch and context.

Replacing acquired evidence requires a literal boolean acknowledgement.
Invalid preparation removes an older actionable review.
File import remains offline and does not copy its account into wallet settings.
An imported complete draft is historical evidence until separately rechecked.
Its original observation provenance is retained during resume.

Exports deliver synchronously through the UI's download callback.
Asynchronous callbacks are refused; rejected promises are drained.
A callback that cancels or replaces the draft cannot mark the replacement saved.
`savedCurrent` means delivery was initiated for the exact current checkpoint,
not that the operating system has completed writing the file.

Known block changes set `requiresNewPlan` and block resume, reconciliation handoff
and reconciliation export. Raw JSON/text export remains available for preservation.
The current controller also remembers the latest rejected draft key so that
reimporting that same draft does not clear the restriction in the same screen.
That memory is bounded to one key and is not persisted across reloads.

Recovery proposals require their own review and application.
Block changes propose a new empty draft for the same period.
Event overflow proposes half-size windows, down to a minimum of one block.
If that would exceed 12 windows, the proposal explicitly shortens B and reports
the remaining interval. Nothing silently discards or automatically retries it.
Overflow within one block cannot be repaired by this feature.

## File format and trust

The envelope schema is `threecore.period-file.v1`.
It contains `algorithm: "SHA-256"`, a lowercase hexadecimal digest and a draft.
The digest covers UTF-8 JSON of the validated canonical draft.
The file limit is 24 MiB; the canonical draft limit is 16 MiB.
The browser checks extension, filename control characters, advertised length,
actual ArrayBuffer length, UTF-8 validity, strict shape and checksum.

JSON contains public addresses, balances, counterparties and history.
It is not encrypted. There is no automatic upload or browser persistence.
The offline CLI uses the existing bounded file-reading helper.
Its output omits full accounts, amounts and counterparties.

| CLI result | Exit code |
| --- | --- |
| Valid file, including partial checkpoints | 0 |
| Valid partial file with `--require-complete` | 2 |
| Invalid arguments, unreadable or invalid file | 1 |

## Verification coverage

Pure tests cover plan partitions, canonical integers, exact endpoint semantics,
prefix validation, context isolation, anchors, immutable snapshots and limits.
Reader tests cover sequential calls, interruption, deadlines, provider failures,
session changes, block changes and complete-draft rechecks.
Controller tests cover review replacement, stale results, reentrancy, failed
delivery, partial retention and the handoff contract.
File/CLI tests cover all checkpoint prefixes, corruption, encoding, size limits,
exit codes, read-only behavior and sensitive-field omission.

The provider tests use the actual ThreeCoreWalletSession and adapter with a
synthetic EIP-1193 provider. They assert the allowed RPC methods, hash-pinned
reads, cancellation, three distinct token accounts and both configured chains.
They do not connect an installed wallet or read a real account.

Seeded invariant tests compare independent event arithmetic against reconciled
results across multiple partitions. They include A-exclusion/B-inclusion,
self-transfers, duplicate-direction deduplication, no-event periods, interruption
with JSON round trips, and a 12-window/6,000-event case.

Browser cases exercise the mounted panel and the whole wallet integration.
They cover separate DAT/EMA/CAWELON mock connections, native File decoding,
corruption, strict replacement acknowledgement, cancellation, plan invalidation,
all three reconciliation slots, reorganization recovery and narrowed windows.

Server tests verify explicit route allowlisting, MIME/no-store headers,
test-only fixture gating, local import resolution and refusal of mutation methods.
The shared allowance import-graph guard now permits up to 120 local modules;
the integrated graph contains 101 after adding the new panels. Remote imports
remain rejected by the existing origin assertion.

## Local verification commands

```powershell
node --test test/*.test.js
node --test integration/*server.test.mjs
node examples/dev-server.js --ui-test
```

The browser suite is served at `/test/browser/`.
The manual recovery preview is `/test/browser/period-demo/`.
Its CSP denies network connections and its visible banner identifies synthetic
data. The main wallet remains `/` and does not contain fixture controls.

Per-run counts and saved screenshots belong in the external verification report,
so this design note does not claim every future checkout has the same totals.
No live signing, transfer, mainnet deployment or independent security audit is
performed by these tests. Existing local-EVM contract compatibility checks remain
a separate harness requiring a compiled token repository.
