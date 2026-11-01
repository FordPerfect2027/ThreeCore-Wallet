# Follow-up: canonical balance and reference-quote reads

Each token's complete read-only suite passed 194 cases, including the earlier
identity correction. The 69 focused state cases are a subset of that total.
Seven actual child-process CLI cases preserve real viem HTTP request bodies
while a test-only preload redirects the fixed endpoint to a local mock RPC.
They do not call a public network or wallet.

Initial failures are retained: two assertions expected lowercase addresses
although ABI decoding uses checksum capitalization; seven CLI cases could not
start because Windows Node --import requires a file URL. The corrected test
expectations/loader are in the pinned commits. The failed runs were not hidden
or treated as passes, and production protections were not relaxed.

Six later live public RPC observations succeeded: a public-account readiness
read and a pool reference quote for each token. Different commands capture
different blocks. Full account/balance results remain local; redacted receipts
record their hash and source fingerprints, and cannot substitute for access to
the private original when independently reproducing those exact balances.
Public quote responses are included in full and are not trade instructions.

State sources match the exact committed bytes used by each live command.
The prior identity-only records retain their original bytes and revision.
The new state-source-and-results.json identifies the newer token commits.
Solidity, deployment files and dependency locks did not change. The remaining
Zod advisory and actual-wallet UI acceptance are still open.
