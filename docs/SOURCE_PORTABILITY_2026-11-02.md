# Reproducible token sources and test routing — November 2, 2026

The ordinary Windows DAT build had different metadata from the recorded
September artifact solely because DATCore.sol used CRLF. EMA and CAWELON used
the same line-ending pattern. All three contract sources now use UTF-8/LF,
with a narrow Git checkout policy and a check before the standard compile command.
Malformed encoding or CRLF is rejected without silently rewriting a source file.

Real Git checkout tests in isolated directories on Windows preserve identical
source bytes with autocrlf enabled and disabled. Removing the policy makes that
regression fail. These are two Git modes, not an actual Linux-host execution.

Forced ordinary Hardhat builds passed for all three tokens. The ABI, immutable
references and creation/runtime executable bytes match their prior artifacts.
Only metadata changes; full artifact hashes therefore change and are recorded.
No Solidity statement, compiler, dependency lock or deployment record changed.
DAT's normal build now exactly matches the pinned historical reference fields,
and passes the verifier's artifact preflight. The earlier public historical
recheck remains the public observation; it was not repeated or relabelled as
current state. The reference file and expected deployment hashes are unchanged.

## Corrected test execution

The legacy Hardhat discovery also picked up a CLI-only preload under test/support.
The retained DAT run had 288 passing cases and one failure: the preload correctly
refused to run outside its owning loopback fixture. It also repeated the read-only
suite. The corrected test command explicitly enumerates top-level TypeScript
specs for Hardhat, while operational *.test.mjs files run in test:read-only.
Both groups remain in npm run check; no assertion or watchdog was relaxed.
Read-only test files run sequentially, matching the earlier complete passing runs.
The actual runner's discovery, failure propagation and empty-suite behavior have
their own regression checks. Future nested TypeScript suites need a policy update.

| Token | Local commit | Contract tests | Local history | Wallet compatibility | Source/routing |
| --- | --- | ---: | ---: | ---: | ---: |
| DAT | `502944c94ffed408356b487abc9a710807697ee2` | 37 | 10 | 50 | 7 |
| EMA | `9cad39a196e8afc37abb5b99c260e00327c55d1c` | 39 | 10 | 50 | 7 |
| CAWELON | `e3a5fbb966008319b7b7204ddbfb705a3e9ab12c` | 39 | 10 | 50 | 7 |

DAT's complete standard npm run check additionally passed compilation, typecheck
and all 251 read-only cases. EMA/CAWELON's prior 227-entry complete read-only runs
remain applicable to their unchanged read-only implementation; those suites were
not rerun for this source-only normalization. These totals overlap other records
and are not features or a completion percentage. Existing dependencies were reused.
Local EVM tests use fixture accounts and simulated transactions/signatures; no
user wallet or private key was accessed and no public transaction was submitted.

The prepared Wallet workflow runs the source/routing check before compiling and
uses these fixed token revisions. The verified d904442 ZIP predates this and the
body-deadline/Sepolia-verifier corrections. [Evidence](evidence/2026-11-02-token-dependency-review/SOURCE_PORTABILITY.md)
preserves before/after artifact fields, comparison methods, failed controls,
successful logs and exact source patches. Real-wallet acceptance, compatible Zod
remediation/exposure review, independent review and release approval remain open.
