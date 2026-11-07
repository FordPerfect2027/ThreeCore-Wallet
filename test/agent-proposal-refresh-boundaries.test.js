import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProposalClient } from "../src/agent-proposal-client.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";

// Local synthetic identities and in-memory transport; no network or wallet.
const ORIGIN = "http://127.0.0.1:4230", NOW = 1800000000000;
const address = digit => "0x" + digit.repeat(40);
function fixture(t, { pendingTransport = false } = {}) {
  const registry = createAgentReadPolicyRegistry();
  const sessionState = { agent: "DAT", account: address("1"), chainId: 84532,
    siteOrigin: ORIGIN, connectionEpoch: 1, connected: true,
    canSign: false, canSendTransactions: false, canBridge: false };
  registry.set("DAT", JSON.stringify({ schema: "threecore-agent-read-config-v1", agent: "DAT",
    account: sessionState.account, chainId: sessionState.chainId, siteOrigin: ORIGIN,
    maxProposalAgeMs: 60000, targets: [{ tokenAddress: address("2"), spenderAddress: address("3") }] }));
  const grants = Object.fromEntries(["a", "b"].map(token => [token, { agent: "DAT",
    endpoint: ORIGIN + "/api/agent/proposal", token: token.repeat(64), expiresAtMs: NOW + 120000 }]));
  const hooks = new Map(), calls = [];
  let time = NOW, aborts = 0, clocks = 0, start;
  const started = new Promise(resolve => { start = resolve; });
  const runHook = name => {
    const hook = hooks.get(name);
    if (hook && --hook.remaining === 0) { hooks.delete(name); hook.callback(); }
  };
  const client = createAgentProposalClient({ agent: "DAT", origin: ORIGIN, enabled: true,
    timeoutMs: 5000, now: () => { clocks++; runHook("clock"); return time; },
    readContext: () => { runHook("context"); return { sessionState: { ...sessionState }, policyText: registry.readPolicyText("DAT") }; },
    stageProposal: () => { throw Error("Abstention must not stage a proposal"); },
    fetchImpl: async (_url, init) => {
      calls.push(init.headers.authorization.slice(7));
      init.signal.addEventListener("abort", () => { aborts++; }, { once: true });
      start();
      if (pendingTransport) return new Promise(() => {});
      return new Response(JSON.stringify({ status: "abstained", rationale: "Synthetic refresh control",
        proposalText: null, executed: false, grantsAuthority: false }), { headers: { "content-type": "application/json" } });
    } });
  t.after(() => client.dispose());
  assert.equal(client.acceptGrant(grants.a), true);
  return { client, grants, calls, started, aborts: () => aborts, clocks: () => clocks,
    arm: (name, callback, index = 1) => hooks.set(name, { callback, remaining: index }), setTime: value => { time = value; },
    request: requestId => client.request({ requestId, objective: "Inspect the configured target" }) };
}

for (const boundary of ["clock", "context"]) {
  test(`failed refresh ${boundary} observation cannot revoke a newer grant or request`, async t => {
    const probe = fixture(t), before = probe.clocks();
    probe.client.refresh();
    const count = boundary === "clock" ? probe.clocks() - before : 1;
    for (let index = 1; index <= count; index++) {
      const f = fixture(t);
      let accepted, newerWork;
      f.arm(boundary, () => {
        accepted = f.client.acceptGrant(f.grants.b);
        newerWork = f.request("newer-request");
        throw Error("The superseded observation failed");
      }, index);
      const refreshed = f.client.refresh(), status = f.client.state.status;
      const newerResult = await newerWork;
      assert.deepEqual({ accepted, refreshed, status, newerStatus: newerResult.status,
        calls: f.calls.length, usedNewerGrant: f.calls[0] === f.grants.b.token },
      { accepted: true, refreshed: false, status: "requesting", newerStatus: "abstained",
        calls: 1, usedNewerGrant: true }, `${boundary} callback ${index}`);
    }
  });
}

test("refresh cannot overwrite disposal performed by either observation callback", t => {
  for (const boundary of ["clock", "context"]) {
    const f = fixture(t);
    f.arm(boundary, () => { f.client.dispose(); });
    assert.equal(f.client.refresh(), false, boundary);
    assert.equal(f.client.state.status, "disposed", boundary);
    assert.equal(f.calls.length, 0, boundary);
  }
});

test("a superseded refresh does not report success for a replacement grant", async t => {
  for (const boundary of ["clock", "context"]) {
    const f = fixture(t);
    let accepted;
    f.arm(boundary, () => { accepted = f.client.acceptGrant(f.grants.b); });
    const refreshed = f.client.refresh();
    const result = await f.request("replacement-request");
    assert.deepEqual({ boundary, accepted, refreshed, status: result.status,
      calls: f.calls.length, usedNewerGrant: f.calls[0] === f.grants.b.token },
    { boundary, accepted: true, refreshed: false, status: "abstained", calls: 1, usedNewerGrant: true });
  }
});

test("refresh rechecks expiry after reading context", t => {
  const f = fixture(t);
  f.arm("context", () => f.setTime(f.grants.a.expiresAtMs));
  assert.deepEqual({ refreshed: f.client.refresh(), status: f.client.state.status, calls: f.calls.length },
    { refreshed: false, status: "revoked", calls: 0 });
});

test("refresh preserves healthy active work and still revokes its own failed observation", async t => {
  const f = fixture(t, { pendingTransport: true });
  const pending = f.request("original-request");
  await f.started;
  assert.equal(f.client.refresh(), true);
  assert.equal(f.client.state.status, "requesting");
  assert.equal(f.aborts(), 0); assert.equal(f.calls.length, 1);
  f.arm("context", () => { throw Error("Current context unavailable"); });
  assert.equal(f.client.refresh(), false);
  assert.equal(f.client.state.status, "revoked");
  assert.equal((await pending).status, "rejected");
  assert.equal(f.aborts(), 1); assert.equal(f.calls.length, 1);
});
