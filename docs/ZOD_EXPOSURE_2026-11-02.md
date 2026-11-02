# Bounded development dependency exposure review — November 2, 2026

The [official advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) still
identifies Zod versions before 4.6.6 as affected by excessive resource use while
collecting validation failures. This dated source check is not an independent
review, a waiver or proof of exploitability of the complete application.

Installed versions are Zod 3.25.76, Hardhat 3.16.0 and its Zod helper 3.0.6.
The helper's RPC access-list and authorization-list schemas accept arrays without
a maximum item count. Direct parsing of 1, 4, 16 and 64 fictional invalid objects
produces respectively 2 and 6 issues per object. This bounded result identifies
a development validation surface that accumulates issues. No large-input memory
exhaustion or network exploit was attempted. An initial analysis-only assertion
counted seven authorization fields; inspection established six before results
were saved. No production assertion or safeguard was relaxed.

The relevant Hardhat account handler imports these RPC validators, but it was
not instantiated. No configuration, account, keystore or private key was read,
and no signing or transaction method was invoked. A static direct-import search
in Wallet src/examples found no Zod or Hardhat imports. This does not establish
all possible dynamic reachability. Separately, the restored minimal read-only
profiles have 19 installed packages without Zod/Hardhat; they are distinct from
the affected full development installation.

The dated public npm lookup found [Hardhat 3.21.2](https://registry.npmjs.org/hardhat/latest)
and [helper 3.0.8](https://registry.npmjs.org/@nomicfoundation%2Fhardhat-zod-utils/latest)
still declaring Zod ^3.23.8. The observed latest [Zod](https://registry.npmjs.org/zod/latest)
was 4.6.7. Thus simply updating Hardhat does not appear to remove this affected
dependency range; that is an inference from metadata, not a tested upgrade.
No packages were installed or changed by the lookup. The earlier major-version
[compatibility failure](ZOD_COMPATIBILITY_2026-11-02.md) still matters.

Keep the development finding open for compatible upstream remediation and full
regression, or an explicit qualified release risk decision. Do not represent the
minimal runtime's absence of Zod as a clean audit of the development toolchain.
[Exact versions, source hashes, bounded observations and metadata receipts](evidence/2026-11-02-release-regression/DISTRIBUTION_16A0D33.md)
are included with the latest review archive.
