# Compatible Zod 4 development candidate — November 3, 2026

A private local migration of `@nomicfoundation/hardhat-zod-utils` now works with
Zod 4.6.6 in the tested ThreeCore build and read-only workflows. A clean
installation of the complete development dependency graph reported zero known
vulnerabilities in its dated npm audit. This report records preparation of the review candidate, before application to
the original token working copies. The subsequent local application has a
[separate record](ZOD_APPLIED_2026-11-03.md). No upstream package, GitHub branch,
release or running Wallet was updated.

## Source change

The candidate is based on Nomic Foundation's MIT-licensed helper 3.0.8 and is
labelled `3.0.8-threecore-zod4.1`, with `private: true`. Only its `src/index.ts`
changes. Its TypeScript source, declarations and JavaScript are included in the
archive, along with the license and build configuration.

- Use `error.issues` instead of the removed `error.errors` alias.
- Use Zod 4's error callback for forbidden fields, preserving the custom message.
- Update Zod type parameters and constrain union members to schemas that expose
  `safeParse`.
- Copy forwarded issue fields and represent symbol path labels explicitly as
  strings, preserving the public string/number path contract.

The helper was rebuilt with TypeScript 6.0.3, `strict: true`,
`skipLibCheck: false` and `noEmitOnError: true`. No validation was removed and no
type-error suppression was added. Original token compiler, Hardhat, OpenZeppelin,
viem and plugin versions remain fixed. The lock comparison changes just two
installed package entries: the helper and Zod 3.25.76 → 4.6.6.

The first runtime repair passed eight of nine bounded fixtures; it lost a custom
forbidden-field message. Migrating the error callback fixed that ninth case.
The initial strict source build then exposed the type/path differences above.
Those failures and the successful rebuild are retained, rather than treating a
JavaScript-only patch as a complete migration.

## Observed checks

| Check | Observed result and scope |
| --- | --- |
| Helper runtime compatibility probe | 9/9 bounded fictional configurations after the second repair |
| Actual Hardhat network/compiler validators | 13 cases retain accept/reject outcomes and error paths; two standard error messages differ |
| Node test-runner plugin validator | 6 cases retain accept/reject outcomes and error paths |
| Focused helper/toolchain regression | 8 passed, including preserved structured errors, strict-object rejection and the bounded-array early check |
| Source/routing/toolchain regression with full plugin dependencies | 11 passed |
| Existing DAT read-only suite with full plugin dependencies | 251 passed, zero failures/cancellations/skips/todos; fictional clients and local fixture servers |
| Public helper and Hardhat type fixtures | Passed with strict checking and `skipLibCheck: false` |
| Three complete token TypeScript projects | Passed using each project's existing type-check settings |
| All three contracts, minimal and full-plugin configurations | Compiled with local solc 0.8.34; ABI, complete creation bytecode and complete runtime bytecode match their original builds |
| Original token configurations in separate review copies | All three compiled; configuration bytes match the originals and generated ABI/bytecodes still match |
| Clean tarball installation | `npm ci --ignore-scripts` succeeded without modifying installed source afterward |
| Full dependency audit of the isolated candidate | Zero known findings at the recorded time |
| Review patches | `git apply --check` succeeds against all three recorded original revisions |

These groups overlap. In particular, four toolchain cases occur in both the
eight-case and eleven-case groups; repeated installation/build checks are
reproduction evidence, not additional product features or progress percentages.
The node-test-runner probe exercises that plugin's own `paths.test` validator;
it does not establish unrelated `paths.tests` routing behavior.

The original-configuration checks ran with `CI=true`, the installed keystore
plugin's documented-in-source no-lookup branch, task-owned application-data
directories and a filtered environment containing no credentials. No network
provider, user account, private key, signature or transaction was required.
The original contract-execution and local-EVM transaction suites were not rerun
for this candidate. The 251 read-only cases are from DAT; the other two tokens
received build, type and artifact comparisons, not duplicate read-only claims.

## Reviewable changes and provenance

Downloads contains `ThreeCore-zod4-review-changes-20261103/`, with one patch and
the replacement files for each token. Each patch adds the private helper archive,
license/source delta, a migration regression file and the two dependency changes.
The package's toolchain-test command includes the new regression file.

| Token | Base revision |
| --- | --- |
| DAT | `ada78f5ecbd8654860d818b774ef31beb6f0b871` |
| EMA | `c4765efe92857e7060c0efaa44b271c67d8d68c3` |
| CAWELON | `a94d61be77c0c14109910879cdd6a7f377176101` |

The helper archive SHA-256 is
`1013b53b9eb2c2cdead0e16a0be8a9e5397db31e38a446f4d67b4483e5e9abf1`.
Its npm integrity is retained in every candidate lock. Original JSON line endings
are preserved in the review patches to avoid unrelated whole-file changes.
At this preparation checkpoint, the original repositories remained clean and
their installed helper retained SHA-256
`ed7daa506d8a6283b4071036f866168dddf831b5bb39f1735d12138eb3bbbb48`.

The app's managed-worktree operation did not accept these source directories
because they are outside its registered workspace folders. It created no
worktrees. Ordinary isolated source copies and review patches were prepared
instead; no app workspace restriction or browser protection was changed.

## Limits and next acceptance

This closes the earlier conclusion that a compatible local repair had not yet
been demonstrated. These preparation checks alone did not clear the original
development installation,
approve maintaining a private upstream fork, or complete release acceptance.
Review the candidate, retain applicable full-project execution evidence before
adoption, and recheck advisory status before release. An official compatible
upstream release would avoid maintaining this local fork.

The [advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) names 4.6.6 as
fixed. The measured early check rejects an oversized array with an explicit
maximum before visiting elements. It does not impose a universal bound on
unbounded schemas; see the earlier [exposure analysis](ZOD_EXPOSURE_2026-11-02.md).
A zero audit is neither independent approval nor proof of token safety.
Actual wallet account/network-switch acceptance remains a separate open item.

## Evidence

- [Source delta](evidence/2026-11-03-zod-migration-candidate/helper-migration.patch)
- [Clean installation and artifact comparison](evidence/2026-11-03-zod-migration-candidate/reproduction/reproduction-summary.json)
- [Full dependency changes](evidence/2026-11-03-zod-migration-candidate/plugin-integration/lock-comparison.json)
- [Dated full audit](evidence/2026-11-03-zod-migration-candidate/plugin-integration/audit.log)
- [Read-only and source-test exit records](evidence/2026-11-03-zod-migration-candidate/plugin-integration/readonly-result.json)
- [Original-configuration build and preservation](evidence/2026-11-03-zod-migration-candidate/review-application/artifact-preservation.json)
- [Three patch checks](evidence/2026-11-03-zod-migration-candidate/review-changes/patch-verification.json)
- [SHA-256 manifest](evidence/2026-11-03-zod-migration-candidate/SHA256SUMS.txt)

The recorded methods preserve their original local paths as execution evidence;
those paths must be adapted when reproducing on another machine. The patches
are relative to their pinned token repositories. The sealed Wallet review ZIP
`ThreeCore-review-bf690f3-20261103-r1.zip` predates this supplement and is unchanged.
