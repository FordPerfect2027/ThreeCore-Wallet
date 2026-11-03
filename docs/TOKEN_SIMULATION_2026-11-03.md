# Applied token toolchain: complete local simulation follow-up

The existing contract and event-history suites now pass in all three actual
token checkouts with the applied private Zod helper. Earlier applied checks
covered installation, compilation, types and pure decoding but had not rerun
these suites. This follow-up closes that functional regression gap.

| Token | Fixed source | Contract-suite cases | Local history cases |
| --- | --- | ---: | ---: |
| DAT | `dc2535732e9b83bddd8c5f4a2208c65fdff0a6d1` | 37 | 10 |
| EMA | `cae4130e8e01fd325fdcb6a589a46338be08b27e` | 39 | 10 |
| CAWELON | `9fc0ffa988f5b9a80d75d7f95b80e6a759f1610d` | 39 | 10 |

All **115 contract-suite and 30 event-history cases** passed at 13:48–13:49 JST
on November 3. DAT's suite includes two existing market-context normalization
cases. These are test cases, not completed product features or a percentage.
No tests were skipped. The three source trees remained clean, and each complete
artifact JSON and helper archive still matched the sealed `128ee11` package.
No dependency installation or compilation was needed for this run.

## Execution boundary

Each existing suite explicitly uses Hardhat's `hardhatOp` simulated EVM. Before
execution, each actual resolved configuration was checked for `edr-simulated`
and absence of a remote fork. The dependency directories are three independent
real directories. Processes received a filtered environment and CI mode, which
the installed keystore hook checks before initializing a keystore.

The tests intentionally create disposable local contracts and exercise synthetic
transfers, approvals, burns and permit signatures using the simulator's accounts.
They never use MetaMask, user accounts, user keys, a public-chain deployment or
real assets. No user-wallet signature or transaction was requested or performed.

A preload rejected JavaScript fetch, HTTP, HTTPS, TLS and socket connection
calls. Its positive controls rejected fetch and TCP before dispatch. Final test
runs recorded zero network attempts. Each contract invocation made one attempt
to connect to a Windows named pipe used by `tsx` for parent-process messaging;
these three local IPC attempts were also rejected and the suites still passed.
The guard is a JavaScript observation/control layer, not an OS network boundary;
the independent simulated/no-fork configuration check remains part of the evidence.

The original wrapper first used a Windows drive path where Node's `--import`
requires a file URL, so it failed before running tests. After correcting that,
the first contract runs passed but the wrapper misclassified the blocked named
pipe as network traffic. Source and captured stack inspection identified `tsx`'s
`getPipePath(process.ppid)`. The final wrapper records that category separately
without allowing the connection. All final contract and history runs passed.

## Covered behavior and remaining review

The contract suites cover fixed supply and metadata, normal and rejected
transfers, allowance/supply invariants, burn behavior and permit authorization
boundaries. History checks use locally mined events to verify mint/transfer/
self-transfer/burn reads, Approval versus consumed allowance, maximum approval
and revocation, pinned allowance, removed/conflicting events, replacement blocks
and unchanged state after reads. They do not establish current public-chain
balances or live transaction behavior.

The [summary](evidence/2026-11-03-token-simulation/summary.json),
[execution method](evidence/2026-11-03-token-simulation/run.mjs),
[network guard](evidence/2026-11-03-token-simulation/deny-network.mjs), final logs
and [checksums](evidence/2026-11-03-token-simulation/SHA256SUMS.txt) retain the exact
pins and results. Original output is also in
`Downloads/ThreeCore-local-token-simulation-20261103/`.
Paths in the reproduction method must be adapted to another machine.

Independent review of the helper source and its maintenance/release decision
remain open. This successful simulation does not supply that approval or prove
90% completion. Existing servers and user pages were untouched; no GitHub
write occurred.
