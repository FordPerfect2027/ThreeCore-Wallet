# Read-only runtime installation — November 2, 2026

The read-only tools imported viem, but the package declared it only as a
development dependency. A fresh DAT installation with npm ci --omit=dev
completed successfully while inspect-transfers.js failed at startup with
ERR_MODULE_NOT_FOUND for viem, before validating its public-address argument.

viem 2.56.6 is now a runtime dependency in DAT, EMA and CAWELON. npm regenerated
only dependency-classification flags in the lock. All 141 package entries keep
their versions, resolved URLs, integrity values and other package metadata.
Solidity, deployment configuration, readers and their test sources are unchanged.

## Reproduce the runtime profile

Use a separate, fresh checkout intended only for the read-only commands.
npm ci replaces that checkout's installed dependencies; keep the full development
checkout separate if you still need contract compilation and local-EVM tests.

```text
npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=2 test/*.test.mjs
```

The minimal profile installs 19 packages, including viem, while excluding Hardhat,
solc, TypeScript and Zod from the installed tree. It supports the existing identity,
public balance/allowance, reference-quote, Transfer and Approval read-only tools.
Public-read commands still use their documented public addresses and RPC rules.
The regression command instead uses local fixtures and makes no public RPC call.

Simply using --omit=dev installs 21 packages under the verified lock and npm
version: optional TypeScript and Zod peers remain. The explicit --omit=optional
is therefore part of this profile. It is not an advisory fix. The complete
development installation retains Zod 3.25.76 and its previously recorded
GHSA-mrhx-c7xc-m3w5 finding; compatible remediation and review remain open.
--no-audit here separates installation from the separately recorded dependency
review and is not a claim of a clean audit. No package version was forced or hidden.

## Verification

All three tokens passed the existing 213 read-only cases in independently installed
fresh directories on Windows with Node 24.19.0 and npm 11.17.0. These include actual
child-process/HTTP command tests with positive Transfer/Approval observations,
canonical-state results, input refusals, network/block changes and redacted errors.
There are no new test cases in this change; the earlier 213-case checkpoint overlaps.

The initial evidence collector expected TAP summary markers while Node selected
the spec reporter. The test subprocesses passed, but the collector then rejected
their summary format. Both the passing raw logs and collector failures are retained;
the corrected collection recognizes both formats. No tests were changed to pass.

A separate CI job now prepares this runtime profile and runs the same suite on
Node 22 and 24. The workflow is prepared locally; this record does not claim those
remote jobs ran. The full contract/build jobs remain in place. Contract tests and
Wallet browser suites were not rerun for this metadata-only change.

No real wallet, signature, transfer or private credential is used. This installation
correction does not complete real-wallet UI acceptance or independent security review.
The Wallet evidence collection retains before/after logs, the installed package lists,
source fingerprints and the three regression outputs.

npm option reference: https://docs.npmjs.com/cli/v11/commands/npm-ci/

## Fixed local source revisions

| Token | Commit | Minimal runtime result |
| --- | --- | --- |
| DAT | `6c455914df26d52de75bd2c6d3ae0aefb1215d29` | 213 passed / 0 failed |
| EMA | `c027e68cd1974dc31f2619d04b4fb9059843424f` | 213 passed / 0 failed |
| CAWELON | `b77a6b31af135c0461dd66d95bc837c8e7d9e88f` | 213 passed / 0 failed |

[Raw logs, package lists and source hashes](evidence/2026-11-02-token-dependency-review/RUNTIME.md) belong to these local revisions. The verified 7d58d08 combined ZIP is an earlier checkpoint; it predates this installation correction and the preceding history CLI fix.
