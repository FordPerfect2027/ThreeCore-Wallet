import test from "node:test";
import assert from "node:assert/strict";
import { mountWalletDemo } from "../examples/wallet-demo.js";
import { createWalletDemoProposalFixture, DEMO_PROPOSAL_ORIGIN as ORIGIN, DEMO_PROPOSAL_AGENTS as AGENTS,
  demoProposalTick } from "./helpers/wallet-demo-proposal-fixture.js";

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function mounted(t, options) { const fixture = createWalletDemoProposalFixture(options); t.after(() => fixture.dispose()); return fixture; }

test("demo captures only bounded same-origin transport data before any document/export work", () => {
  let documentReads = 0, getters = 0;
  const document = new Proxy({}, { get() { documentReads++; throw Error("Unexpected document access"); } });
  const accessor = Object.defineProperty({ origin: ORIGIN }, "enabled", { enumerable: true, get() { getters++; return true; } });
  const invalid = [false, "transport", [], {}, { origin: ORIGIN + "/" }, { origin: "https://other.example" },
    { origin: ORIGIN, enabled: "true" }, { origin: ORIGIN, fetchImpl: null },
    { origin: ORIGIN, timeoutMs: 0 }, { origin: ORIGIN, timeoutMs: 60001 },
    { origin: ORIGIN, endpoint: ORIGIN + "/api/agent/proposal" }, { origin: ORIGIN, token: "synthetic-unaccepted-value" }, accessor];
  for (const proposalTransport of invalid) {
    assert.throws(() => mountWalletDemo({ document, siteOrigin: ORIGIN, proposalTransport }),
      error => error.code === "INVALID_PROPOSAL_TRANSPORT" && error.message === "INVALID_PROPOSAL_TRANSPORT");
  }
  assert.throws(() => mountWalletDemo({ document, siteOrigin: ORIGIN + "/", proposalTransport: { origin: ORIGIN } }),
    { code: "INVALID_PROPOSAL_TRANSPORT" });
  assert.equal(documentReads, 0); assert.equal(getters, 0);
});

test("normal default and explicit disabled transport remain inert and expose only the frozen app hooks", t => {
  const normal = mounted(t, { proposalTransport: undefined });
  const disabled = mounted(t, { proposalTransport: { origin: ORIGIN } });
  assert.equal(Object.isFrozen(normal.app), true);
  assert.deepEqual(Object.keys(normal.app), ["readProposalContext", "acceptProposalGrant", "revokeProposalGrant", "dispose"]);
  for (const f of [normal, disabled]) {
    for (const agent of AGENTS) {
      assert.equal(f.app.readProposalContext(agent), null);
      assert.equal(f.app.acceptProposalGrant(agent, f.grant(agent)), false);
      assert.equal(f.card(agent, ".agent-proposal-draft").value, "");
      assert.equal(f.card(agent, ".agent-proposal-inspect").disabled, true);
    }
    assert.equal(f.requests.length, 0); assert.equal(f.rpc.length, 0); assert.equal(f.sessions.size, 0);
  }
  assert.equal(normal.card("DAT", ".agent-proposal-model-section"), null);
  assert.equal(normal.app.revokeProposalGrant("DAT"), false);
  assert.equal(disabled.card("DAT", ".agent-proposal-model-request").disabled, true);
});

