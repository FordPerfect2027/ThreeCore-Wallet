import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProposalService } from "../server/agent-proposal-service.mjs";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";

const ORIGIN = "http://127.0.0.1:4230";
const NOW = 1800000000000;
const address = digit => "0x" + digit.repeat(40);

// Native Request/Response and host callbacks only: no transport, key or wallet.
function fixture({ boundary = "context", stop = null, clockIndex = 1, throwAfterReplacement = false } = {}) {
  const registry = createAgentReadPolicyRegistry();
  const state = { agent: "DAT", account: address("a"), chainId: 84532,
    siteOrigin: ORIGIN, connected: true, connectionEpoch: 1,
    canSign: false, canSendTransactions: false, canBridge: false };
  registry.set("DAT", JSON.stringify({ schema: "threecore-agent-read-config-v1", agent: "DAT",
    account: state.account, chainId: state.chainId, siteOrigin: ORIGIN, maxProposalAgeMs: 60000,
    targets: [{ tokenAddress: address("1"), spenderAddress: address("2") }] }));
  const policyText = registry.readPolicyText("DAT");
  const proposalText = JSON.stringify({ schema: "threecore-agent-read-proposal-v1",
    id: "synthetic-context-boundary", agent: "DAT", account: state.account,
    chainId: state.chainId, siteOrigin: ORIGIN, connectionEpoch: 1,
    policyRevision: JSON.parse(policyText).revision, createdAtMs: NOW, expiresAtMs: NOW + 60000,
    action: { kind: "inspect-spender", tokenAddress: address("1"), spenderAddress: address("2") },
    rationale: "Synthetic read-only inspection" });
  let service, registration, replacement;
  let time = NOW, armed = false, terminal = false, terminalClocks = 0, stops = 0, calls = 0;
  const settlements = [];
  function stopCurrent() {
    stops++;
    if (stop === "revoke") service.revoke("DAT");
    else if (stop === "dispose") service.dispose();
    else if (stop === "replace") replacement = service.register(registration);
    else if (stop === "expire") time = NOW + 1000;
  }
  const readContext = () => {
    if (armed) {
      armed = false;
      stopCurrent();
      if (throwAfterReplacement) throw Error("Synthetic context became unavailable");
    }
    return { policyText, sessionState: { ...state } };
  };
  service = createAgentProposalService({ origin: ORIGIN, enabled: true,
    now: () => {
      if (terminal) {
        terminalClocks++;
        if (boundary === "clock" && terminalClocks === clockIndex && stops === 0) stopCurrent();
      }
      return time;
    },
    attemptJournal: {
      reserve: () => ({ status: "reserved", outcome: "reserved", reservation: "a".repeat(64) }),
      settle({ outcome }) {
        settlements.push(outcome);
        // Generation is complete. Stop only during the final authority check.
        if (outcome === "completed") {
          terminal = true;
          if (boundary === "context" && stop && stops === 0) armed = true;
        }
        return { status: outcome };
      },
    },
  });
  registration = { agent: "DAT", readContext, expiresAtMs: NOW + 1000,
    propose: async () => {
      calls++;
      return { status: "unexecuted-model-proposal", proposalText, review: {},
        executed: false, grantsAuthority: false };
    } };
  const grant = service.register(registration);
  const request = (selected = grant, requestId = "initial-request") => new Request(selected.endpoint, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json",
      authorization: "Bearer " + selected.token },
    body: JSON.stringify({ agent: "DAT", requestId, objective: "Synthetic configured inspection" }),
  });
  return { service, grant, settlements, calls: () => calls, stops: () => stops,
    terminalClocks: () => terminalClocks,
    replacement: () => replacement,
    run: (selected, requestId) => service.handle(request(selected, requestId)) };
}

test("stable final context delivers and replays one completed synthetic proposal", async () => {
  const f = fixture();
  try {
    const first = await f.run();
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.status, "unexecuted-model-proposal");
    assert.equal(body.executed, false);
    assert.equal(body.grantsAuthority, false);
    assert.deepEqual(await (await f.run()).json(), body);
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.settlements, ["completed"]);
  } finally { f.service.dispose(); }
});

async function verifyStoppedRequest(f, stop) {
  const response = await f.run();
  assert.equal(f.stops(), 1, "The terminal host callback must run");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "SESSION_REVOKED", executed: false });
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.settlements, ["completed"], "Completed generation is not refunded or repeated");
  const oldAgain = await f.run();
  assert.equal(oldAgain.status, stop === "dispose" ? 503 : 401);
  assert.equal(f.calls(), 1);
  if (stop === "replace") {
    const next = f.replacement();
    assert.ok(next);
    assert.notEqual(next.token, f.grant.token);
    assert.equal((await f.run(next, "explicit-replacement-request")).status, 200);
    assert.equal(f.calls(), 2, "Only an explicit request using the replacement starts new work");
  }
}

for (const stop of ["revoke", "dispose", "replace"]) {
  test(`final context ${stop} cannot deliver the old service grant`, async () => {
    const f = fixture({ stop });
    try { await verifyStoppedRequest(f, stop); }
    finally { f.service.dispose(); }
  });
  test(`every final clock callback ${stop} cannot deliver the old service grant`, async () => {
    const probe = fixture();
    let clocks;
    try {
      assert.equal((await probe.run()).status, 200);
      clocks = probe.terminalClocks();
      assert.ok(clocks > 0);
    } finally { probe.service.dispose(); }
    // Trace actual host callbacks instead of assuming how many checks exist.
    // This includes the final sample passed to proposal assessment.
    for (let clockIndex = 1; clockIndex <= clocks; clockIndex++) {
      const f = fixture({ boundary: "clock", stop, clockIndex });
      try { await verifyStoppedRequest(f, stop); }
      finally { f.service.dispose(); }
    }
  });
}

test("expiry during final context acquisition rejects a still-valid proposal", async () => {
  const f = fixture({ stop: "expire" });
  try {
    const response = await f.run();
    assert.equal(f.stops(), 1);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "SESSION_EXPIRED", executed: false });
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.settlements, ["completed"]);
    assert.equal((await f.run()).status, 401);
    assert.equal(f.calls(), 1);
  } finally { f.service.dispose(); }
});

test("a failed old context callback cannot revoke its replacement grant", async () => {
  const f = fixture({ stop: "replace", throwAfterReplacement: true });
  try {
    const response = await f.run();
    assert.equal(f.stops(), 1);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "CONTEXT_INVALID", executed: false });
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.settlements, ["completed"]);
    assert.equal((await f.run()).status, 401);
    assert.equal((await f.run(f.replacement(), "explicit-replacement-request")).status, 200);
    assert.equal(f.calls(), 2);
  } finally { f.service.dispose(); }
});
