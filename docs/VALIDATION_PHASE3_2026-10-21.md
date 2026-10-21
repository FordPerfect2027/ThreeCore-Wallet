# Token–Wallet integration validation — 2026-10-21

## Completed locally

- Wallet regression suite: **162 passed**, zero failures or skipped tests.
- Actual local EVM integration: **18 passed per token**, **54 total**, zero failures or skipped tests.
- Integration uses each repository's compiled DATCore, EMACore or CAWELONCore and locked Hardhat dependencies. ABI return values come from the local EVM; account permission is synthetic.
- No real wallet, remote fork, production signature, transfer, approval, trading or liquidity operation is used. The simulated EVM alone executes fixture deployments, approvals, delegated transfers and burns.

## Fixes demonstrated by failing regressions

The previous composite preflight compared account, chain and origin but could miss a disconnect/reconnect to the same account after one subread completed. Four regression cases reproduced this at both code reads, the balance read and the allowance read. The new `state.connectionEpoch` is checked before and after each subread. A stale composite report rejects with `SESSION_CHANGED`; a fresh report after explicit reconnection remains usable.

Preflight now also requires a valid epoch and rejects raw ERC-20 values above uint256. The boundary test suite had six failing cases before these fixes (four reconnect cases, invalid epoch, overflowing amount); the maximum valid uint256 still round-trips through JSON exactly. Custom session implementations must provide the epoch as documented in README.

## Integration coverage

Each token runs nine cases on each simulated chain ID, 8453 and 84532:

1. Name, symbol, decimals, full initial holder balance and native balance.
2. EOA spender, missing spender bytecode notice and zero allowance.
3. Existing finite allowance to an address with bytecode.
4. Maximum uint256 allowance decoded and serialized without loss.
5. Balance and reduced allowance after local delegated spending.
6. Reduced supply/balance after local burn and zero allowance after revocation.
7. Missing token bytecode yields null amounts and no ERC-20 call.
8. Wrong chain rejects before synthetic account permission.
9. Empty account does not inherit the initial holder's balance or allowance.

The provider bridge rejects non-read methods and permits only balanceOf/allowance calldata against the fixture token. Preflight checks assert unchanged EVM block height, holder transaction count, supply, holder balance, spender allowance and permit nonce. A second local token serves only as a bytecode fixture; it is not an Aerodrome router.

## Reproduction and CI

With Node 22 or later, check out a token repository and this Wallet repository. From the token directory:

```sh
npm ci
npm run compile
node --test ../ThreeCore-Wallet/integration/token-compatibility.test.mjs
```

Adjust the relative Wallet path to the actual checkout location. The integration runner rejects an unknown package, a non-simulated `hardhatOp` configuration or any remote-fork configuration. No RPC URL or private key is needed.

Wallet GitHub Actions tests its current checkout against pinned token baselines:

| Repository | Baseline |
| --- | --- |
| DAT | `78bb53fb92ed9b10b1e77ffc37f9de760e098a47` |
| EMA-Draft | `80fe79518156ffd03fffcfe97e51e473aa25d650` |
| CAWELON-Draft | `2bae8cf36ff0fb1db662bc39b30ccdb689a71ade` |

The token repositories additionally run their current contracts against a pinned Wallet integration checkout. Pin updates require an explicit reviewed change; these jobs do not silently follow an untested remote main.

## Remaining limits

- The chain IDs above do not turn the local EVM into Base Mainnet or Base Sepolia. Production deployment identity is not rechecked by this suite.
- The official Aerodrome synthetic probe inherited from `4848c39b60bac2c63fc38f685cdef12cd96290a8` and the earlier validation evidence remains the external-site evidence; this phase does not rerun it. Completed real-wallet sign-in and full external-dApp compatibility remain unverified.
- Browser-session preflight still reads `latest`; successive reads may span different blocks even within one connection epoch.
- Bytecode presence and unit/integration test success are not an independent security audit or a guarantee of liquidity, router behavior, prices or trade execution.
- No game development or artificial line-count expansion was performed.
