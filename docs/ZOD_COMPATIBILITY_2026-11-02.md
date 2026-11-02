# Zod major-version compatibility probe — November 2, 2026

Follow-up: a [private source migration candidate](ZOD_MIGRATION_CANDIDATE_2026-11-03.md)
now passes the tested ThreeCore configuration, build and read-only workflows.
It repairs the helper rather than forcing Zod 4 onto unchanged helper code.
The original failure below remains valid for the unchanged helper. The subsequent
[local application record](ZOD_APPLIED_2026-11-03.md) covers the repaired source,
all three updated installations and their final checks.

The outstanding [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
lists 4.6.6 as fixed. The installed Hardhat configuration helper
@nomicfoundation/hardhat-zod-utils 3.0.6 declares a Zod ^3.23.8 peer and uses
result.error.errors while formatting validation failures. Zod's official
[migration guide](https://zod.dev/v4/changelog#drops-errors) documents removal
of that alias. A blanket major-version override is therefore not a routine
compatible patch for this toolchain.

The installed helper file was copied byte-for-byte into two isolated directories.
Each received its own npm installation: Zod 3.25.76 for the baseline and 4.6.6
for the candidate. The helper's SHA-256 is
`ed7daa506d8a6283b4071036f866168dddf831b5bb39f1735d12138eb3bbbb48`. The installed helper bytes match across
the three token repositories, but the probe was executed once, from DAT's copy.

| Bounded fictional configuration | Zod 3.25.76 | Zod 4.6.6 |
| --- | --- | --- |
| Valid string field | No validation errors | No validation errors |
| Number where a string is required | One structured validation error | TypeError while mapping missing errors |
| Valid dictionary configuration | No validation errors | No validation errors |

The candidate failed a normal invalid-input path. No override was applied to any
source repository or existing node_modules. The full Hardhat build, compilation,
contract tests and every other Zod API were not exercised by this bounded probe.
It proves this particular incompatibility, not full compatibility or reachability
of the memory-exhaustion advisory. No deliberately oversized input was used.

The development finding remains open. A compatible upstream toolchain change and
its full regression/artifact comparison remain the preferred resolution. The
separate [minimal read-only runtime](READ_ONLY_RUNTIME_2026-11-02.md) was verified
without Zod installed, but that installation profile does not repair the complete
development toolchain. It must not be used to relabel the full audit as clean.

[The raw outputs, exact Zod package locks and method](evidence/2026-11-02-token-dependency-review/ZOD_COMPATIBILITY.md)
are retained. No project configuration or private credentials were loaded, and
no wallet, public RPC, signature, transfer, remote CI or publication was involved.
