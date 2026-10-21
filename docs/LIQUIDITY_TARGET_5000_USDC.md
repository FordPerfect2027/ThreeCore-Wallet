# ThreeCore liquidity-depth objective

**Owner:** FordPrefect2026 / ThreeCore (DAT · EMA · CAWELON)  
**Decision date:** 2026-10-20  
**Scope:** USDC-side reserves in each existing Aerodrome **Classic volatile** pool on Base Mainnet.

## Agreed objective

| Pair | USDC-side reserve target |
| --- | ---: |
| DAT / native USDC | 5,000 USDC |
| EMA / native USDC | 5,000 USDC |
| CAWELON / native USDC | 5,000 USDC |
| **All three pools** | **15,000 USDC** |

The metric is the **on-chain USDC reserve** as observed at a specified block, not a promise to deposit USDC and not a measure of total pool TVL, portfolio value, locked assets, token-holder balance or sustainable trading volume. Progress resets or changes with swaps, other LP contributions/withdrawals and pool price changes. Each pool must meet its target separately; one pool's excess must not offset another pool's shortfall.

**Illustrative observation only (2026-10-20, Base Mainnet block 52853036):** DAT 100 USDC, EMA 100 USDC and CAWELON 100 USDC, each 2.00% of the target. Corresponding **reserve gaps** at that block are 4,900 USDC each, or 14,700 USDC combined. These are not committed LP deposits; rerun the on-chain inspector for new observations.

## Read-only verification

The existing `src/aerodrome-pools.js` queries the published Aerodrome Classic PoolFactory at a single Base Mainnet block, checks token0/token1 and reads pool reserves. The new `src/liquidity-target.js` calculates per-pool and aggregate target progress with exact `BigInt` arithmetic; it never signs or transmits a transaction. Run:

```bash
npm test
npm run liquidity:progress
npm run liquidity:progress -- --json
```

The CLI reads public RPC data live, shows the block number, reserves, individual gaps, and percent completion. A missing or unverifiable pool is reported as **UNVERIFIED**, not as zero liquidity. At most this is evidence of the **Classic volatile** pool state queried; other Aerodrome pool types and DEX venues may have separate balances.

## LP risk and operational boundaries

1. **No authorization to add liquidity or spend any funds.** This target establishes a planning metric only. Actual deposits, allowances, swaps, treasury transfers and wallet signatures require separate explicit authorization.
2. **Two-sided contributions.** A typical balanced contribution uses approximately the existing token/USDC value ratio. The target tracker exposes a *raw token-unit proportional illustration*, not a runnable quote. The exact contribution will depend on current reserves, token decimals, fees, available assets, gas, pool share and interface transaction details.
3. **Price, slippage and liquidity risk.** Increasing USDC reserve is not guaranteed to generate trading volume, maintain a token price, establish independent demand, prevent manipulation or deliver investment returns. Thin pools are prone to high price impact. LPs can lose value through adverse price changes (impermanent loss) and smart-contract vulnerabilities.
4. **No automatic funding.** Do not perform deposits or artificially create trades to reach target metrics. Organic traders and third-party LPs can alter reserves without any ThreeCore funding action.
5. **Wallet / DEX integration remains separate.** ThreeCore Wallet's local EIP-1193 and EIP-6963 connection modules and read-only on-chain checks do **not** mean that an actual browser wallet has successfully interacted with Aerodrome's external website or that an authorized trading execution path exists.
6. **Security and secrets.** Never provide private keys or seed phrases to this repository or a site. On-chain addresses and reserves are public; do not expose unrelated personal account information.

**Next engineering priorities:** improved read-only reporting and observable block-based checkpoints; browser-wallet external dApp compatibility validation without transactions; transaction simulation and explicit user-permission architecture before considering any live swaps or LP operations.

**Not in scope:** CAW game gateway development, undefined game/platform features, alterations to existing Base Mainnet ERC-20 supply or contracts.
