# Evidence portability correction — November 2, 2026

Preparing the offline review package exposed two distribution defects. Neither
was visible in the developer's clean checkout. The package is local only;
publication remains deferred. These checks do not finish real-wallet acceptance
or independent review.

## Missing history in the first bundle

The source repository was shallow at `421fb5c8762c1a7eeb1c97ebcad72120f4c0a70c`.
Although `git bundle verify` accepted the initial bundle, a new empty repository
could not traverse its missing parent `1ea9e7acbbd726a927401f512c1d8afc8f58723e`.
A read-only `git fetch --unshallow --no-tags github main` obtained that history.
It did not change the candidate HEAD or working source and performed no remote
write. Recreating the bundle then allowed a fresh offline checkout at the full
`a39b0996ee2cf9fe03d57b87f37451980d2328e6` revision.

The original incomplete bundle remains separate in local temporary storage.
Bundle verification alone is insufficient; the delivery procedure must actually
fetch into a new empty repository and compare the resulting commit.

## Windows checkout changed checksummed evidence

The source ZIP matched all 4,300 Git files at `a39b099`, but a normal Windows Git
checkout reported **460 mismatching entries out of 2,231**, across 248 manifests.
The developer repository had `core.autocrlf=false`, whereas the fresh checkout
inherited the Windows installation's `core.autocrlf=true`. Every mismatch was
reproduced byte-for-byte by converting the original file's LF endings to CRLF.
The [diagnosis record](evidence/2026-11-02-evidence-portability/eol-diagnosis.json)
records original/checkout hashes and sizes for all 460 entries.

Revision `c53cb2628dc2b85e530d36b6f26248bf84acd013` adds the narrow Git attribute
`/docs/evidence/** -text`. It preserves the bytes originally recorded, including
native CRLF logs, LF JSON/text and mixed-line-ending files. Other source files
still follow the user's checkout setting. No global Git setting, original
evidence byte, expected checksum, integrity validator or application code changed.

## Regression and fresh-checkout results

- Before the policy, the new miniature Git round-trip suite passed with
  `core.autocrlf=false` and failed with `true` (three of six fixture artifacts
  changed). The failure is retained.
- After the policy, all **63 focused tests** passed: Git round-trip, evidence
  manifest/collection and source checkpoint. The fixtures use real Git clones,
  the repository's actual attributes, LF/CRLF/mixed/binary artifacts and unchanged
  hashes. A source file outside the evidence tree must still convert with `true`,
  proving the test has not disabled conversion globally.
- A new full checkout of `c53cb26` inherited `core.autocrlf=true` without an
  override. All **248 manifests / 2,231 entries / 99,579,385 bytes** verified,
  with zero mismatches/unreadable files and a clean Git working tree.
- The historical verifier also passed: 149 files, 39 recorded RPC ranges,
  30 Chrome batch reads / 60 files and six cross-checks, with zero incoming events
  in that recorded scope. It used saved files only; these are not new RPC reads.

The two new round-trip cases are included in the 63 focused tests, not additions
to the earlier full-suite totals. The earlier 16,445 Node/HTTP, 1,019 synthetic
browser and 150 token-artifact compatibility results remain bound to their
recorded revisions. The metadata/test-only correction did not require repeating
those full suites. The final package's separate receipt covers its later
documentation commit and the additional evidence folder.

Logs, before/after collection reports and checksums are in the
[evidence folder](evidence/2026-11-02-evidence-portability/README.md).
The existing port 4231 process and user tabs were preserved. No signing,
transaction, secret-key access or GitHub publication was performed.
