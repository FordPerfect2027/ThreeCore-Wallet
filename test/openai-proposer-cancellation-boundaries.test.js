import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAIReadProposer } from "../server/openai-read-proposer.mjs";
import { createAgentProposalService } from "../server/agent-proposal-service.mjs";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";

// Native Request/Response, synthetic configuration, no environment or network.
const ORIGIN = "http://127.0.0.1:4230", NOW = 1800000000000;
const address = digit => "0x" + digit.repeat(40);
function fixture({ boundary = "context", phase = "before-dispatch", decision = "inspect" } = {}) {
  const registry = createAgentReadPolicyRegistry();
  const sessionState = { agent: "DAT", account: address("1"), chainId: 84532,
    siteOrigin: ORIGIN, connectionEpoch: 1, connected: true,
    canSign: false, canSendTransactions: false, canBridge: false };
  registry.set("DAT", JSON.stringify({ schema: "threecore-agent-read-config-v1", agent: "DAT",
    account: sessionState.account, chainId: sessionState.chainId, siteOrigin: ORIGIN,
    maxProposalAgeMs: 60000, targets: [{ tokenAddress: address("2"), spenderAddress: address("3") }] }));
  const caller = new AbortController();
  const baseContext = () => ({ policyText: registry.readPolicyText("DAT"), sessionState: { ...sessionState } });
  const calls = [];
  let contextReads = 0, clockReads = 0;
  const stopAt = phase === "before-dispatch" ? 2 : 3;
  const readContext = (read = baseContext) => {
    const value = read();
    if (++contextReads === stopAt && boundary === "context") caller.abort();
    return value;
  };
  const proposer = createOpenAIReadProposer({ enabled: true,
    apiKey: "sk-synthetic-cancellation-fixture-only", model: "synthetic-no-network",
    newId: () => "synthetic-cancellation-proposal", now: () => {
      if (++clockReads === stopAt && boundary === "clock") caller.abort();
      return NOW;
    },
    fetchImpl: async (_url, init) => {
      calls.push({ abortedAtDispatch: init.signal.aborted });
      return new Response(JSON.stringify({ status: "completed", output: [{
        type: "message", role: "assistant", status: "completed", content: [{ type: "output_text",
          text: JSON.stringify({ decision, targetIndex: decision === "inspect" ? 0 : -1,
            rationale: "Synthetic callback cancellation control" }) }],
      }] }), { headers: { "content-type": "application/json" } });
    } });
  const input = { objective: "Inspect the configured synthetic target", signal: caller.signal,
    readContext: () => readContext() };
  return { proposer, caller, calls, input, baseContext, readContext };
}
async function outcome(work) {
  try { return { status: (await work).status, code: null }; }
  catch (error) { return { status: null, code: error.code }; }
}

for (const boundary of ["context", "clock"]) {
  test(`cancellation inside the pre-dispatch ${boundary} callback does not send or consume adapter quota`, async () => {
    const f = fixture({ boundary });
    const result = await outcome(f.proposer.propose(f.input));
    assert.deepEqual({ result, cancelled: f.caller.signal.aborted, dispatches: f.calls.length,
      attempts: f.proposer.status().attempts, busy: f.proposer.status().busy },
    { result: { status: null, code: "MODEL_CANCELLED" }, cancelled: true, dispatches: 0, attempts: 0, busy: false });
    const recovery = await f.proposer.propose({ ...f.input, signal: new AbortController().signal });
    assert.equal(recovery.status, "unexecuted-model-proposal");
    assert.equal(f.calls.length, 1);
    assert.equal(f.proposer.status().attempts, 1);
  });

  test(`cancellation inside final ${boundary} validation prevents both proposal and abstention delivery`, async () => {
    for (const decision of ["inspect", "abstain"]) {
      const f = fixture({ boundary, phase: "final-validation", decision });
      const result = await outcome(f.proposer.propose(f.input));
      assert.deepEqual({ result, cancelled: f.caller.signal.aborted, dispatches: f.calls.length,
        attempts: f.proposer.status().attempts, busy: f.proposer.status().busy },
      { result: { status: null, code: "MODEL_CANCELLED" }, cancelled: true, dispatches: 1, attempts: 1, busy: false }, decision);
      assert.equal(f.calls[0].abortedAtDispatch, false);
      await assert.rejects(f.proposer.propose({ ...f.input, signal: new AbortController().signal }),
        { code: "REQUEST_LIMIT_REACHED" });
    }
  });
}

test("service cancellation preserves a committed journal attempt without dispatching or delivering cancelled model work", async t => {
  for (const phase of ["before-dispatch", "final-validation"]) {
    const f = fixture({ phase, decision: "abstain" });
    let reservations = 0, proposalCalls = 0, adapterOutcome;
    const settlements = [];
    const service = createAgentProposalService({ origin: ORIGIN, enabled: true, now: () => NOW,
      attemptJournal: {
        reserve() { reservations++; return { status: "reserved", outcome: "reserved", reservation: "a".repeat(64) }; },
        settle({ outcome }) { settlements.push(outcome); return { status: outcome }; },
      } });
    t.after(() => service.dispose());
    const grant = service.register({ agent: "DAT", expiresAtMs: NOW + 120000, readContext: f.baseContext,
      async propose(input) {
        proposalCalls++;
        try {
          const result = await f.proposer.propose({ ...input, readContext: () => f.readContext(input.readContext) });
          adapterOutcome = result.status;
          return result;
        } catch (error) { adapterOutcome = error.code; throw error; }
      } });
    const request = signal => new Request(grant.endpoint, { method: "POST", signal, headers: {
      origin: ORIGIN, "content-type": "application/json", authorization: `Bearer ${grant.token}`,
    }, body: JSON.stringify({ agent: "DAT", requestId: "cancelled-service-request", objective: f.input.objective }) });
    const response = await service.handle(request(f.caller.signal));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual({ status: response.status, body: await response.json(), adapterOutcome,
      dispatches: f.calls.length, attempts: f.proposer.status().attempts, reservations, settlements, proposalCalls },
    { status: 499, body: { error: "REQUEST_CANCELLED", executed: false }, adapterOutcome: "MODEL_CANCELLED",
      dispatches: phase === "before-dispatch" ? 0 : 1, attempts: phase === "before-dispatch" ? 0 : 1,
      reservations: 1, settlements: ["failed"], proposalCalls: 1 }, phase);
    const duplicate = await service.handle(request());
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error, "PREVIOUS_REQUEST_FAILED");
    assert.equal(reservations, 1); assert.equal(proposalCalls, 1);
  }
});