test("three normal demo cards receive scoped grants and stage proposals before a separate pinned read", async t => {
  const f = mounted(t);
  const contexts = new Map();
  for (const agent of AGENTS) contexts.set(agent, await f.prepare(agent));
  const connectionCalls = f.rpc.length;
  for (const agent of AGENTS) {
    const context = contexts.get(agent), policy = JSON.parse(context.policyText);
    assert.deepEqual(Object.keys(context), ["policyText", "sessionState"]);
    assert.equal(Object.isFrozen(context), true); assert.equal(Object.isFrozen(context.sessionState), true);
    assert.equal(policy.agent, agent); assert.equal(policy.account, f.accounts.get(agent));
    assert.equal(policy.siteOrigin, ORIGIN); assert.equal(context.sessionState.connected, true);
    assert.deepEqual([context.sessionState.canSign, context.sessionState.canSendTransactions, context.sessionState.canBridge], [false, false, false]);
    assert.equal(f.app.acceptProposalGrant(agent, f.grant(agent)), true);
  }
  assert.equal(f.requests.length, 0); assert.equal(f.rpc.length, connectionCalls);
  for (const agent of AGENTS) {
    f.input(agent, ".agent-proposal-objective", "Inspect this synthetic target");
    f.click(agent, ".agent-proposal-model-request"); await f.settle(agent);
    const proposal = JSON.parse(f.card(agent, ".agent-proposal-draft").value);
    assert.equal(proposal.agent, agent); assert.equal(proposal.account, f.accounts.get(agent));
    assert.equal(proposal.policyRevision, JSON.parse(contexts.get(agent).policyText).revision);
    assert.equal(proposal.id.startsWith("synthetic-response-"), true);
    assert.equal(f.card(agent, ".agent-proposal-result").textContent, "");
  }
  assert.deepEqual(f.requests.map(request => request.body.agent), AGENTS);
  assert.equal(f.rpc.length, connectionCalls, "Receiving/staging three proposals performs no wallet read");
  assert.equal(f.requests.every(request => request.url === ORIGIN + "/api/agent/proposal" && request.credentials === "omit" && request.referrerPolicy === "no-referrer"), true);
  f.click("DAT", ".agent-proposal-inspect"); await f.settle("DAT");
  const record = JSON.parse(f.card("DAT", ".agent-proposal-result").textContent);
  assert.equal(record.authenticated, false); assert.equal(record.historicalObservation, true);
  assert.equal(record.result.observation.agent, "DAT");
  assert.equal(record.result.observation.blockNumber, "42");
  assert.equal(record.result.observation.tokenBalanceBaseUnits, "7");
  assert.equal(record.result.observation.existingAllowanceBaseUnits, "0");
  const reads = f.rpc.slice(connectionCalls);
  assert.ok(reads.length > 0); assert.equal(reads.every(request => request.agent === "DAT"), true);
  const tokenReads = reads.filter(request => request.method === "eth_call");
  assert.equal(tokenReads.length, 2);
  for (const request of tokenReads) assert.deepEqual(request.params[1], { blockHash: "0x" + "ab".repeat(32), requireCanonical: true });
  assert.deepEqual(reads.filter(request => request.method === "eth_getBlockByNumber").map(request => request.params), [["latest", false], ["0x2a", false]]);
  assert.equal(reads.every(request => ["eth_accounts", "eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(request.method)), true);
  for (const agent of ["EMA", "CAWELON"]) assert.equal(f.card(agent, ".agent-proposal-result").textContent, "");
});

test("caller mutation after mount cannot retarget or disable the captured transport", async t => {
  let f, firstFetches = 0, replacementFetches = 0;
  const transport = { origin: ORIGIN, enabled: true, timeoutMs: 1000,
    fetchImpl() { firstFetches++; return f.response("DAT"); } };
  f = mounted(t, { proposalTransport: transport });
  transport.origin = "https://changed.example"; transport.enabled = false; transport.timeoutMs = 1;
  transport.fetchImpl = () => { replacementFetches++; throw Error("Changed callback must not run"); };
  await f.prepare("DAT"); assert.equal(f.app.acceptProposalGrant("DAT", f.grant("DAT")), true);
  f.input("DAT", ".agent-proposal-objective", "Use captured transport"); f.click("DAT", ".agent-proposal-model-request"); await f.settle("DAT");
  assert.equal(firstFetches, 1); assert.equal(replacementFetches, 0);
  assert.equal(JSON.parse(f.card("DAT", ".agent-proposal-draft").value).id, "synthetic-response-1");
});

test("client-only revoke preserves the local policy and draft while leaving the other agent ready", async t => {
  const f = mounted(t);
  for (const agent of ["DAT", "EMA"]) { await f.prepare(agent); assert.equal(f.app.acceptProposalGrant(agent, f.grant(agent)), true); }
  const dat = f.app.readProposalContext("DAT"), ema = f.app.readProposalContext("EMA"), draft = f.card("DAT", ".agent-proposal-draft").value;
  assert.equal(f.app.revokeProposalGrant("DAT"), true);
  assert.deepEqual(f.app.readProposalContext("DAT"), dat); assert.deepEqual(f.app.readProposalContext("EMA"), ema);
  assert.equal(f.card("DAT", ".agent-proposal-draft").value, draft); assert.equal(f.requests.length, 0);
  f.input("DAT", ".agent-proposal-objective", "Revoked local transport");
  assert.equal(f.card("DAT", ".agent-proposal-model-request").disabled, true);
  f.input("EMA", ".agent-proposal-objective", "Peer remains ready"); f.click("EMA", ".agent-proposal-model-request"); await f.settle("EMA");
  assert.deepEqual(f.requests.map(request => request.body.agent), ["EMA"]);
});

test("normal settings/protection invalidation aborts pending delivery and app disposal leaves hooks inert", async t => {
  const pending = deferred(), f = mounted(t, { fetchImpl: () => pending.promise });
  await f.prepare("DAT"); await f.prepare("EMA");
  assert.equal(f.app.acceptProposalGrant("DAT", f.grant("DAT")), true);
  const before = f.card("DAT", ".agent-proposal-draft").value, late = f.response("DAT"), peer = f.app.readProposalContext("EMA");
  f.input("DAT", ".agent-proposal-objective", "Pending target"); f.click("DAT", ".agent-proposal-model-request"); await demoProposalTick();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].signal.aborted, false);
  f.input("DAT", ".token", "0x" + "f".repeat(40));
  assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.app.readProposalContext("DAT"), null);
  assert.deepEqual(f.app.readProposalContext("EMA"), peer);
  pending.resolve(late); await f.settle("DAT");
  assert.equal(f.card("DAT", ".agent-proposal-draft").value, before);
  assert.equal(f.card("DAT", ".agent-proposal-result").textContent, "");
  f.document.querySelector(".security-stop").click();
  assert.equal(f.app.readProposalContext("EMA"), null); assert.equal(f.app.acceptProposalGrant("EMA", f.grant("EMA")), false);
  f.app.dispose(); f.app.dispose();
  for (const agent of AGENTS) {
    assert.equal(f.app.readProposalContext(agent), null); assert.equal(f.app.acceptProposalGrant(agent, f.grant(agent)), false);
    assert.equal(f.app.revokeProposalGrant(agent), false);
  }
  assert.equal(f.document.querySelector("#grid").children.length, 0); assert.equal(f.requests.length, 1);
});
