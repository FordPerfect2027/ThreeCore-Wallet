import { captureDataRecord, captureDataArray, captureOptionalDataFields, sha256Hex } from "./security-data.js";
import { boundedUtf8Length, parseSecurityJson } from "./security-json.js";
import { BUDGET_EVIDENCE_LIMIT, decodeBudgetEvidence, inspectBudgetEvidence } from "./operation-budget-evidence.js";

export const OPERATION_PROPOSAL_SCHEMA = "threecore.operation-proposal.v1";
export const PROPOSAL_POLICY_SCHEMA = "threecore.proposal-review-policy.v1";
export const PROPOSAL_FILE_LIMIT = 32768;
export class OperationProposalError extends Error {
  constructor(code) { super(code); this.name = "OperationProposalError"; this.code = code; }
}
const fail = code => { throw new OperationProposalError(code); };
const MAX = (1n << 256n) - 1n;
function record(value, keys) { try { return captureDataRecord(value, keys); } catch { fail("INVALID_STRUCTURE"); } }
function address(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) fail("INVALID_ADDRESS");
  return value.toLowerCase();
}
function amount(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > MAX) fail("INVALID_AMOUNT");
  return value;
}
function time(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799) fail("INVALID_TIME");
  return value;
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail("INVALID_TEXT");
  return value;
}
function dapp(input) {
  const data = record(input, ["origin", "contract"]);
  if (typeof data.origin !== "string" || data.origin.length > 256 || !/^https:\/\/[a-z0-9.-]+(?::[1-9][0-9]{0,4})?$/.test(data.origin)) fail("INVALID_DAPP_ORIGIN");
  let url; try { url = new URL(data.origin); } catch { fail("INVALID_DAPP_ORIGIN"); }
  if (url.origin !== data.origin) fail("INVALID_DAPP_ORIGIN");
  return Object.freeze({ origin: data.origin, contract: address(data.contract) });
}
function context(data) {
  if (!["DAT", "EMA", "CAWELON"].includes(data.agent) || ![8453, 84532].includes(data.chainId)) fail("INVALID_CONTEXT");
  return { agent: data.agent, chainId: data.chainId, account: address(data.account), tokenAddress: address(data.tokenAddress) };
}
function bounded(value, max = PROPOSAL_FILE_LIMIT) {
  try { boundedUtf8Length(value, max); } catch { fail("FILE_TOO_LARGE"); }
  return value;
}

/** A proposal is untrusted descriptive data, never a transaction or wallet command. */
export function validateOperationProposal(input) {
  const data = record(input, ["schema", "reviewOnly", "proposalId", "source", "agent", "chainId", "account", "tokenAddress", "dapp",
    "spendUnits", "nativeValueWei", "createdAtSeconds", "expiresAtSeconds", "budgetEvidenceSha256", "rationale"]);
  if (data.schema !== OPERATION_PROPOSAL_SCHEMA || data.reviewOnly !== true) fail("REVIEW_ONLY_REQUIRED");
  if (typeof data.proposalId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(data.proposalId)) fail("INVALID_PROPOSAL_ID");
  const source = record(data.source, ["kind", "label"]);
  if (!["manual", "ai"].includes(source.kind)) fail("INVALID_PROPOSAL_SOURCE");
  const createdAtSeconds = time(data.createdAtSeconds), expiresAtSeconds = time(data.expiresAtSeconds);
  if (createdAtSeconds >= expiresAtSeconds) fail("INVALID_TIME_RANGE");
  if (typeof data.budgetEvidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.budgetEvidenceSha256)) fail("INVALID_EVIDENCE_HASH");
  return Object.freeze({ schema: OPERATION_PROPOSAL_SCHEMA, reviewOnly: true, proposalId: data.proposalId,
    source: Object.freeze({ kind: source.kind, label: text(source.label, 80) }), ...context(data), dapp: dapp(data.dapp),
    spendUnits: amount(data.spendUnits), nativeValueWei: amount(data.nativeValueWei), createdAtSeconds, expiresAtSeconds,
    budgetEvidenceSha256: data.budgetEvidenceSha256, rationale: text(data.rationale, 2000) });
}

/** Local comparison assumptions; this file cannot grant a wallet permission. */
export function validateProposalReviewPolicy(input) {
  const data = record(input, ["schema", "reviewOnly", "agent", "chainId", "account", "tokenAddress", "allowedDapps", "maxTokenSpendUnits",
    "maxNativeValueWei", "maxTotalFeeWei", "validFromSeconds", "expiresAtSeconds", "maxProposalLifetimeSeconds"]);
  if (data.schema !== PROPOSAL_POLICY_SCHEMA || data.reviewOnly !== true) fail("REVIEW_ONLY_REQUIRED");
  let targets; try { targets = captureDataArray(data.allowedDapps, 16, 1); } catch { fail("INVALID_DAPP_LIST"); }
  const allowedDapps = targets.map(dapp);
  if (new Set(allowedDapps.map(t => t.origin + "|" + t.contract)).size !== allowedDapps.length) fail("DUPLICATE_DAPP");
  const validFromSeconds = time(data.validFromSeconds), expiresAtSeconds = time(data.expiresAtSeconds);
  if (validFromSeconds >= expiresAtSeconds) fail("INVALID_TIME_RANGE");
  if (!Number.isSafeInteger(data.maxProposalLifetimeSeconds) || data.maxProposalLifetimeSeconds < 1 || data.maxProposalLifetimeSeconds > 86400)
    fail("INVALID_LIFETIME_LIMIT");
  return Object.freeze({ schema: PROPOSAL_POLICY_SCHEMA, reviewOnly: true, ...context(data), allowedDapps: Object.freeze(allowedDapps),
    maxTokenSpendUnits: amount(data.maxTokenSpendUnits), maxNativeValueWei: amount(data.maxNativeValueWei), maxTotalFeeWei: amount(data.maxTotalFeeWei),
    validFromSeconds, expiresAtSeconds, maxProposalLifetimeSeconds: data.maxProposalLifetimeSeconds });
}
function decode(value, validate) {
  bounded(value); let raw; try { raw = parseSecurityJson(value); } catch { fail("INVALID_JSON"); }
  return validate(raw);
}
export const decodeOperationProposal = text => decode(text, validateOperationProposal);
export const decodeProposalReviewPolicy = text => decode(text, validateProposalReviewPolicy);
export const encodeOperationProposal = input => bounded(JSON.stringify(validateOperationProposal(input), null, 2) + "\n");
export const encodeProposalReviewPolicy = input => bounded(JSON.stringify(validateProposalReviewPolicy(input), null, 2) + "\n");

