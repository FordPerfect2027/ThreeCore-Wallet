# Verify the tracked evidence collection

Continuation item 414. Source revision `1acf7f2`.

A new read-only command discovers the repository's tracked SHA256SUMS.txt files and verifies them as one bounded collection. It requires the actual repository root, ignores untracked checksum lists and rejects outside-repository paths, duplicate resolved manifest aliases and unsafe tracked names. No fetch, stage, commit or other repository mutation is performed by the checker. Git inspection has bounded output and time limits; at most 512 manifests are accepted (increased from 256 on November 3 as the tracked collection grew). The shared 512 MiB artifact-admission budget, per-file limits and path checks are unchanged.

All manifests share a 512 MiB artifact-admission budget rather than receiving independent unlimited allowances. The single-manifest result now includes `admittedBytes` so collection accounting also covers a file whose read fails after admission. Callers may lower the total budget. Files that cannot be read, missing lists and malformed manifests remain explicit failures while other evidence is checked. A changed HEAD or tracked-manifest listing invalidates the collection result.

## Use

From the repository root:

```sh
node scripts/verify-evidence-collection.js .
```

The JSON result includes the observed HEAD revision, complete manifest/file results and combined totals. `workingTreeFiles: true` means the command checks files currently on disk, including unstaged changes; it does not pretend that their contents are the committed snapshot. Checks are sequential and do not freeze the filesystem. A matching checksum collection does not authenticate its origin or prove token safety.

Exit code 0 means every tracked manifest and listed artifact matched. Exit code 2 means content mismatches with no unreadable/invalid manifests. Exit code 1 means invalid arguments, repository discovery failure, missing/unreadable evidence, invalid manifests or a changed collection listing. An empty tracked collection is not reported as successful validation.

## Validation

- Collection, single-manifest and existing bounded-local-file checks: **76 passed**, zero failed/skipped/cancelled; **10,238.3704 ms**. Temporary repositories cover unstaged corruption, ignored untracked lists, missing manifests/artifacts, invalid lists, a shared budget, nested-root rejection, outside-directory junctions, duplicate aliases, absence of tracked evidence, invalid arguments and unchanged Git/file state. Test commits use synthetic identities, disabled signing and isolated empty hooks; they do not touch the user's repository.
- The standalone command verified all **99 previously tracked manifests / 544 files / 36,068,011 bytes** at `1acf7f2fb4d30bc7c3cf14653a3754450e608b78`. No mismatches or unreadable files were reported.
- The exact CLI JSON output and test log are in `evidence/2026-10-31-evidence-collection/`, with their SHA-256 manifest.

The ledger is **414 / 600**. Tests and corpus counts are validation, not extra development items. Browser application files were unchanged in this batch; the latest native checkpoint remains 849 cases at `9f93f32`, and the most recent full-wallet checkpoint remains 14,512 tests at `0cd49b6`. No real signatures, transfers, approvals, keys, external RPC, publication, deployment or existing-server restart.
