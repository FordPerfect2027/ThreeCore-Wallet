import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProposalClient } from "../src/agent-proposal-client.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";

const ORIGIN = "http://127.0.0.1:4230", NOW = 1800000000000;
const address = digit => "0x" + digit.repeat(40);

// Synthetic transport capabilities only; no wallet, network or model call.
function fixture() {
  const registry = createAgentReadPolicyRegistry();
  const sessionState = { agent: "DAT", account: address("1"), chainId: 84532,
    siteOrigin: ORIGIN, connectionEpoch: 1, connected: true,
    canSign: false, canSendTransactions: false, canBridge: false };
  registry.set("DAT", JSON.stringify({ schema: "threecore-agent-read-config-v1", agent: "DAT",
    account: sessionState.account, chainId: sessionState.chainId, siteOrigin: ORIGIN,
    maxProposalAgeMs: 60000, targets: [{ tokenAddress: address("4"), spenderAddress: address("5") }] }));
  const grants = Object.fromEntries(["a", "b", "c"].map(name => [name, {
    agent: "DAT", endpoint: ORIGIN + "/api/agent/proposal", token: name.repeat(64), expiresAtMs: NOW + 120000,
  }]));
  let time = NOW, onAbort = () => {}, onContext = () => {}, startFirst;
  const started = new Promise(resolve => { startFirst = resolve; });
  const calls = [], states = [];
  let aborts = 0;
  const client = createAgentProposalClient({ agent: "DAT", origin: ORIGIN, enabled: true,
    maxRequests: 4, timeoutMs: 5000, now: () => time,
    readContext: () => { onContext(); return { sessionState: { ...sessionState }, policyText: registry.readPolicyText("DAT") }; },
    stageProposal: () => { throw Error("Abstention must not stage a proposal"); },
    onChange: state => states.push(state),
    fetchImpl: (_url, init) => {
      calls.push({ token: init.headers.authorization.slice(7), body: JSON.parse(init.body) });
      if (calls.length === 1) {
        init.signal.addEventListener("abort", () => { aborts++; onAbort(); }, { once: true });
        startFirst();
        return new Promise(() => {});
      }
      return Promise.resolve(new Response(JSON.stringify({ status: "abstained", rationale: "Synthetic control",
        proposalText: null, executed: false, grantsAuthority: false }), { headers: { "content-type": "application/json" } }));
    },
  });
  assert.equal(client.acceptGrant(grants.a), true);
  return { client, grants, calls, states, started, aborts: () => aborts,
    setAbort: callback => { onAbort = callback; }, setContext: callback => { onContext = callback; },
    setTime: value => { time = value; },
    run: requestId => client.request({ requestId, objective: "Inspect configured synthetic target" }),
  };
}

for (const action of ["revoke", "dispose", "replace"]) {
  test(`grant replacement respects ${action} during the old transport's abort callback`, async () => {
    const f = fixture();
    let nestedAccepted;
    try {
      const old = f.run("old-request");
      await f.started;
      f.setAbort(() => {
        if (action === "replace") nestedAccepted = f.client.acceptGrant(f.grants.c);
        else f.client[action]();
      });
      assert.equal(f.client.acceptGrant(f.grants.b), false, "A superseded replacement cannot report acceptance");
      assert.equal(f.aborts(), 1);
      assert.equal((await old).status, "rejected");
      assert.equal(f.client.state.status, { revoke: "revoked", dispose: "disposed", replace: "ready" }[action]);
      if (action === "replace") {
        assert.equal(nestedAccepted, true);
        assert.equal((await f.run("new-request")).status, "abstained");
        assert.equal(f.calls[1].token, f.grants.c.token, "Only the newer grant may be sent");
      } else {
        assert.equal((await f.run("new-request")).errorCode, "CLIENT_UNAVAILABLE");
        assert.equal(f.calls.length, 1);
      }
    } finally { f.client.dispose(); }
  });
}

for (const action of ["cancel", "revoke"]) {
  test(`${action} cleanup preserves a newer grant and request started by its abort callback`, async () => {
    const f = fixture();
    let newWork, accepted;
    try {
      const old = f.run("old-request");
      await f.started;
      f.setAbort(() => { accepted = f.client.acceptGrant(f.grants.c); newWork = f.run("new-request"); });
      f.client[action]();
      assert.equal(accepted, true);
      assert.equal(f.client.state.status, "requesting", "Old cleanup cannot overwrite the newer request state");
      assert.equal((await old).status, "rejected");
      assert.equal((await newWork).status, "abstained");
      assert.equal(f.client.state.status, "abstained");
      assert.equal(f.calls.length, 2);
      assert.equal(f.calls[1].token, f.grants.c.token);
    } finally { f.client.dispose(); }
  });
}

test("cancel detaches the old operation before its abort callback explicitly starts a new request", async () => {
  const f = fixture();
  let newWork;
  try {
    const old = f.run("old-request");
    await f.started;
    f.setAbort(() => { newWork = f.run("new-request"); });
    f.client.cancel();
    assert.equal((await old).status, "rejected");
    assert.equal((await newWork).status, "abstained");
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].token, f.grants.a.token);
    assert.equal(f.client.state.status, "abstained");
  } finally { f.client.dispose(); }
});

test("an invalid replacement leaves an in-flight request and its grant intact", async () => {
  const f = fixture();
  try {
    const old = f.run("old-request");
    await f.started;
    assert.equal(f.client.acceptGrant({ ...f.grants.b, endpoint: "https://invalid.example/api/agent/proposal" }), false);
    assert.equal(f.aborts(), 0);
    assert.equal(f.client.state.status, "requesting");
    assert.equal(f.calls.length, 1);
    f.client.cancel();
    assert.equal((await old).status, "rejected");
    assert.equal((await f.run("new-request")).status, "abstained");
    assert.equal(f.calls[1].token, f.grants.a.token);
  } finally { f.client.dispose(); }
});

test("a grant that expires during context validation cannot replace a still-valid grant", async () => {
  const f = fixture();
  try {
    f.setContext(() => f.setTime(NOW + 1000));
    assert.equal(f.client.acceptGrant({ ...f.grants.b, expiresAtMs: NOW + 1000 }), false);
    assert.equal(f.client.state.status, "ready");
    f.setContext(() => {});
    const old = f.run("still-original-grant");
    await f.started;
    assert.equal(f.calls[0].token, f.grants.a.token);
    f.client.cancel();
    assert.equal((await old).status, "rejected");
  } finally { f.client.dispose(); }
});

test("a pending replacement that expires during abort cannot publish ready or send a request", async () => {
  const f = fixture();
  try {
    const old = f.run("old-request");
    await f.started;
    f.setAbort(() => f.setTime(NOW + 1000));
    assert.equal(f.client.acceptGrant({ ...f.grants.b, expiresAtMs: NOW + 1000 }), false);
    assert.equal((await old).status, "rejected");
    assert.equal(f.client.state.status, "revoked");
    assert.equal((await f.run("new-request")).errorCode, "CLIENT_UNAVAILABLE");
    assert.equal(f.calls.length, 1);
  } finally { f.client.dispose(); }
});
