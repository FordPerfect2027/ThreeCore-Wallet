# Synthetic external-dApp privileged-RPC evidence guard

Scope: `src/external-dapp-report.js`, used to **interpret** observations from the isolated, unfunded Aerodrome EIP-1193/EIP-6963 simulation. This guard does not initiate a wallet connection, sign a message, or make an on-chain transaction.

## Behavior

- Inspect recorded RPC method names across page load, connect and sign-in snapshots, plus structured RPC trace events. Do not rely solely on the final snapshot's list.
- Report `privilegedRpcRequested` and unique `privilegedRpcMethods` for signing (other than `personal_sign`), transaction submission, wallet calls, permission grants/revocation and network changes. A rejected privileged request still invalidates a *clean* simulation result.
- Count `personal_sign` attempts and code-4001 refusals: every recorded request must have a matching refusal. An unmatched second request is **not** reported as safely refused.
- Never infer real-wallet sign-in, actual transaction execution or external dApp compatibility from a synthetic probe. `completedSignIn` and `realWalletUsed` remain `false`.

## Verification

Run `npm test` on a clean checkout with Node 22+, including `test/external-privileged-rpc-boundary.test.js`. Offline isolated tests exercise the pure reporting function; full repository CI is required before merging. Reports are based only on captured observations: truncated, missing or compromised traces cannot prove that no unrecorded RPC call occurred. This guard is a diagnostic aid, not a security audit or an authorization policy for production wallets.

## Non-goals

No real wallet, seed phrase, private key, funds, production chain deployment, approvals, swaps, bridge, LP addition or game integration is used or altered.
