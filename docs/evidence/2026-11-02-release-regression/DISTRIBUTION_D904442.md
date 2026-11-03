# Distribution checkpoint d904442

See [the checkpoint record](../../DISTRIBUTION_CHECKPOINT_2026-11-02.md).
This is a newer distribution record in the same evidence directory. The older
regression logs above retain their original source scopes and are not new runs.

- distribution-d904442-package-receipt.json: fixed Wallet and token revisions,
  restoration results, current lock hashes and the prior compiled-artifact scope.
- distribution-d904442-source-verification.json: exact source ZIP comparison.
- distribution-d904442-evidence-verification.json: evidence in the restored Git
  checkout with normal Windows line-ending behavior; no mismatches.
- distribution-d904442-historical-verification.json: historical-record invariants.
- distribution-d904442-startup-verification.json: ten HTTP/startup checks on a
  separate temporary server, which was closed by its own process.
- distribution-d904442-zip-receipt.json: final ZIP bytes/hash and complete manifest
  verification before compression and after extraction into another empty folder.
- distribution-d904442-*-restored-runtime-install.log: fresh minimal installations
  in three restored token checkouts, using the previously populated npm cache.
- distribution-d904442-*-restored-cli-verification.log: 30 command/input cases
  per token using local fixtures; these overlap the earlier 213-case suites.
- distribution-d904442-*-method.mjs: method snapshots with local path constants.

No existing node_modules was linked/shared. Cache-assisted offline installation
does not mean dependencies are included in the package or that an unprepared PC
can build offline. Full contract/Wallet regressions were not rerun. The original
4231 server and browser tabs were preserved. No real-wallet acceptance, independent
review, signing, transaction, public RPC or remote publication is claimed here.
