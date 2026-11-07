/** Application-owned, memory-only configuration. Never feed model output here. */
import { parseSecurityJson } from "./security-json.js";
import { captureDataRecord } from "./security-data.js";
import { AGENT_IDS, normalizeAddress, validateSiteOrigin } from "./wallet-session.js";
import { AgentProposalError } from "./agent-read-proposal.js";

const fail = code => { throw new AgentProposalError(code); };
const CONFIG_KEYS = ["schema", "agent", "account", "chainId", "siteOrigin", "maxProposalAgeMs", "targets"];
function agentId(agent) { if (!AGENT_IDS.includes(agent)) fail("INVALID_AGENT"); return agent; }
function config(text) {
  try {
    const raw = parseSecurityJson(text, { bytes: 32768, depth: 4, nodes: 512,
      keyCharacters: 64, stringCharacters: 2048, numberCharacters: 20 });
    const value = captureDataRecord(raw, CONFIG_KEYS);
    if (value.schema !== "threecore-agent-read-config-v1" || !AGENT_IDS.includes(value.agent) ||
        ![8453, 84532].includes(value.chainId) ||
        !Number.isSafeInteger(value.maxProposalAgeMs) || value.maxProposalAgeMs < 1 ||
        !Array.isArray(value.targets) || value.targets.length > 32) fail("INVALID_POLICY_CONFIG");
    const targets = value.targets.map(target => {
      const pair = captureDataRecord(target, ["tokenAddress", "spenderAddress"]);
      return Object.freeze({ tokenAddress: normalizeAddress(pair.tokenAddress), spenderAddress: normalizeAddress(pair.spenderAddress) });
    });
    if (new Set(targets.map(t => `${t.tokenAddress}:${t.spenderAddress}`)).size !== targets.length) fail("INVALID_POLICY_CONFIG");
    return Object.freeze({ agent: value.agent, account: normalizeAddress(value.account), chainId: value.chainId,
      siteOrigin: validateSiteOrigin(value.siteOrigin), maxProposalAgeMs: value.maxProposalAgeMs, targets: Object.freeze(targets) });
  } catch { fail("INVALID_POLICY_CONFIG"); }
}

/**
 * Empty on startup and after a process reload. Application code must explicitly
 * register independently reviewed settings; no inferred production defaults.
 * Each successful update/revocation advances a generation, including no-op
 * content updates. Generation labels are local, not cryptographic provenance.
 * Inspectors must also bind to their current session instance/connection epoch.
 */
export function createAgentReadPolicyRegistry() {
  const policies = new Map();
  let generation = 0;
  const nextGeneration = () => {
    if (generation >= Number.MAX_SAFE_INTEGER) fail("POLICY_GENERATION_EXHAUSTED");
    return generation + 1;
  };
  return Object.freeze({
    set(agent, configText) {
      agentId(agent);
      const value = config(configText);
      if (value.agent !== agent) fail("POLICY_AGENT_MISMATCH");
      for (const [otherAgent, policy] of policies) {
        if (otherAgent !== agent && policy.account === value.account) fail("DEDICATED_ACCOUNT_REQUIRED");
      }
      const next = nextGeneration();
      const policy = Object.freeze({ schema: "threecore-agent-read-policy-v1",
        revision: `${agent}:${next}`, ...value });
      // Fully validated before changing any active configuration.
      generation = next;
      policies.set(agent, policy);
      return policy;
    },
    revoke(agent) {
      agentId(agent);
      generation = nextGeneration();
      policies.delete(agent);
    },
    read(agent) { return policies.get(agentId(agent)) ?? null; },
    readPolicyText(agent) {
      const policy = policies.get(agentId(agent));
      return policy ? JSON.stringify(policy) : null;
    },
    snapshot() { return Object.freeze(AGENT_IDS.map(agent => Object.freeze({ agent, policy: policies.get(agent) ?? null }))); },
  });
}
