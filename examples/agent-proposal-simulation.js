#!/usr/bin/env node
/** Offline fixtures only. Never reads browser wallets, network or real funds. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { ThreeCoreWalletSession, AGENT_IDS } from "../src/wallet-session.js";
import { inspectAgentReadProposal } from "../src/agent-read-proposal.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { createOpenAIReadProposer } from "../server/openai-read-proposer.mjs";

const NOW = 1_800_000_000_000; // Fixed synthetic time, not a live observation.
const HASH = "0x" + "ab".repeat(32);
const TOKEN = "0x" + "44".repeat(20);
const SPENDER = "0x" + "55".repeat(20);
const ORIGIN = "https://simulation.example";

export async function simulateAgentProposals({ mockModel = false } = {}) {
  if (typeof mockModel !== "boolean") throw new Error("Invalid simulation mode");
  const results = [];
  let mockModelRequests = 0;
  const registry = createAgentReadPolicyRegistry();
  for (const [index, agent] of AGENT_IDS.entries()) {
    const account = "0x" + String(index + 1).repeat(40);
    const requests = [];
    const provider = {
      async request(request) {
        requests.push(structuredClone(request));
        switch (request.method) {
          case "eth_chainId": return "0x14a34";
          case "eth_requestAccounts":
          case "eth_accounts": return [account];
          case "eth_getBlockByNumber": return { number: "0x2a", hash: HASH };
          case "eth_getCode": return "0x6000";
          case "eth_call": return "0x" + "00".repeat(32);
          default: throw new Error("Unexpected synthetic RPC method");
        }
      },
    };
    const session = new ThreeCoreWalletSession({ provider, agent, expectedAccount: account,
      chainId: 84532, siteOrigin: ORIGIN, approvedOrigins: [ORIGIN] });
    try {
      // Connects only the in-memory provider above, never an installed wallet.
      await session.connect();
      const binding = { agent, account, chainId: 84532, siteOrigin: ORIGIN };
      const policy = registry.set(agent, JSON.stringify({ schema: "threecore-agent-read-config-v1",
        ...binding, maxProposalAgeMs: 60_000, targets: [{ tokenAddress: TOKEN, spenderAddress: SPENDER }] }));
      let proposal = { schema: "threecore-agent-read-proposal-v1", id: `${agent}-fixture-1`,
        ...binding, policyRevision: policy.revision, connectionEpoch: session.state.connectionEpoch,
        createdAtMs: NOW, expiresAtMs: NOW + 60_000,
        rationale: "Synthetic research observation; no actual service activity or revenue.",
        action: { kind: "inspect-spender", tokenAddress: TOKEN, spenderAddress: SPENDER } };
      if (mockModel) {
        // Fixed fixture response. Never consult process.env or global fetch.
        const proposer = createOpenAIReadProposer({ enabled: true,
          apiKey: "sk-synthetic-only-no-live-key", model: "synthetic-model",
          now: () => NOW, newId: () => `${agent}-mock-model-1`,
          fetchImpl: async () => {
            mockModelRequests++;
            return new Response(JSON.stringify({ status: "completed", output: [{
              type: "message", role: "assistant", status: "completed", content: [{
                type: "output_text", text: JSON.stringify({ decision: "inspect", targetIndex: 0,
                  rationale: "Synthetic model fixture, not evidence of actual AI activity or revenue." }),
              }],
            }] }), { headers: { "content-type": "application/json" } });
          } });
        const generated = await proposer.propose({ objective: "Inspect the configured spender without changing permissions.",
          readContext: () => ({ policyText: registry.readPolicyText(agent), sessionState: session.state }) });
        proposal = JSON.parse(generated.proposalText);
      }
      const observation = await inspectAgentReadProposal(session, JSON.stringify(proposal), () => registry.readPolicyText(agent), () => NOW);
      const requestsBeforeRejection = requests.length;
      let rejectedAction;
      try {
        await inspectAgentReadProposal(session, JSON.stringify({ ...proposal,
          action: { ...proposal.action, kind: "transfer" } }), () => registry.readPolicyText(agent), () => NOW);
        throw new Error("Privileged proposal was not rejected");
      } catch (error) {
        if (error?.code !== "ACTION_NOT_ALLOWED") throw error;
        rejectedAction = error.code;
      }
      results.push({ agent, account, observation, rejectedAction,
        additionalRequestsForRejectedAction: requests.length - requestsBeforeRejection, requests });
    } finally { session.disconnect(); }
  }
  return {
    schema: "threecore-agent-proposal-simulation-v1", synthetic: true,
    liveNetworkVerified: false, modelInvoked: false, mockModelRequests, networkRequests: 0,
    realWalletRequests: 0, transactionsExecuted: 0, filesModified: 0, results,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.slice(2).some(arg => arg !== "--mock-model")) throw new Error("Unknown option");
    process.stdout.write(JSON.stringify(await simulateAgentProposals({ mockModel: process.argv.includes("--mock-model") }), null, 2) + "\n");
  }
  catch { process.stderr.write("Synthetic proposal check failed. No live execution was attempted.\n"); process.exitCode = 1; }
}
