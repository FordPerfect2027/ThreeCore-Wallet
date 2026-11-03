# Canonical token identity correction — November 2, 2026

The standalone DAT, EMA and CAWELON identity commands previously pinned reads
to a block number. A reorganization at that height could mix state from
different blocks. They now require one EIP-1898 canonical block hash for every
contract-code and metadata read, and recheck both the header and the network.
Unsupported hash queries fail without a weaker fallback. CLI errors no longer
print raw provider messages, which can contain authenticated URLs.

| Token | Fixed local commit | Read-only regression | Live observation |
| --- | --- | --- | --- |
| DAT | `d5ff32f898b75482dd6d211eae0750ae9d0b6d22` | 159 passed / 0 failed | [JSON](evidence/2026-11-02-canonical-token-identity/DAT-live.json) |
| EMA | `ba4aa22d1b9f0eb4390a3dac25bf4b7105545e09` | 159 passed / 0 failed | [JSON](evidence/2026-11-02-canonical-token-identity/EMA-live.json) |
| CAWELON | `b3fc18ccaff040d4aff1f5567ceb049971836462` | 159 passed / 0 failed | [JSON](evidence/2026-11-02-canonical-token-identity/CAWELON-live.json) |

All three live observations happened to select Base Mainnet block 53,389,236,
hash 0x3f2d71c8fa099cb337e1248aa065f5f2256500814719dbf9588e109e37971cf7.
Each command checks its own captured block; simultaneous invocation does not
guarantee a shared block in future runs. Names, symbols, decimals, and the
original issuance ceiling passed. No wallet or transaction was used.

The [checksummed evidence](evidence/2026-11-02-canonical-token-identity/README.md)
contains the logs, exact public responses and source fingerprints. Each 159-case
suite includes 42 identity unit cases and three actual CLI/HTTP transport cases.
They cover reorganization, changed network, malformed data, unsupported hash
selectors and error-message redaction. Subsets are not added to suite totals.
Contract, dependency lock and deployment sources were unchanged. Earlier full
contract and Wallet adapter tests remain evidence for their original commits.

This does not change the browser Wallet source at 34d1731, complete its real
wallet acceptance, establish a verified deployed-code match, or resolve the
remaining [Zod advisory](TOKEN_DEPENDENCY_REVIEW_2026-11-02.md). The block is
canonical according to one provider at query time, not independently finalized.

The prepared Wallet CI now pins these token commits. Its token-before-Wallet
publication order remains necessary; no remote CI run covers these local pins.
The offline package at 7f92929 predates this correction and is retained as an
earlier checkpoint. A later combined delivery must include these new commits.

Protocol reference: https://eips.ethereum.org/EIPS/eip-1898

## Follow-up: balances and reference quotes

The same block-number limitation was also corrected in the standalone public
wallet-readiness and pool-reference-quote commands. All state reads now use
one EIP-1898 canonical hash, with final header and chain rechecks. CLI errors
omit provider details, and quote integer input is bounded before conversion.

- DAT: `62dee6aba8a092e179643e0e4b19d53473cd6e67`
- EMA: `05d86c6a29f93057fc09778f47f15fe4fd94b4cf`
- CAWELON: `74c2c0fe001193915d45d9a4734bfa6714598717`

Each full read-only suite now passes 194 cases (including, not adding to, the
earlier 159); 69 focused state cases are a subset. Six live public-RPC commands
also succeeded. [Detailed evidence and initial failures](evidence/2026-11-02-canonical-token-identity/STATE_READS.md)
separate public quote outputs from redacted public-account readiness receipts.
No real wallet permission, transaction or trade was exercised. The Wallet app
source is unchanged. The prepared CI pins now select these newer token commits.
