# Read-only RPC body deadline — November 2, 2026

Five operational token commands could wait past their configured 12-second limit
when a provider sent headers and then stopped partway through a tiny JSON body.
The installed viem 2.56.6 implementation clears its fetch timer when its fetch
callback returns; ordinary native fetch returns at the headers. Source fingerprints
and before/after observations are retained in the evidence receipt.

The three tokens now share the same bounded transport implementation. The deadline
remains active through body consumption, cancels native fetch on expiry, and
preserves caller cancellation. A caller signal cannot disable the deadline.
The existing 10 MiB response cap is enforced before parsing both declared and
streamed bodies. The transport retains normal status/error and UTF-8 handling,
uses no retries, and adds no signing, transaction or fallback methods.

## Fixed sources and results

| Token | Local commit | Complete read-only regression |
| --- | --- | --- |
| DAT | `355fb9322bbfeafc8e008bf7f7aa1db057099750` | 227 passed / 0 failed |
| EMA | `b4f765338f77332eb11a0f0de5130cf5646a012e` | 227 passed / 0 failed |
| CAWELON | `f4ba321f7fe7f2eed548fa9545198b0eb0116370` | 227 passed / 0 failed |

The five command checks use real child processes with normal 12-second settings
and real HTTP over test-owned loopback endpoints. Every command exits unsuccessfully
without a result, subsequent request, retry or provider details. The eight transport
checks cover body cancellation, fresh deadlines, caller signals, response limits,
split UTF-8 and HTTP JSON-RPC errors. Including one parent group gives 14 new TAP
entries; the pre-existing 213 entries overlap prior runs. These totals are not
features, completion percentages or independent security reviews.

The original DAT source at `6c455914df26d52de75bd2c6d3ae0aefb1215d29` fails all
five corrected command checks and needs the test's 15-second body watchdog.
The initial harness instead counted process startup in a 17-second watchdog;
its failures are retained but are not proof of the body defect. A diagnostic
single-child run and the corrected before/after harness separate startup from
network waiting. The focused corrected run exits about 11.6–11.8 seconds after
the server begins the body, with the request deadline starting slightly earlier.

Initial simultaneous full regressions hit existing child-process watchdogs:
DAT 1 failure, EMA 4, CAWELON 4. The same source passes all complete sequential
runs, with one test file active at a time in each repository. No assertion or old
watchdog was relaxed. Both failed and successful outputs are retained.

## Scope and limits

This affects verify-base-mainnet, inspect-wallet-readiness, quote-dex,
inspect-transfers and inspect-approvals. The older verify-base-sepolia deployment-
artifact verifier is outside this five-command correction. Twelve seconds is a
per-request bound, not an end-to-end command duration or a wall-clock scheduling
guarantee. Existing dependencies were reused; EMA/CAWELON use the DAT installation
through junctions. No fresh install, contract rebuild, Wallet browser suite, real
wallet, public RPC, remote CI or publication was performed. Contracts, deployment
code, dependency versions and locks are unchanged. The open Zod advisory remains.

The prepared Wallet CI pins reference the new local token commits. They retain
the token-before-Wallet publication order. The verified d904442 delivery ZIP
predates this correction; the recorded source patches are relative to its token
commits. It must not be described as including this later fix.

[Raw results, full source patches and source hashes](evidence/2026-11-02-token-dependency-review/BODY_DEADLINE.md)
allow the change and failed attempts to be inspected separately from the earlier
distribution, canonical-read and dependency-installation checkpoints.
