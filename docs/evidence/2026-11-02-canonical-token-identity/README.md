# Canonical token identity evidence

Three full offline read-only runs (159 passed each) and three live Base Mainnet
observations. JSON records contain only public token data and source hashes.
The method snapshot has local path constants; adjust them before reproduction.
It creates a minimal child environment with an explicit public RPC endpoint.
It never imports Hardhat configuration or requests a wallet/private key.

The same token identity source was used for the tests and live reads. Before
the live run, source line endings were normalized to LF. Existing tracked
files' CRLF convention was retained before commit. source-and-results.json
checks normalized hashes and records exact committed source hashes.

Live reports requested canonical block hashes and rechecked the header and
network at the end. This is provider-observed evidence, not independent chain
verification, finality, deployed-source equivalence or real-wallet acceptance.
The runtime-code hash is a fingerprint, not a comparison against compiled code.
The original issued supply and deployed addresses were not changed.

No signing, transfer or approval transaction was performed. The open Zod
development-dependency advisory remains separate. Prior contract/Wallet test
runs were not relabelled as results of these new token commits.
