# Experimental local Zod 4 migration

This is a private ThreeCore development candidate based on Nomic Foundation's
MIT-licensed hardhat-zod-utils 3.0.8. It is not an upstream release or approved
remediation. Copyright and license are retained in LICENSE.

Source changes are limited to src/index.ts: use error.issues, migrate never's
error callback, use Zod 4 type parameters, require classic schemas for union
validation, copy forwarded issue fields and render symbol path labels as strings.
All public declarations and JavaScript are regenerated with TypeScript 6.0.3,
strict checking and skipLibCheck=false.

The isolated experiments passed 13 actual Hardhat network/compiler configuration
cases, eight focused regression cases and public helper/Hardhat type checks.
All three token contracts compiled with solc 0.8.34, producing identical ABI,
creation bytecode and runtime bytecode to their recorded current builds.
No user configuration, account, keystore, RPC, signature or transaction is used.

Release adoption requires full production dependency/plugin integration, complete
project regression, reproducible tarball installation and independent review.
Those checks need separate receipts; this archive alone does not establish them.
Existing project dependencies and published packages are unchanged.
This candidate is not evidence that every unbounded validation path is bounded.
