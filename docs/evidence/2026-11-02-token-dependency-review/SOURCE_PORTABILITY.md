# Contract source portability and test routing evidence

See [the correction and limitations](../../SOURCE_PORTABILITY_2026-11-02.md).

- source-results.json: exact local token pins, source hashes and test scopes.
- source-before.json: prior artifact fields and raw/normalized source hashes.
- source-comparison.json / source-*-artifact.json: actual fresh outputs, exact ABI/reference checks and executable-byte comparison with metadata excluded.
- source-*-build.log / source-*-tooling.log: forced builds and seven source/routing regressions per token.
- source-*-contracts-fixed.log / history.log / wallet.log: passing local EVM and Wallet compatibility checks.
- source-DAT-complete-check.log: final complete standard DAT pipeline including 251 read-only cases.
- source-legacy-hardhat-failure.log: 288 pass, one failing support preload; the failure was fixed by correcting discovery.
- source-without-lf-policy-control.log: the checkout test fails when its source policy is omitted.
- source-*.patch and *-method.mjs: exact committed changes and historical local orchestration snapshots.

Logs are original bytes. Methods retain local paths and staged chronology; they
are not general-purpose installers. Fixture transactions/signatures are confined
to the synthetic local EVM. No real-wallet or independent-review gate is closed.
