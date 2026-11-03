# Toolchain upgrade guard and CI coverage — November 3, 2026

The current token toolchain can parse a valid configuration with Zod 4 but throws
while reporting an ordinary invalid field. The existing two toolchain tests
checked only RPC byte decoding. Each token project now also checks a valid
fictional nested configuration and requires an invalid nested field to produce
one structured error with its complete path. The tests resolve Zod from the
helper used by Hardhat, so an unrelated root installation cannot mask the issue.

These are pure validation calls. They do not load Hardhat configuration, account
handlers, keystores, private keys or a network provider. No user input or real
configuration file is used.

| Token | New local test revision | Result |
| --- | --- | --- |
| DAT | `ada78f5ecbd8654860d818b774ef31beb6f0b871` | 4 toolchain cases passed |
| EMA | `c4765efe92857e7060c0efaa44b271c67d8d68c3` | 4 toolchain cases passed |
| CAWELON | `a94d61be77c0c14109910879cdd6a7f377176101` | 4 toolchain cases passed |

Each revision changes only `integration/toolchain-data.test.mjs`: two new cases
alongside the two existing empty-data cases. Contract source, dependency locks,
configuration and generated artifacts were unchanged. The complete token suites
were not repeated for this test-only change; their earlier results retain the
previous exact source pins.

## Negative control and remaining dependency finding

The installed helper 3.0.8 has SHA-256
`ed7daa506d8a6283b4071036f866168dddf831b5bb39f1735d12138eb3bbbb48`.
It matches the unchanged helper copies in the existing isolated Zod 3.25.76 and
4.6.6 probes. The same new nested input contract passed with v3; the forced-v4
case still threw `TypeError` instead of the structured error. Valid input passed
both. This demonstrates the added guard's failure case without altering any
installed project dependency or loading private settings.

A fresh lookup of the official npm registry returned Hardhat 3.21.2 and helper
3.0.8, both still requiring Zod `^3.23.8`; latest Zod was 4.6.7. The
[reviewed advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) continues
to list versions before 4.6.6 as affected. Thus the current declared dependency
range does not provide a compatible official remediation. The source-level
exposure and bounded probes remain in [the exposure review](ZOD_EXPOSURE_2026-11-02.md).
The guard prevents a silent compatibility regression; it does not fix the
resource-consumption issue, establish exploitability or replace risk review.

## Local CI preparation

The HTTP step used `integration/*server.test.mjs`, which omitted
`integration/local-navigation-help.test.mjs`. The prepared workflow now names
that file explicitly, covering refusal guidance and same-origin recovery.
The exact revised local command passed all 440 cases, with zero failures,
cancellations or skips. Its token matrix now pins the three revisions above so
the existing `test:toolchain` step runs the new configuration checks.

GitHub was not changed and no remote workflow ran. During the later consolidated
publication, publish the three token commits before the Wallet workflow that
references them. The sealed `9374845` review archive remains unchanged and does
not contain this later test/workflow follow-up. This work does not close live
MetaMask switch acceptance, the dependency finding or independent release review.

[Scoped receipts and raw logs](evidence/2026-11-03-toolchain-guards/summary.json)
and their [manifest](evidence/2026-11-03-toolchain-guards/SHA256SUMS.txt) record
the actual checks without combining them into a completion percentage.
