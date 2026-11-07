import test from "node:test";
import assert from "node:assert/strict";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { createAgentProposalController } from "../src/agent-proposal-controller.js";

const address = n => "0x" + String(n).repeat(40);
const NOW = 1800000000000;
const hash = "0x" + "ab".repeat(32);
function cfg(agent = "DAT", index = 1) {
  return { schema: "threecore-agent-read-config-v1", agent, account: address(index), chainId: 84532,
    siteOrigin: "https://fixture.example", maxProposalAgeMs: 1000,
    targets: [{ tokenAddress: address(4), spenderAddress: address(5) }] };
}
const matches = expected => error => error?.code === expected;
test("startup has no implied permissions or production defaults", () => {
  const registry = createAgentReadPolicyRegistry();
  assert.equal(registry.readPolicyText("DAT"), null);
  assert.deepEqual(registry.snapshot().map(s => s.policy), [null, null, null]);
});
test("each agent has its own immutable policy and exact serialized context", () => {
  const registry = createAgentReadPolicyRegistry();
  for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
    const policy = registry.set(agent, JSON.stringify(cfg(agent, index + 1)));
    assert.equal(policy.revision, `${agent}:${index + 1}`);
    assert.equal(registry.read(agent), policy);
    assert.deepEqual(JSON.parse(registry.readPolicyText(agent)), policy);
    assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.targets) && Object.isFrozen(policy.targets[0]));
  }
});
test("duplicate account cannot silently replace another AI's wallet, even across chains", () => {
  const registry = createAgentReadPolicyRegistry();
  registry.set("DAT", JSON.stringify(cfg()));
  const other = cfg("EMA", 1); other.chainId = 8453;
  assert.throws(() => registry.set("EMA", JSON.stringify(other)), matches("DEDICATED_ACCOUNT_REQUIRED"));
  assert.equal(registry.read("EMA"), null);
  assert.equal(registry.read("DAT").revision, "DAT:1");
});
test("replacing or revoking one policy leaves the others unchanged", () => {
  const registry = createAgentReadPolicyRegistry();
  registry.set("DAT", JSON.stringify(cfg()));
  const ema = registry.set("EMA", JSON.stringify(cfg("EMA", 2)));
  registry.set("DAT", JSON.stringify(cfg("DAT", 3)));
  assert.equal(registry.read("DAT").revision, "DAT:3");
  registry.revoke("DAT");
  assert.equal(registry.readPolicyText("DAT"), null);
  assert.equal(registry.read("EMA"), ema);
  assert.equal(registry.set("DAT", JSON.stringify(cfg())).revision, "DAT:5");
});
test("unchanged explicit reconfiguration still invalidates the previous revision", () => {
  const registry = createAgentReadPolicyRegistry(); const input = JSON.stringify(cfg());
  registry.set("DAT", input); const before = registry.readPolicyText("DAT");
  registry.set("DAT", input);
  assert.notEqual(registry.readPolicyText("DAT"), before);
});
for (const [name, change] of [
  ["model revision", c => { c.revision = "model-approved"; }],
  ["privileged scope", c => { c.allowTransfers = true; }],
  ["unsupported chain", c => { c.chainId = 1; }],
  ["arbitrary endpoint path", c => { c.siteOrigin += "/path"; }],
  ["missing expiry policy", c => { delete c.maxProposalAgeMs; }],
  ["negative expiry policy", c => { c.maxProposalAgeMs = -1; }],
  ["target calldata", c => { c.targets[0].data = "0x00"; }],
  ["duplicate target", c => { c.targets.push(c.targets[0]); }],
]) {
  test(`invalid ${name} leaves the active revision unchanged`, () => {
    const registry = createAgentReadPolicyRegistry(); const initial = registry.set("DAT", JSON.stringify(cfg()));
    const c = cfg(); change(c);
    assert.throws(() => registry.set("DAT", JSON.stringify(c)), matches("INVALID_POLICY_CONFIG"));
    assert.equal(registry.read("DAT"), initial);
    assert.equal(registry.set("DAT", JSON.stringify(cfg())).revision, "DAT:2");
  });
}
test("wrong agent and duplicate JSON keys cannot change the policy", () => {
  const registry = createAgentReadPolicyRegistry();
  assert.throws(() => registry.set("DAT", JSON.stringify(cfg("EMA", 2))), matches("POLICY_AGENT_MISMATCH"));
  const duplicate = JSON.stringify(cfg()).replace('"agent":', '"agent":"EMA","agent":');
  assert.throws(() => registry.set("DAT", duplicate), matches("INVALID_POLICY_CONFIG"));
  assert.equal(registry.read("DAT"), null);
});
for (const operation of ["revoke", "replace", "revoke-and-restore"]) {
  test(`${operation} during an in-flight read rejects the result through the real controller`, async () => {
    const registry = createAgentReadPolicyRegistry(); const c = cfg();
    const policy = registry.set("DAT", JSON.stringify(c));
    const { agent, account, chainId, siteOrigin } = c;
    const state = { agent, account, chainId, siteOrigin, connected: true, connectionEpoch: 1,
      canSign: false, canSendTransactions: false, canBridge: false };
    const calls = [];
    const session = { state,
      async getBlockSnapshot() {
        calls.push("block");
        if (operation !== "replace") registry.revoke("DAT");
        if (operation !== "revoke") registry.set("DAT", JSON.stringify(c));
        return { number: "0x2a", hash };
      },
      async getContractCode() { calls.push("unexpected-code"); },
      async getTokenBalance() { calls.push("unexpected-balance"); },
      async getTokenAllowance() { calls.push("unexpected-allowance"); },
    };
    const controller = createAgentProposalController({ agent, getSession: () => session,
      readPolicyText: () => registry.readPolicyText(agent), now: () => NOW });
    const proposal = { schema: "threecore-agent-read-proposal-v1", id: "fixture-1", agent, account, chainId, siteOrigin,
      policyRevision: policy.revision, connectionEpoch: 1, createdAtMs: NOW, expiresAtMs: NOW + 1000,
      rationale: "Fixture only", action: { kind: "inspect-spender", ...c.targets[0] } };
    assert.equal(await controller.inspect(JSON.stringify(proposal)), false);
    assert.equal(controller.state.status, "rejected");
    assert.equal(controller.state.errorCode, operation === "revoke" ? "INVALID_POLICY" : "POLICY_CHANGED");
    assert.deepEqual(calls, ["block"]);
  });
}
