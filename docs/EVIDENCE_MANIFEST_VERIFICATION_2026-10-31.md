# Verify saved evidence files locally

Continuation items 411–413. Source revision `e3b9958`.

411. A bounded SHA-256 manifest parser accepts standard text/binary checksum rows, LF/CRLF and an optional UTF-8 BOM. It supports portable relative filenames, including Japanese names. It rejects absolute/traversal paths, Windows alternate streams and device names, control characters, ambiguous endings and duplicate paths after separator/case/Unicode normalization. Parsing is limited to 256 KiB and 1,024 entries and completes before artifact inspection starts.

412. A read-only verifier resolves each referenced file beneath the manifest's real parent, rejects external targets, directories, self-reference and duplicate resolved aliases, and streams bytes into SHA-256 without loading an entire large artifact. Empty and binary files are supported. Opened-file metadata and path binding are checked before/after inspection; changes are reported instead of treated as a stable match. The manifest's own hash identifies the exact checksum list read. Default limits are 64 MiB per file and 512 MiB admitted per manifest; callers may lower but not raise them.

413. A standalone offline command emits a structured result distinguishing matches, content mismatches and unreadable/missing files. It does not modify files or make network or wallet requests. Invalid manifests/arguments produce no partial verification output. The result explicitly does not authenticate the origin of the evidence: changing both a file and its checksum list can still produce a match.

## Use

Keep each checksum list beside its corresponding evidence files and preserve subfolders. From the repository folder:

```sh
node scripts/verify-evidence-manifest.js docs/evidence/2026-10-31-rehearsal-review-pages/SHA256SUMS.txt
```

Use the path of the evidence folder you want to inspect. `allMatched` is true only when every listed entry matches. `manifestSha256` identifies the checksum list itself; each file result retains the expected hash and, after a successful read, the actual hash. Exit code 0 means all entries match; 2 means readable evidence has content mismatches; 1 means invalid input, a read failure or at least one unreadable entry. The checker reads the files currently on disk, not a hypothetical Git revision.

## Validation

- Manifest/core/CLI and existing bounded-local-file regression tests: **66 passed**, zero failed/skipped/cancelled; **647.8286 ms**. Cases include exact binary/empty/Unicode files, corrupt and missing files, malformed/oversized manifests, file/aggregate limits, immutable inputs, standard CLI exit states, outside-directory junctions and duplicate aliases.
- The new verifier checked all **98 previously tracked manifests**, covering **540 files / 35,817,550 bytes**; every file matched. The complete machine-readable corpus result records source `e3b9958aae5ff43448cf842d29b94505e9cd7a89`.
- The standalone command independently verified all **8 files** listed by the item 407 evidence manifest.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-manifest-verification/`.

The ledger is **413 / 600**. The corpus check is validation, not an extra item. Browser application files were unchanged in this batch; the latest native checkpoint remains 849 cases at `9f93f32`, and the most recent full-wallet checkpoint remains 14,512 tests at `0cd49b6`. Local synthetic or previously saved evidence only; no real signatures, transfers, approvals, keys, publication, deployment or existing-server restart.
