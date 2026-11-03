import { createHash } from "node:crypto";
import { operationBudgetExample, encodeOperationBudget } from "../../src/operation-budget.js";
import { SHARED_BUDGET_SCHEMA, encodeSharedOperationBudget } from "../../src/shared-operation-budget.js";
import { BUDGET_EVIDENCE_SCHEMA, encodeBudgetEvidence } from "../../src/operation-budget-evidence.js";
import { prepareTokenIdentityFile } from "../../src/token-identity-report.js";
import { OPERATION_PROPOSAL_SCHEMA, PROPOSAL_POLICY_SCHEMA } from "../../src/operation-proposal.js";
import { observation } from "./identity-fixtures.js";
export const proposalHash = text => createHash("sha256").update(text).digest("hex");
export async function proposalFixture({ agent = "DAT", shared = false, nowSeconds = 1793690000 } = {}) {
  const agents = shared ? ["DAT", "EMA", "CAWELON"] : [agent];
  const budgets = agents.map(id => { const b = structuredClone(operationBudgetExample()); b.agent = id; b.fees.operatorFeeBudgetWei = "0"; return b; });
  const observations = budgets.map(b => observation({ balanceBaseUnits: b.token.balanceUnits, nativeBalanceBaseUnits: b.native.balanceWei }, b.agent, b.chainId));
  const evidence = { schema: BUDGET_EVIDENCE_SCHEMA,
    budgetFile: shared ? encodeSharedOperationBudget({ schema: SHARED_BUDGET_SCHEMA, simulationOnly: true, sameAccount: true, budgets }) : encodeOperationBudget(budgets[0]),
    observationFiles: await Promise.all(observations.map(async o => (await prepareTokenIdentityFile(o)).text)) };
  const evidenceText = encodeBudgetEvidence(evidence), b = budgets.find(row => row.agent === agent), o = observations.find(row => row.agent === agent);
  const dapp = { origin: "https://example.invalid", contract: "0x" + "55".repeat(20) };
  const proposal = { schema: OPERATION_PROPOSAL_SCHEMA, reviewOnly: true, proposalId: "synthetic-plan-1", source: { kind: "ai", label: "Synthetic fixture, no model call" },
    agent, chainId: b.chainId, account: o.account, tokenAddress: o.tokenAddress, dapp,
    spendUnits: b.token.spendUnits, nativeValueWei: b.native.valueWei, createdAtSeconds: nowSeconds - 30, expiresAtSeconds: nowSeconds + 300,
    budgetEvidenceSha256: proposalHash(evidenceText), rationale: "Fictional allocation plan for testing source and policy comparison." };
  const policy = { schema: PROPOSAL_POLICY_SCHEMA, reviewOnly: true, agent, chainId: b.chainId, account: o.account, tokenAddress: o.tokenAddress,
    allowedDapps: [{ ...dapp }], maxTokenSpendUnits: b.token.spendUnits, maxNativeValueWei: "0", maxTotalFeeWei: "1000000000000000",
    validFromSeconds: nowSeconds - 60, expiresAtSeconds: nowSeconds + 600, maxProposalLifetimeSeconds: 600 };
  return { proposal, policy, evidenceText, evidence, budgets, observations, nowSeconds };
}
