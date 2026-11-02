# Bounded development dependency exposure review — November 2, 2026

## Current toolchain follow-up — November 3

The corrected token candidates now use Hardhat 3.21.2, its Zod helper 3.0.8 and
Zod 3.25.76. The earlier installed-version paragraph below is historical.
A fresh official registry lookup still reports Hardhat 3.21.2 / helper 3.0.8
requiring Zod `^3.23.8`, while latest Zod is 4.6.7. The helper's loaded bytes still
match the earlier incompatible-major probe. The
[new compatibility guards](TOOLCHAIN_COMPATIBILITY_GUARDS_2026-11-03.md) retain
structured invalid-input handling as an upgrade requirement in all three token
projects. They do not remediate or waive the advisory.

## Original bounded observations

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

## Size-bound and compatibility-export follow-up

The [upstream fix](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd)
adds early size checks to v4 arrays, maps and sets with configured upper bounds.
It does not add a universal limit to an unconstrained array. This matters when
considering a migration for the unbounded helper schemas above.

A bounded offline probe reused the two earlier isolated installations and
compared Zod 3.25.76, the ordinary 4.6.6 export, and `zod/v3` from 4.6.6. It used
2, 3 and 64 fictional numeric elements against a string schema, with and without
`.max(2)`, and counted element visits as well as returned issues.

| Import | 64 invalid elements with `.max(2)` | Without a maximum |
| --- | --- | --- |
| Zod 3.25.76 | 64 visits, 65 issues | 64 visits, 64 issues |
| Zod 4.6.6 ordinary export | 0 visits, 1 size issue | 64 visits, 64 issues |
| Zod 4.6.6 `zod/v3` compatibility export | 64 visits, 65 issues | 64 visits, 64 issues |

Valid input at the limit was accepted in all three cases. The compatibility
export therefore cannot be treated as applying the v4 early-size fix while
retaining the old helper API. A migration also needs explicit limits before
processing untrusted collections; merely changing the package version or the
error-property alias does not establish that protection. This is a conclusion
about these measured paths, not a complete Hardhat vulnerability assessment.

No package, project configuration, account or keystore was changed or loaded.
The largest input contained 64 elements; no exhaustion or network attack was
attempted. The advisory remains open. [Results](evidence/2026-11-02-token-dependency-review/zod-size-gate-probe.json)
and [the exact probe](evidence/2026-11-02-token-dependency-review/zod-size-gate-probe-method.mjs)
retain package-lock and loaded-entry digests. These later records postdate the
fixed review archives above.
