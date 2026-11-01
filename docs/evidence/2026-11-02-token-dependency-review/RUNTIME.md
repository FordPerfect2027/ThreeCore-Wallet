# Runtime installation evidence

See [the installation correction](../../READ_ONLY_RUNTIME_2026-11-02.md).
The original full-development audit and repair records in this directory are
historical and unchanged. Their production-only audit predates moving viem to
runtime dependencies; it must not be presented as a new audit of this graph.

- runtime-baseline-* reproduces the original DAT missing-viem startup failure.
- runtime-classification-probe.json compares npm's lock flags and records that
  ordinary --omit=dev installs 21 packages, including optional Zod/TypeScript.
- runtime-*-install.log / runtime-*-readonly.log record three independent fresh
  19-package installations with --omit=dev --omit=optional and 213 passing cases.
- runtime-verified-results.json records installed package lists, counts and source
  package fingerprints. JSON metadata of the tested exports equals committed
  package metadata; DAT's generated trial package used LF, source uses CRLF.
- runtime-source-commits.json identifies the committed changes and file hashes.
- runtime-*-collector-failure.log retains the initial summary-format failures
  after successful test subprocesses. The spec and TAP reporters use different
  summary markers. The corrected collector accepts both and checks all counters.
- runtime-*-method.mjs are method snapshots with local path constants. They are
  records, not turnkey reproduction scripts. Use the documented fresh-checkout
  commands for reproduction; adapt paths only if replaying the probe itself.

Package versions/resolved URLs/integrity values and contract/read-only sources
did not change. The full development Zod advisory remains open. No live RPC,
wallet permission, signature, transfer or new remote CI run occurred here.
