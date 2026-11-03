# ThreeCore development update — approximately 80%

November 3, 2026. **The current provisional planning estimate is approximately
80% across ThreeCore Token, Wallet, AI and dApp.** Development now prioritizes
features close to completion, with implementation, verification and recoverable
evidence completed together.

The previous approximately 75% checkpoint covered the isolated swap integration.
Public fee acquisition, the integrated source package and fresh-state checks now
connect that work into a broader review-and-recovery workflow. The current
[whole-project scope](WHOLE_PROJECT_SCOPE_2026-11-03.md) records the basis and
remaining work.

## What readers can check

| Completed work | Direct evidence |
| --- | --- |
| Public token and USDC balance reads, separate token/ETH budgets, shared ETH/USDC reservations and source-preserving comparison | [USDC budgets](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/USDC_BUDGET_2026-11-03.md), [public USDC screen](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/USDC_READ_UI_2026-11-03.md) |
| Manual proposals and usage conditions carried into quote, allowance and fee review without changing the original sources | [Proposal authoring](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/MANUAL_PROPOSAL_DRAFT_2026-11-03.md), [existing allowance review](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/PROPOSAL_ALLOWANCE_2026-11-03.md) |
| Six isolated DAT/EMA/CAWELON buy/sell executions with pinned Aerodrome contracts, 24 negative controls and reconciled balance/fee changes | [Isolated execution report](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/ISOLATED_AERODROME_AND_FEES_2026-11-03.md) |
| Fixed-call fee review, actual Base fee-oracle reads, bounds and saved evidence | [Public fee acquisition](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/PUBLIC_PROPOSAL_FEES_2026-11-03.md) |
| New-block balance, allowance and fee checks that preserve the original deadline, minimum output and shared reservations | [Fresh-state report](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/PROPOSAL_CURRENT_STATE_2026-11-03.md), [public RPC trace](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/evidence/2026-11-03-proposal-current-state/public-rpc-trace.json) |
| A complete four-repository package restored into fresh folders, with actual browser restoration of nine Wallet histories | [Integrated recovery report](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/INTEGRATED_PROPOSAL_DELIVERY_2026-11-03.md) |

These are direct links to the recorded source checkpoint, so the evidence stays
identifiable as development continues. Actual public observations, controlled RPC
fixtures, isolated EVM execution and browser recovery are labeled separately.

## Recorded verification

- The integrated Wallet baseline at `288efc3` passed **16,730 Node/HTTP cases** and
  **1,026 synthetic browser cases**. The restored version served **267 matching
  assets**; **292 evidence manifests / 3,223 files** matched at that checkpoint.
- The later fresh-state feature passed **183 related cases** and **2 ordinary
  server cases**. These totals overlap other suites and are not added together.
- Actual Account 2 public diagnostics used blocks **53,463,194** and
  **53,463,239**. USDC balance and allowance were **0**, and ETH was **0.0007**.
  The preserved example proposal was expired and insufficient, so the result
  correctly stayed blocked. No public swap was attempted.
- The browser saved and reopened the new state record, then reexported the exact
  **29,528 bytes**. A later time check preserved the observation and source,
  added the expiry reason and produced a separate record.

The [saved browser result](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/evidence/2026-11-03-proposal-current-state/browser-review.json)
and [file comparison](https://github.com/FordPerfect2027/ThreeCore-Wallet/blob/22279f02598cbdfc16f94ed8805eec826898c515/docs/evidence/2026-11-03-proposal-current-state/browser-verification.json)
can be inspected directly. The stored review can also be replayed locally:

```text
node scripts/read-proposal-state.js verify docs/evidence/2026-11-03-proposal-current-state/browser-review.json
```

Exit 2 means the saved file is valid and its recorded conditions remain blocked;
exit 1 means validation failed. The comparison does not grant transaction authority.

## Token source checkpoints

The consolidated Wallet workflow references these exact companion sources:

- DAT: https://github.com/FordPerfect2027/DAT/tree/c50aae41b9c7aa496833e6260cc3314dc3c3fbfb
- EMA: https://github.com/FordPerfect2027/EMA-Draft/tree/a37c60574e279980b5ce90775842d27b9c4ce5eb
- CAWELON: https://github.com/FordPerfect2027/CAWELON-Draft/tree/0f5dfa00a6e1738df3706e12e59b48459ff875a0

## Work still ahead

Policy-author authentication, persistent replay prevention, final public
contract/source/permission configuration and product transaction execution remain
open. Product AI connection is intentionally deferred. The public success path
for a currently eligible funded proposal remains to be checked; isolated swaps
do not stand in for that observation.

Source publication makes this checkpoint reviewable. It does not deploy contracts
or move funds. User-Wallet signing, transfers, approval transactions and private-key
access were not used. Development continues toward the broader 90% target.
