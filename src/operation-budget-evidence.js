import { captureDataRecord, captureDataArray, sha256Hex } from "./security-data.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { OperationBudgetError, OPERATION_BUDGET_SCHEMA, OPERATION_BUDGET_LIMIT, decodeOperationBudget, evaluateOperationBudget } from "./operation-budget.js";
import { SHARED_BUDGET_SCHEMA, SHARED_BUDGET_LIMIT, decodeSharedOperationBudget, evaluateSharedOperationBudget } from "./shared-operation-budget.js";
import { decodeTokenIdentityFile, IDENTITY_FILE_LIMIT } from "./token-identity-report.js";
import { assessTokenObservation } from "./token-identity-model.js";
import { PUBLIC_TOKEN_BATCH_FILE_SCHEMA, decodePublicTokenBatchFile, publicBatchObservations } from "./public-token-batch-model.js";

export const BUDGET_EVIDENCE_SCHEMA = "threecore.operation-budget-evidence.v1";
export const BUDGET_EVIDENCE_LIMIT = 196608;
const fail = code => { throw new OperationBudgetError(code); };
const bytes = text => new TextEncoder().encode(text);
function bounded(text, limit) { try { boundedUtf8Length(text, limit); } catch { fail("FILE_TOO_LARGE"); } return text; }
function capture(input) {
  let data, observations;
  try {
    data = captureDataRecord(input, ["schema", "budgetFile", "observationFiles"]);
    observations = captureDataArray(data.observationFiles, 3, 1);
  } catch { fail("INVALID_EVIDENCE_STRUCTURE"); }
  if (data.schema !== BUDGET_EVIDENCE_SCHEMA) fail("INVALID_EVIDENCE_SCHEMA");
  return Object.freeze({ schema: BUDGET_EVIDENCE_SCHEMA, budgetFile: bounded(data.budgetFile, SHARED_BUDGET_LIMIT),
    observationFiles: Object.freeze(observations.map(text => bounded(text, IDENTITY_FILE_LIMIT))) });
}
export function encodeBudgetEvidence(input) {
  const text = JSON.stringify(capture(input), null, 2) + "\n";
  return bounded(text, BUDGET_EVIDENCE_LIMIT);
}
export function decodeBudgetEvidence(text) {
  bounded(text, BUDGET_EVIDENCE_LIMIT); let data;
  try { data = parseSecurityJson(text); } catch { fail("INVALID_JSON"); }
  return capture(data);
}

/** Compare saved statements; neither their checksum nor agreement authenticates a chain balance. */
export async function inspectBudgetEvidence(input, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  const data = capture(input), options = { subtle, signal, timeoutMs };
  let raw;
  try { raw = parseSecurityJson(data.budgetFile); } catch { fail("INVALID_JSON"); }
  let budgetResult, budgets;
  if (raw?.schema === OPERATION_BUDGET_SCHEMA) {
    bounded(data.budgetFile, OPERATION_BUDGET_LIMIT);
    budgetResult = evaluateOperationBudget(decodeOperationBudget(data.budgetFile)); budgets = [budgetResult.input];
  } else if (raw?.schema === SHARED_BUDGET_SCHEMA) {
    budgetResult = evaluateSharedOperationBudget(decodeSharedOperationBudget(data.budgetFile)); budgets = budgetResult.input.budgets;
  } else fail("INVALID_BUDGET_SCHEMA");
  const observations = [], sourceHashes = [];
  for (const text of data.observationFiles) {
    let sourceSchema;
    try { sourceSchema = parseSecurityJson(text)?.schema; } catch { fail("INVALID_JSON"); }
    if (sourceSchema === PUBLIC_TOKEN_BATCH_FILE_SCHEMA) {
      const decoded = await decodePublicTokenBatchFile(text, options);
      observations.push(...publicBatchObservations(decoded.batch).filter(o => budgets.some(b => b.agent === o.agent)));
    } else {
      const decoded = await decodeTokenIdentityFile(bytes(text), options);
      observations.push(decoded.observation);
    }
    sourceHashes.push(await sha256Hex(bytes(text), subtle, { signal, timeoutMs }));
  }
  if (new Set(observations.map(o => o.agent)).size !== observations.length) fail("DUPLICATE_SOURCE_AGENT");
  const groupReasons = [], first = observations[0];
  if (observations.length !== budgets.length || observations.some(o => !budgets.some(b => b.agent === o.agent))) groupReasons.push("SOURCE_SET_MISMATCH");
  for (const [field, code] of [["account", "SOURCE_ACCOUNT_MISMATCH"], ["chainId", "SOURCE_NETWORK_MISMATCH"],
    ["blockNumber", "SOURCE_BLOCK_MISMATCH"], ["blockHash", "SOURCE_BLOCK_MISMATCH"], ["nativeBalanceBaseUnits", "SOURCE_ETH_MISMATCH"]])
    if (observations.some(o => o[field] !== first[field]) && !groupReasons.includes(code)) groupReasons.push(code);
  const comparisons = budgets.map(budget => {
    const observation = observations.find(o => o.agent === budget.agent), reasons = [];
    if (!observation) reasons.push("SOURCE_MISSING");
    else {
      if (observation.source === "public-rpc" ? !observation.identityMatches : assessTokenObservation(observation).status !== "matched")
        reasons.push("TOKEN_IDENTITY_UNCONFIRMED");
      if (observation.chainId !== budget.chainId) reasons.push("BUDGET_NETWORK_MISMATCH");
      if (observation.metadata?.decimals !== budget.token.decimals) reasons.push("BUDGET_DECIMALS_MISMATCH");
      if (observation.balanceBaseUnits !== budget.token.balanceUnits) reasons.push("BUDGET_TOKEN_BALANCE_MISMATCH");
      if (observation.nativeBalanceBaseUnits !== budget.native.balanceWei) reasons.push("BUDGET_ETH_BALANCE_MISMATCH");
    }
    return Object.freeze({ agent: budget.agent, consistent: reasons.length === 0, reasons: Object.freeze(reasons), observation: observation ?? null });
  });
  return Object.freeze({ schema: "threecore.operation-budget-evidence-result.v1", input: data, budgetResult,
    sourceHashes: Object.freeze(sourceHashes), budgetHash: await sha256Hex(bytes(data.budgetFile), subtle, { signal, timeoutMs }),
    comparisons: Object.freeze(comparisons), groupReasons: Object.freeze(groupReasons),
    consistent: groupReasons.length === 0 && comparisons.every(c => c.consistent), checksumsVerified: true,
    historicalOnly: true, authenticated: false, currentBalanceVerified: false, authorizesExecution: false });
}
