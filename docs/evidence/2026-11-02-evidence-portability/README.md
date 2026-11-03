# Windows Git evidence round-trip

Read [the scope and diagnosis](../../EVIDENCE_PORTABILITY_2026-11-02.md).

- `before.log`: two new Git round-trip tests before `.gitattributes`; one passed,
  Windows conversion failed. This is intentionally a retained failure.
- `after.log`: all 63 focused tests passed after the policy was added.
- `checkout-before.json`: initial a39b099 normal-Windows checkout; 460 mismatches.
- `eol-diagnosis.json`: every mismatch equals exact original LF-to-CRLF conversion.
- `checkout-after.json`: fresh c53cb26 checkout; 248 manifests / 2,231 entries,
  zero mismatches or unreadable files, 99,579,385 verified bytes.
- `checkout-receipt.json`: full revision, inherited true conversion setting,
  clean checkout, no setting override and successful historical verifier.
- `historical-verification.json`: saved historical-record consistency result;
  no new chain read occurred.

`SHA256SUMS.txt` covers these seven files and this README. It does not include
itself. These hashes detect byte changes; they do not authenticate a publisher,
wallet owner or chain response. The checkout reports predate this evidence
folder, so their 248-manifest counts intentionally exclude it.

Reproduce the fixture and integrity tests from the repository root:

```powershell
node --test --test-timeout=60000 --test-concurrency=2 test/evidence-git-roundtrip.test.js test/evidence-collection.test.js test/evidence-manifest.test.js test/source-checkpoint.test.js
node scripts/verify-evidence-collection.js .
node docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs
```

The final local delivery receipt separately verifies the bundle in an empty
repository, exact source ZIP bytes and startup. No remote CI/publication or
independent review is represented by these local records.
