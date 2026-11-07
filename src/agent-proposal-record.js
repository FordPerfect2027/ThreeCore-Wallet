/** Historical evidence codec. Importing a record never restores authority. */
import { parseSecurityJson } from "./security-json.js";
import { captureDataRecord } from "./security-data.js";
import { assessAgentReadProposal } from "./agent-read-proposal.js";
import { AGENT_IDS } from "./wallet-session.js";

export const AGENT_PROPOSAL_RECORD_LIMIT = 131072;
export class AgentProposalRecordError extends Error {
  constructor(code) { super(code); this.name = "AgentProposalRecordError"; this.code = code; }
}
const fail = code => { throw new AgentProposalRecordError(code); };
const keys = (value, names) => captureDataRecord(value, names);
const parse = text => parseSecurityJson(text, { bytes: AGENT_PROPOSAL_RECORD_LIMIT,
  depth: 12, nodes: 2048, keyCharacters: 64, stringCharacters: 32768, numberCharacters: 80 });
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
}
function freeze(value) {
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
function amount(value) {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n);
}

/**
 * Verifies internal consistency at the recorded observation time, not now.
 * All fields remain unauthenticated caller data; no RPC, registry or session is
 * created. A consistent forged record can pass: this is NOT chain verification.
 */
export function parseAgentProposalRecord(text, agent) {
  if (!AGENT_IDS.includes(agent)) fail("INVALID_AGENT");
  try {
    const record = keys(parse(text), ["schema", "authenticated", "historicalObservation", "proposalText", "policyText", "result"]);
    if (record.schema !== "threecore-agent-proposal-ui-record-v1" || record.authenticated !== false || record.historicalObservation !== true) fail("INVALID_RECORD");
    const proposal = parse(record.proposalText);
    if (proposal.agent !== agent) fail("RECORD_AGENT_MISMATCH");
    const result = keys(record.result, ["schema", "status", "proposalId", "review", "observation", "transactionExecuted", "securityAudit"]);
    if (result.schema !== "threecore-agent-read-result-v1" || result.status !== "read-only-observation" ||
        result.proposalId !== proposal.id || result.transactionExecuted !== false || result.securityAudit !== false) fail("INVALID_RECORD");
    const state = { agent: proposal.agent, account: proposal.account, chainId: proposal.chainId,
      siteOrigin: proposal.siteOrigin, connectionEpoch: proposal.connectionEpoch,
      connected: true, canSign: false, canSendTransactions: false, canBridge: false };
    const review = assessAgentReadProposal(record.proposalText, record.policyText, state, result.review?.checkedAtMs);
    if (!same(review, result.review)) fail("INVALID_RECORD");
    const o = keys(result.observation, ["agent", "account", "chainId", "siteOrigin", "connectionEpoch",
      "blockNumber", "blockHash", "tokenAddress", "spenderAddress", "tokenHasCode", "spenderHasCode",
      "tokenBalanceBaseUnits", "existingAllowanceBaseUnits", "notices", "readOnly", "securityAudit"]);
    for (const key of ["agent", "account", "chainId", "siteOrigin", "connectionEpoch"]) {
      if (o[key] !== review[key]) fail("INVALID_RECORD");
    }
    if (o.tokenAddress !== review.action.tokenAddress || o.spenderAddress !== review.action.spenderAddress ||
        !amount(o.blockNumber) || typeof o.blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(o.blockHash) ||
        typeof o.tokenHasCode !== "boolean" || typeof o.spenderHasCode !== "boolean" ||
        o.readOnly !== true || o.securityAudit !== false) fail("INVALID_RECORD");
    if (o.tokenHasCode ? !amount(o.tokenBalanceBaseUnits) || !amount(o.existingAllowanceBaseUnits)
      : o.tokenBalanceBaseUnits !== null || o.existingAllowanceBaseUnits !== null) fail("INVALID_RECORD");
    const notices = [];
    if (!o.tokenHasCode) notices.push("TOKEN_CODE_MISSING");
    if (!o.spenderHasCode) notices.push("SPENDER_CODE_MISSING");
    if (!same(notices, o.notices)) fail("INVALID_RECORD");
    return freeze({ ...record, result: { ...result, review, observation: { ...o } } });
  } catch (error) {
    if (error instanceof AgentProposalRecordError) throw error;
    fail("INVALID_RECORD");
  }
}
