import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentProposalRecord, AgentProposalRecordError } from "../src/agent-proposal-record.js";
import { assessAgentReadProposal } from "../src/agent-read-proposal.js";

const A = "0x" + "11".repeat(20), T = "0x" + "22".repeat(20), S = "0x" + "33".repeat(20);
function fixture(agent = "DAT", chainId = 84532) {
  const binding = { agent, chainId, account: A, siteOrigin: "https://fixture.example" };
  const p = { schema: "threecore-agent-read-proposal-v1", id: "historical-1", ...binding,
    connectionEpoch: 4, policyRevision: "old:1", createdAtMs: 1000, expiresAtMs: 2000,
    rationale: "Historical read", action: { kind: "inspect-spender", tokenAddress: T, spenderAddress: S } };
  const policy = { schema: "threecore-agent-read-policy-v1", revision: "old:1", ...binding,
    maxProposalAgeMs: 1000, targets: [{ tokenAddress: T, spenderAddress: S }] };
  const state = { ...binding, connectionEpoch: 4, connected: true, canSign: false, canSendTransactions: false, canBridge: false };
  const proposalText = JSON.stringify(p), policyText = JSON.stringify(policy);
  return { schema: "threecore-agent-proposal-ui-record-v1", authenticated: false, historicalObservation: true,
    proposalText, policyText, result: { schema: "threecore-agent-read-result-v1", status: "read-only-observation", proposalId: p.id,
      review: assessAgentReadProposal(proposalText, policyText, state, 1500),
      observation: { ...binding, connectionEpoch: 4, blockNumber: "42", blockHash: "0x" + "ab".repeat(32),
        tokenAddress: T, spenderAddress: S, tokenHasCode: true, spenderHasCode: true,
        tokenBalanceBaseUnits: "7", existingAllowanceBaseUnits: "0", notices: [], readOnly: true, securityAudit: false },
      transactionExecuted: false, securityAudit: false } };
}
for (const agent of ["DAT", "EMA", "CAWELON"]) for (const chain of [8453, 84532]) {
  test(`${agent}/${chain}: expired historical record round trips without creating authority`, () => {
    const record = fixture(agent, chain);
    const decoded = parseAgentProposalRecord(JSON.stringify(record), agent);
    assert.deepEqual(JSON.parse(JSON.stringify(decoded)), record);
    assert.equal(decoded.authenticated, false); assert.equal(decoded.historicalObservation, true);
    assert.ok(Object.isFrozen(decoded.result.observation.notices));
    assert.ok(Object.isFrozen(decoded.result.review.action));
  });
}
const mutations = [
  ["authenticated claim", r => { r.authenticated = true; }],
  ["live claim", r => { r.historicalObservation = false; }],
  ["extra field", r => { r.secret = "no"; }],
  ["wrong ID", r => { r.result.proposalId = "different"; }],
  ["transfer claim", r => { r.result.transactionExecuted = true; }],
  ["audit claim", r => { r.result.securityAudit = true; }],
  ["wrong state", r => { r.result.status = "executed"; }],
  ["review extra", r => { r.result.review.extra = true; }],
  ["review account", r => { r.result.review.account = T; }],
  ["review time", r => { r.result.review.checkedAtMs = 2000; }],
  ["observation account", r => { r.result.observation.account = T; }],
  ["observation agent", r => { r.result.observation.agent = "EMA"; }],
  ["chain", r => { r.result.observation.chainId = 8453; }],
  ["epoch", r => { r.result.observation.connectionEpoch++; }],
  ["origin", r => { r.result.observation.siteOrigin = "https://other.example"; }],
  ["target", r => { r.result.observation.spenderAddress = T; }],
  ["unsafe number", r => { r.result.observation.tokenBalanceBaseUnits = 7; }],
  ["overflow", r => { r.result.observation.tokenBalanceBaseUnits = (1n << 256n).toString(); }],
  ["negative", r => { r.result.observation.existingAllowanceBaseUnits = "-1"; }],
  ["leading zero", r => { r.result.observation.blockNumber = "042"; }],
  ["hash", r => { r.result.observation.blockHash = "0x00"; }],
  ["missing code with amount", r => { r.result.observation.tokenHasCode = false; }],
  ["missing notice", r => { r.result.observation.spenderHasCode = false; }],
  ["unexpected notice", r => { r.result.observation.notices = ["SAFE_TO_BUY"]; }],
  ["null amount with code", r => { r.result.observation.tokenBalanceBaseUnits = null; }],
  ["observation audit", r => { r.result.observation.securityAudit = true; }],
];
for (const [name, change] of mutations) {
  test(`reject inconsistent record: ${name}`, () => {
    const r = structuredClone(fixture()); change(r);
    assert.throws(() => parseAgentProposalRecord(JSON.stringify(r), "DAT"), e => e instanceof AgentProposalRecordError && e.code === "INVALID_RECORD");
  });
}
test("no-code records preserve unknown amounts, not fabricated zero balances", () => {
  const r = fixture(); Object.assign(r.result.observation, { tokenHasCode: false, spenderHasCode: false,
    tokenBalanceBaseUnits: null, existingAllowanceBaseUnits: null, notices: ["TOKEN_CODE_MISSING", "SPENDER_CODE_MISSING"] });
  assert.equal(parseAgentProposalRecord(JSON.stringify(r), "DAT").result.observation.tokenBalanceBaseUnits, null);
});
test("other agent and unknown agent are rejected", () => {
  assert.throws(() => parseAgentProposalRecord(JSON.stringify(fixture()), "EMA"), e => e.code === "RECORD_AGENT_MISMATCH");
  assert.throws(() => parseAgentProposalRecord(JSON.stringify(fixture()), "OTHER"), e => e.code === "INVALID_AGENT");
});
test("duplicate keys, unsafe keys and oversized data are rejected", () => {
  const text = JSON.stringify(fixture());
  for (const bad of [text.replace('"authenticated":false', '"authenticated":true,"authenticated":false'),
    text.replace('"authenticated":false', '"__proto__":{},"authenticated":false'), " ".repeat(131073), null, fixture()]) {
    assert.throws(() => parseAgentProposalRecord(bad, "DAT"), e => e.code === "INVALID_RECORD");
  }
});
test("internally consistent fabricated balances are not mislabelled authenticated", () => {
  const r = fixture(); r.result.observation.tokenBalanceBaseUnits = "123456789";
  const imported = parseAgentProposalRecord(JSON.stringify(r), "DAT");
  assert.equal(imported.authenticated, false); assert.equal(imported.result.securityAudit, false);
});
