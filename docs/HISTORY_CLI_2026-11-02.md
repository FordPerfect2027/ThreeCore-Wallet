# History command validation — November 2, 2026

The standalone Transfer and Approval commands now reject invalid addresses,
oversized decimal block text and known invalid ranges before any RPC request.
Previously, an invalid 2,001-block range still triggered three public-read
requests. A replay against unchanged DAT base command files reproduces that
behavior; the corrected commands make none. Both commands now use bounded
timeouts without automatic retries and omit raw provider messages from errors.

| Token | Fixed local commit | Full read-only suite |
| --- | --- | --- |
| DAT | `45f0aa3f897538f1dfccfe3299dcec793156bd8e` | 213 passed / 0 failed |
| EMA | `a292d6b81d1f1e754fcdb1d76af2e61e182375f6` | 213 passed / 0 failed |
| CAWELON | `1eee51c89ea9d6507b68ee017781125b321b7f2b` | 213 passed / 0 failed |

The full suites include 19 history input/CLI cases and supersede the overlapping
194-case checkpoint. Actual command processes and viem HTTP decode known
incoming Transfer and Approval events through a controlled local RPC. They
also check empty history, exact 250-block default ranges, block replacement,
invalid input before communication, credential/error redaction and no retries.
The [logs, before/after proof and source fingerprints](evidence/2026-11-02-canonical-token-identity/HISTORY_CLI.md)
are checksummed. No new public history scan or wallet permission was used.

Known input/configuration errors exit 2 with a fixed error code and usage;
verification/provider failures exit 1. Existing JSON report fields are unchanged.
Explicit ranges retain the 2,000-block cap. Future ranges are still checked
against a current chain tip by the underlying library. History libraries,
canonicality checks, token identities, contracts and dependency locks did not
change. The open Zod finding and real-wallet UI acceptance remain separate.

The prepared CI pins select these new local token commits. No new remote run
is represented by this record. The verified combined ZIP at 7d58d08 is retained
as a previous checkpoint and does not yet contain this follow-up.
