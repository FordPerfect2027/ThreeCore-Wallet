/**
 * Untrusted AI proposals are data, never wallet authority.
 * This module permits only the existing read-only spender inspection. It does
 * not create model output, connect wallets, sign, send, bet, swap or grant access.
 */
import { parseSecurityJson } from "./security-json.js";
import { captureDataRecord } from "./security-data.js";
import { observeCallbackResult, readSynchronousClock } from "./security-callback.js";
import { AGENT_IDS, normalizeAddress, validateSiteOrigin } from "./wallet-session.js";
import { inspectDappSpender } from "./dapp-preflight.js";

const proposalErrors = new WeakMap();
export function agentProposalErrorCode(error) { return proposalErrors.get(error); }
export class AgentProposalError extends Error {
  constructor(code) {
    super(code);
    this.name = "AgentProposalError";
    this.code = code;
    proposalErrors.set(this, code);
  }
}
const fail = code => { throw new AgentProposalError(code); };
const STATE_KEYS = ["agent", "account", "chainId", "siteOrigin", "connected",
  "connectionEpoch", "canSign", "canSendTransactions", "canBridge"];
const PROPOSAL_KEYS = ["schema", "id", "agent", "account", "chainId", "siteOrigin",
  "connectionEpoch", "policyRevision", "createdAtMs", "expiresAtMs", "action", "rationale"];
const POLICY_KEYS = ["schema", "revision", "agent", "account", "chainId", "siteOrigin",
  "maxProposalAgeMs", "targets"];

function record(value, keys, code) {
  try { return captureDataRecord(value, keys); } catch { fail(code); }
}
function decode(text, keys, code) {
  try {
    const value = parseSecurityJson(text, {
      bytes: 32768, depth: 5, nodes: 512, keyCharacters: 64,
      stringCharacters: 2048, numberCharacters: 20,
    });
    return record(value, keys, code);
  } catch { fail(code); }
}
function uint(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}
function identifier(value, code) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value)) fail(code);
  return value;
}
function binding(value, code) {
  if (!AGENT_IDS.includes(value.agent) || ![8453, 84532].includes(value.chainId)) fail(code);
  try {
    return Object.freeze({ agent: value.agent, account: normalizeAddress(value.account),
      chainId: value.chainId, siteOrigin: validateSiteOrigin(value.siteOrigin) });
  } catch { fail(code); }
}
function pair(value, keys, code) {
  const data = record(value, keys, code);
  try {
    return Object.freeze({ tokenAddress: normalizeAddress(data.tokenAddress),
      spenderAddress: normalizeAddress(data.spenderAddress) });
  } catch { fail(code); }
}
function sameBinding(a, b) {
  return ["agent", "account", "chainId", "siteOrigin"].every(key => a[key] === b[key]);
}
function samePair(a, b) {
  return a.tokenAddress === b.tokenAddress && a.spenderAddress === b.spenderAddress;
}

/**
 * Pure review. The caller supplies trusted local policy and current session;
 * never take either from the model response. JSON is bounded and rejects
 * duplicate keys. Rationale is displayed data only, not a policy instruction.
 * Eligibility is NOT a reusable authorization token or proof of site safety.
 */