/** Recompute source-linked budgets, then compare the proposal at an explicit evaluation time. No network or wallet calls. */
export async function inspectOperationProposal(proposalInput, policyInput, budgetEvidenceText, options = {}) {
  const proposal = validateOperationProposal(proposalInput), policy = validateProposalReviewPolicy(policyInput);
  bounded(budgetEvidenceText, BUDGET_EVIDENCE_LIMIT);
  let settings; try { settings = captureOptionalDataFields(options, ["nowSeconds", "subtle", "signal", "timeoutMs"]); } catch { fail("INVALID_OPTIONS"); }
  const evaluatedAtSeconds = time(settings.nowSeconds ?? Math.floor(Date.now() / 1000));
  const crypto = { subtle: settings.subtle, signal: settings.signal, timeoutMs: settings.timeoutMs };
  const evidenceHash = await sha256Hex(new TextEncoder().encode(budgetEvidenceText), settings.subtle, crypto);
  // Bind exact file bytes before spending more effort on the nested records.
  if (evidenceHash !== proposal.budgetEvidenceSha256) fail("BUDGET_EVIDENCE_HASH_MISMATCH");
  const evidence = await inspectBudgetEvidence(decodeBudgetEvidence(budgetEvidenceText), crypto);
  const reasons = [], add = code => { if (!reasons.includes(code)) reasons.push(code); };
  for (const key of ["agent", "chainId", "account", "tokenAddress"])
    if (proposal[key] !== policy[key]) add("POLICY_CONTEXT_MISMATCH");
  if (!policy.allowedDapps.some(t => t.origin === proposal.dapp.origin && t.contract === proposal.dapp.contract)) add("DAPP_NOT_ALLOWED");
  if (evaluatedAtSeconds < proposal.createdAtSeconds) add("PROPOSAL_NOT_YET_VALID");
  if (evaluatedAtSeconds >= proposal.expiresAtSeconds) add("PROPOSAL_EXPIRED");
  if (evaluatedAtSeconds < policy.validFromSeconds) add("POLICY_NOT_YET_VALID");
  if (evaluatedAtSeconds >= policy.expiresAtSeconds) add("POLICY_EXPIRED");
  if (proposal.createdAtSeconds < policy.validFromSeconds || proposal.expiresAtSeconds > policy.expiresAtSeconds) add("PROPOSAL_OUTSIDE_POLICY_WINDOW");
  if (proposal.expiresAtSeconds - proposal.createdAtSeconds > policy.maxProposalLifetimeSeconds) add("PROPOSAL_LIFETIME_EXCEEDED");
  if (proposal.spendUnits === "0") add("ZERO_TOKEN_SPEND");
  if (BigInt(proposal.spendUnits) > BigInt(policy.maxTokenSpendUnits)) add("TOKEN_SPEND_LIMIT");
  if (BigInt(proposal.nativeValueWei) > BigInt(policy.maxNativeValueWei)) add("NATIVE_VALUE_LIMIT");
  if (!evidence.consistent) add("BUDGET_SOURCE_INCONSISTENT");
  if (!evidence.budgetResult.constraintsSatisfied) add("BUDGET_CONSTRAINTS_UNSATISFIED");
  const rows = evidence.budgetResult.results ?? [evidence.budgetResult];
  const budget = rows.find(row => row.input.agent === proposal.agent);
  const observation = evidence.comparisons.find(row => row.agent === proposal.agent)?.observation;
  if (!budget || !observation) add("PROPOSAL_SOURCE_MISSING");
  if (observation && ["chainId", "account", "tokenAddress"].some(key => observation[key] !== proposal[key])) add("PROPOSAL_SOURCE_CONTEXT_MISMATCH");
  if (budget) {
    if (budget.input.chainId !== proposal.chainId || budget.input.token.spendUnits !== proposal.spendUnits || budget.input.native.valueWei !== proposal.nativeValueWei)
      add("PROPOSAL_BUDGET_MISMATCH");
    if (budget.plannedFeeBudgetWei === null) add("FEE_BUDGET_UNKNOWN");
    if (BigInt(budget.knownFeeBudgetWei) > BigInt(policy.maxTotalFeeWei)) add("FEE_BUDGET_LIMIT");
  }
  return Object.freeze({ schema: "threecore.operation-proposal-review.v1", reviewOnly: true, evaluatedAtSeconds,
    proposal, policy, evidenceHash, evidence, reasons: Object.freeze(reasons), checksSatisfied: reasons.length === 0,
    historicalOnly: true, currentStateVerified: false, sourceAuthorAuthenticated: false, policyAuthorityVerified: false,
    dappSafetyVerified: false, simulationExecuted: false, replayChecked: false, authorizesExecution: false });
}
