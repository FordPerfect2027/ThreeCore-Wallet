# Developer technical review — November 3, 2026

Status: the bounded developer review below is complete. The user assigned this
review to Codex; requester or reviewer assignment is not a pending development
action. It is not an independent third-party audit or a public-release approval.

## Reviewed source and result

Wallet base: 95be8d63ad5726153f2204c79d7fabeb50f5db68. The Wallet implementation
is unchanged by this follow-up. Exact hashes of the inspected source files are
in [the source inventory](evidence/2026-11-03-developer-review/source-inventory.json).
The review followed the connection/event, cancellation and restore boundaries
listed below; it is not a line-by-line audit of the entire repository.

The helper source delta is the preserved
[private migration patch](evidence/2026-11-03-zod-migration-candidate/helper-migration.patch).
The token base revisions are DAT dc2535732e9b83bddd8c5f4a2208c65fdff0a6d1,
EMA cae4130e8e01fd325fdcb6a589a46338be08b27e, and CAWELON
9fc0ffa988f5b9a80d75d7f95b80e6a759f1610d.
The follow-up source pins are recorded in this review's source-changes receipt.

| Boundary inspected | Assessment | Verification |
| --- | --- | --- |
| Provider events and session lifetime | Event payloads are copied as bounded plain data; account/chain changes revoke the old context before observer cleanup. Old callbacks cannot reconnect. Event-rate overflow invalidates access. | Selected provider/card tests; the separate actual November 3 switch record |
| Pending and late reads | Read scope exposes only the read-method allowlist. Cancellation settles local waiters; old completion is discarded and cannot start another subread. Provider capacity remains owned by the underlying supervisor. | Card/read-scope tests, including late connection loss and replacement sessions |
| File loading and validation | Shared budgets and deadlines guard input. Validation checks shape and canonical checksum before a file becomes ready; cancellation generations also cover hashing. A checksum is not authenticity. | File lifecycle and workspace-file tests, including altered values and delayed completion |
| Restore and recovery | Apply checks the reviewed text, options and current draft again. Failed synchronous writes roll back; uncertain asynchronous writes retain a recovery copy and block further commits. Imported data does not grant wallet permission. | Restore/undo boundary and security-transaction tests |
| Private helper migration | Runtime edits are error-issue forwarding, the custom error option, and issue-path conversion. RPC decoding is unchanged. Installed Hardhat's one-argument record schemas were tested and work with this pinned Zod version. | Existing helper/RPC comparison plus new actual network/compiler-validator tests |

No additional runtime defect was established in that bounded inspection. This
means that the inspected behavior and checks passed, not that all defects have
been ruled out. The 250 selected Wallet cases passed with no failures; they are
a subset of the earlier full regression and must not be added to it as new
functionality. See [the recorded command results](evidence/2026-11-03-developer-review/wallet-results.json).

## Findings closed in this follow-up

1. **Configuration regression coverage gap.** Helper-level fixtures and successful
   compilation did not directly guard every configuration shape reviewed here.
   Added integration/config-validation.test.mjs in each token project and wired
   it into test:toolchain. Its six grouped tests check HTTP header record values,
   unresolved variable references, network discriminators, simulated-network
   cross-field rules, strict fork activation objects, compiler profiles, nested
   error paths, incompatible-field messages and source-path variants. The
   validators must also leave their input unchanged. All three environments
   passed 14 toolchain cases each, including the eight existing cases. These
   overlapping runs are not 42 different product features.
2. **Outdated vendor status.** The vendor README still said contract suites had
   not been rerun. It now references the completed local simulator exercise and
   states its synthetic scope. The helper archive and dependency versions are
   unchanged.
3. **Missing repeatable maintenance steps.** The vendor README now specifies
   archive verification, independent install directories, version-sensitive
   validator imports, affected regressions, complete artifact comparison and
   upstream replacement checks. This provides a development procedure without
   inventing an external maintainer or claiming independent approval.

[Toolchain results](evidence/2026-11-03-developer-review/toolchain-results.json)
retain the actual outcomes. The new configuration tests import only validator
modules; they do not instantiate Hardhat's runtime, load the project's config,
resolve secrets, create a provider or use a wallet. All URLs and variable names
are inert fixtures. No new dependency installation or contract build was needed.

## Continuing work and evidence limits

Technical-review assignment is resolved. Development continues through the
remaining delivery/recovery checks under the user's existing instructions.
Final publication remains deferred to the requested consolidated update.

The original native Windows picker traversal remains unobserved; the existing
actual filechooser imports and on-disk byte comparisons retain their own scope.
The older public 07041f0 checkpoint cannot restore shared-account configuration;
use the documented history-only recovery scope or a verified compatible version.
Neither an elapsed workday, a test count nor this review measures overall
mainnet completion. The broader 90% planning target remains separate.

The sealed b7df758 ZIP is unchanged. This review and new test commits are a
follow-up to be collected with the next consolidated delivery.
