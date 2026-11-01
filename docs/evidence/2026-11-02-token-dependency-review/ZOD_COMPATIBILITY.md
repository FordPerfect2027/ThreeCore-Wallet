# Zod compatibility probe evidence

See [the decision and scope](../../ZOD_COMPATIBILITY_2026-11-02.md).

- zod-compatibility-result.json: bounded before/after results, package identity,
  helper hash, peer requirement and scope flags.
- zod-compatibility-source-check.json: identical installed helper hashes for the
  three clean source repositories; only DAT's helper copy was executed.
- zod-compatibility-*-install.log and *-package-lock.json: two distinct public
  package installations with lifecycle scripts disabled and no shared modules.
- zod-compatibility-*-probe.log: three bounded fictional configuration cases.
  Baseline returns a structured validation error; the v4 candidate throws there.
- zod-compatibility-probe.mjs: exact fixture inputs, with no user configuration.
- zod-compatibility-method.mjs: orchestration snapshot with local paths, which
  copies the official installed helper unchanged. The helper itself is not
  redistributed here; fetch the recorded 3.0.6 package and verify its hash.

This is a targeted compatibility finding. It does not exercise the advisory with
oversized inputs, run a full build, resolve the advisory or replace an independent
review. Source repositories and existing dependency directories were unchanged.
