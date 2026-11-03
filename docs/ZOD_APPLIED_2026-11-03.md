# Zod repair applied to all three local token projects

The compatible private helper repair is now committed and installed in DAT,
EMA and CAWELON. Each project has an independent dependency directory, passes
the final applicable checks, and reports zero known vulnerabilities in its
dated full npm audit. This resolves the recorded affected Zod version in these
local development installations. It is not an upstream release, a public
deployment or independent release approval.

| Token | Local commit | Installed Zod / helper |
| --- | --- | --- |
| DAT | `dc2535732e9b83bddd8c5f4a2208c65fdff0a6d1` | 4.6.6 / 3.0.8-threecore-zod4.1 |
| EMA | `cae4130e8e01fd325fdcb6a589a46338be08b27e` | 4.6.6 / 3.0.8-threecore-zod4.1 |
| CAWELON | `9fc0ffa988f5b9a80d75d7f95b80e6a759f1610d` | 4.6.6 / 3.0.8-threecore-zod4.1 |

All three working trees were clean after committing. Contract source, compiler,
Hardhat, OpenZeppelin, viem and plugin versions are unchanged. Only two installed
package entries change, plus the focused regression and provenance files.
The helper archive retains the upstream MIT license and complete source.
The later [full local simulation](TOKEN_SIMULATION_2026-11-03.md) adds successful
existing contract suites (37 DAT, 39 EMA, 39 CAWELON cases) and ten local history
cases per token, using only disposable simulator accounts. Full artifact bytes
remain unchanged. This supersedes the earlier no-rerun limit below, while
independent helper review and maintenance approval remain open.
See the [preparation and compatibility record](ZOD_MIGRATION_CANDIDATE_2026-11-03.md)
for the source repair and the earlier clean-install/full-plugin experiments.

## Final applied checks

Each of the three actual local working copies passed:

- A clean npm installation with lifecycle scripts disabled.
- Eight toolchain/migration cases, including structured invalid-input errors
  and the bounded-array early check.
- Forced compilation using its actual configuration and local solc 0.8.34.
- The project's existing TypeScript check.
- `npm ls --all`: exit zero and no reported dependency-graph problems.
- A full npm audit: exit zero and zero reported vulnerabilities.
- Exact ABI and full creation/runtime-bytecode equality against the preserved,
  previously compared artifacts.

The earlier full-plugin candidate also passed DAT's existing 251 read-only
cases and 11 source/routing/toolchain cases. These overlap with the applied
eight-case runs and are not summed into a feature count. They were not repeated
as an inflated total. Transaction-executing contract/local-EVM suites were not
rerun. Private keys, user wallets, signatures and transactions were not used.
Compilation used CI mode, filtered environment variables and task-owned
application-data directories; the keystore lookup branch was disabled.

## Installation interference and recovery

The earlier token environment shared DAT's installed dependency directory via
junctions, as recorded in the prior toolchain report. This topology was not
checked before the initial parallel reinstall. EMA reported `EPERM` while
removing a dependency directory. Its later reinstall succeeded but a separate
graph check found DAT's directory empty; CAWELON still referenced that directory.
This was an execution mistake in handling the shared environment.

The failure and the earlier passing DAT check are retained. The earlier DAT
check is explicitly superseded by the final run after recovery. The CAWELON
junction's target was verified before unlinking only the junction. DAT and
CAWELON then received independent clean installations, and all three real paths
were verified distinct. No recursive target deletion, permission escalation,
ACL change or forced process termination was used. The installed-graph check
now passes in all three environments. The working agreement now requires
checking this topology before future dependency reinstalls.

The original Wallet server processes and their start times remain preserved,
and all three ports 4231, 4232 and 4233 returned the Wallet successfully.
No browser reload, account switch or unsaved-page edit was needed for this work.

## Delivery and remaining scope

Downloads contains the final source patches and commit map in
`ThreeCore-zod4-review-changes-20261103/applied/`. The original root-level patches
remain as preparation-stage evidence. The sealed
`ThreeCore-review-bf690f3-20261103-r1.zip` is unchanged and contains the base token
revisions; the new patches are a separate update. GitHub writes remain deferred.
The same final patches are saved as `ThreeCore-zod4-update-20261103.zip`; its
fresh extraction matched all six manifest entries. The [archive receipt](evidence/2026-11-03-zod-applied/update-archive.json)
records the exact size and SHA-256. The local Wallet workflow now points to the
three new token commits; publish those commits in the consolidated update before
running that workflow. No remote job was triggered by this edit.

The private helper fork still needs independent review and a maintenance/release
decision. A zero dated audit is not proof of token safety or a promise about
future advisories. Unbounded schemas do not acquire a universal size cap merely
from using Zod 4. The separate [live wallet follow-up](LIVE_RECOVERY_2026-11-03.md#actual-network-and-account-changes--13251335-jst)
now records network/account invalidation, reconnection and history preservation;
those results are not inferred from this dependency repair.

## Evidence

- [Final per-token results and artifact digests](evidence/2026-11-03-zod-applied/final-summary.json)
- [Source commits and final patch hashes](evidence/2026-11-03-zod-applied/source-commits.json)
- [DAT final command exits](evidence/2026-11-03-zod-applied/DAT/verification-final-result.json)
- [EMA command exits](evidence/2026-11-03-zod-applied/EMA/verification-result.json)
- [CAWELON command exits](evidence/2026-11-03-zod-applied/CAWELON/verification-result.json)
- [Independent installation paths](evidence/2026-11-03-zod-applied/independent-topology.json)
- [Failure, recovery and superseded-check notes](evidence/2026-11-03-zod-applied/execution-notes.json)
- [SHA-256 manifest](evidence/2026-11-03-zod-applied/SHA256SUMS.txt)
