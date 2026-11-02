# Distribution checkpoint 16a0d33

See [the current distribution record](../../DISTRIBUTION_CHECKPOINT_2026-11-02.md)
and [the bounded dependency exposure review](../../ZOD_EXPOSURE_2026-11-02.md).

- distribution-16a0d33-package-receipt.json: Wallet/token source revisions and restored installation results.
- source-verification.json: all 4523 tracked Wallet files match the source ZIP.
- evidence-verification.json: all 253 manifests / 2434 entries match in the restored Git checkout.
- startup-verification.json: ten HTTP/startup checks on a separate server, then its shutdown.
- zip-receipt.json: final archive hash, size and all 56 outer entries matched after extraction.
- *-restored-runtime-install.log / *-restored-cli-verification.log: fresh minimal installs and DAT 51 / EMA 45 / CAWELON 45 selected cases.
- DAT-public-sepolia.json: actual historical recheck from the restored minimal runtime and default artifact, without a user wallet.
- ZOD-EXPOSURE* / TOOLCHAIN-METADATA*: bounded schema observations and dated public registry metadata; the development finding remains open.
- *-method.mjs: recorded local methods, with local paths and exact source scopes.

Earlier logs in this directory retain their original scopes. No full Wallet
browser regression was repeated for packaging. Dependencies are not bundled;
offline npm installation used an already populated cache. The original 4231
server and browser tabs were not operated. No real-wallet acceptance or
independent review is claimed.