export function assessAgentReadProposal(proposalText, policyText, sessionState, nowMs) {
  uint(nowMs, "INVALID_CLOCK");
  const p = decode(proposalText, PROPOSAL_KEYS, "INVALID_PROPOSAL");
  const policy = decode(policyText, POLICY_KEYS, "INVALID_POLICY");
  const state = record(sessionState, STATE_KEYS, "INVALID_SESSION");
  if (p.schema !== "threecore-agent-read-proposal-v1") fail("INVALID_PROPOSAL");
  if (policy.schema !== "threecore-agent-read-policy-v1") fail("INVALID_POLICY");
  const id = identifier(p.id, "INVALID_PROPOSAL");
  const revision = identifier(policy.revision, "INVALID_POLICY");
  identifier(p.policyRevision, "INVALID_PROPOSAL");
  if (p.policyRevision !== revision) fail("POLICY_REVISION_MISMATCH");
  if (typeof p.rationale !== "string" || p.rationale.length > 1024 ||
      /[\u0000-\u001f\u007f]/.test(p.rationale)) fail("INVALID_PROPOSAL");
  const proposalBinding = binding(p, "INVALID_PROPOSAL");
  const policyBinding = binding(policy, "INVALID_POLICY");
  if (state.connected !== true) fail("DISCONNECTED");
  if (state.canSign !== false || state.canSendTransactions !== false || state.canBridge !== false) {
    fail("UNSAFE_CAPABILITIES");
  }
  const currentBinding = binding(state, "INVALID_SESSION");
  if (!sameBinding(proposalBinding, policyBinding)) fail("POLICY_BINDING_MISMATCH");
  if (!sameBinding(proposalBinding, currentBinding)) fail("SESSION_BINDING_MISMATCH");
  uint(state.connectionEpoch, "INVALID_SESSION");
  uint(p.connectionEpoch, "INVALID_PROPOSAL");
  if (p.connectionEpoch !== state.connectionEpoch) fail("SESSION_GENERATION_MISMATCH");
  uint(p.createdAtMs, "INVALID_PROPOSAL");
  uint(p.expiresAtMs, "INVALID_PROPOSAL");
  uint(policy.maxProposalAgeMs, "INVALID_POLICY");
  if (policy.maxProposalAgeMs === 0) fail("INVALID_POLICY");
  if (p.expiresAtMs <= p.createdAtMs ||
      p.expiresAtMs - p.createdAtMs > policy.maxProposalAgeMs) fail("INVALID_LIFETIME");
  if (p.createdAtMs > nowMs) fail("FUTURE_PROPOSAL");
  if (nowMs >= p.expiresAtMs || nowMs - p.createdAtMs > policy.maxProposalAgeMs) fail("EXPIRED_PROPOSAL");
  const action = record(p.action, ["kind", "tokenAddress", "spenderAddress"], "INVALID_ACTION");
  if (action.kind !== "inspect-spender") fail("ACTION_NOT_ALLOWED");
  const target = pair(action, ["kind", "tokenAddress", "spenderAddress"], "INVALID_ACTION");
  if (!Array.isArray(policy.targets) || policy.targets.length > 32) fail("INVALID_POLICY");
  const targets = policy.targets.map(t => pair(t, ["tokenAddress", "spenderAddress"], "INVALID_POLICY"));
  if (targets.some((t, index) => targets.slice(0, index).some(other => samePair(t, other)))) fail("INVALID_POLICY");
  if (!targets.some(t => samePair(t, target))) fail("TARGET_NOT_ALLOWED");
  return Object.freeze({
    schema: "threecore-agent-read-review-v1", proposalId: id,
    status: "eligible-for-read-only-inspection", ...proposalBinding,
    connectionEpoch: state.connectionEpoch, policyRevision: revision,
    checkedAtMs: nowMs, expiresAtMs: p.expiresAtMs,
    action: Object.freeze({ kind: "inspect-spender", ...target }),
    executed: false, grantsAuthority: false, securityAudit: false,
  });
}

/**
 * Explicit read-only integration, not an autonomous scheduler. Revalidate
 * trusted policy, clock and wallet state before/after EVERY subread, including
 * the final result. The callbacks and session must be application-owned.
 * No replay cache: repeating an eligible read is allowed, never a transaction.
 */
export async function inspectAgentReadProposal(session, proposalText, readPolicyText, clock) {
  if (typeof readPolicyText !== "function" || typeof clock !== "function") fail("INVALID_CONTEXT");
  const readPolicy = () => {
    const value = readPolicyText();
    if (observeCallbackResult(value) !== "synchronous" || typeof value !== "string") fail("INVALID_POLICY");
    return value;
  };
  const initialPolicy = readPolicy();
  let lastTime = -1;
  let checkedState;
  const check = () => {
    if (readPolicy() !== initialPolicy) fail("POLICY_CHANGED");
    const now = readSynchronousClock(clock);
    uint(now, "INVALID_CLOCK");
    if (now < lastTime) fail("CLOCK_MOVED_BACKWARD");
    lastTime = now;
    checkedState = record(session?.state, STATE_KEYS, "INVALID_SESSION");
    return assessAgentReadProposal(proposalText, initialPolicy, checkedState, now);
  };
  const initial = check();
  const guarded = {
    get state() { check(); return checkedState; },
  };
  for (const name of ["getBlockSnapshot", "getContractCode", "getTokenBalance", "getTokenAllowance"]) {
    if (typeof session?.[name] !== "function") fail("INVALID_SESSION");
    guarded[name] = async (...args) => {
      check();
      const result = await session[name](...args);
      check();
      return result;
    };
  }
  const observation = await inspectDappSpender(guarded, initial.action);
  const finalReview = check();
  return Object.freeze({
    schema: "threecore-agent-read-result-v1", status: "read-only-observation",
    proposalId: initial.proposalId, review: finalReview, observation,
    transactionExecuted: false, securityAudit: false,
  });
}
