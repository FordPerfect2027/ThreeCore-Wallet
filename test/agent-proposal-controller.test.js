import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProposalController } from "../src/agent-proposal-controller.js";

const NOW = 1800000000000;
const HASH = "0x" + "aa".repeat(32);
const address = n => "0x" + String(n).repeat(40);
function fixture(agent = "DAT", index = 1, onChange = () => {}) {
  const bind = { agent, account: address(index), chainId: 84532, siteOrigin: "https://fixture.example" };
  let current;
  const calls = [];
  const session = {
    state: { ...bind, connectionEpoch: 1, connected: true, canSign: false, canSendTransactions: false, canBridge: false },
    async getBlockSnapshot() { calls.push("block"); return { number: "0x2a", hash: HASH }; },
    async getContractCode(address) { calls.push("code"); return { address, deployed: true }; },
    async getTokenBalance() { calls.push("balance"); return 0n; },
    async getTokenAllowance() { calls.push("allowance"); return 0n; },
  };
  current = session;
  const policy = { schema: "threecore-agent-read-policy-v1", revision: "v1", ...bind,
    maxProposalAgeMs: 1000, targets: [{ tokenAddress: address(4), spenderAddress: address(5) }] };
  const proposal = { schema: "threecore-agent-read-proposal-v1", id: `${agent}-1`, ...bind,
    connectionEpoch: 1, policyRevision: "v1", createdAtMs: NOW, expiresAtMs: NOW + 1000,
    rationale: "Fixture only", action: { kind: "inspect-spender", ...policy.targets[0] } };
  const controller = createAgentProposalController({ agent, getSession: () => current,
    readPolicyText: () => JSON.stringify(policy), now: () => NOW, onChange });
  return { session, policy, calls, proposal, controller, replace: s => { current = s; },
    run: () => controller.inspect(JSON.stringify(proposal)) };
}
function deferred() {
  let resolve; const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
for(const agent of ["DAT","EMA","CAWELON"])for(const kind of ["prototype-trap","revoked-proxy","code-getter"])
test(`${agent}: opaque session ${kind} rejects cleanly and permits explicit recovery`,async()=>{
  const f=fixture(agent);let problem,accesses=0;
  if(kind==="prototype-trap")problem=new Proxy({}, {getPrototypeOf(){accesses++;throw Error("private");}});
  if(kind==="code-getter")problem={get code(){accesses++;throw Error("private");}};
  if(kind==="revoked-proxy"){const pair=Proxy.revocable({},{});pair.revoke();problem=pair.proxy;}
  f.replace({get state(){throw problem;}});
  assert.equal(await f.run(),false);assert.equal(f.controller.state.status,"rejected");
  assert.equal(f.controller.state.errorCode,"READ_INSPECTION_FAILED");assert.equal(accesses,0);assert.equal(f.calls.length,0);
  f.replace(f.session);assert.equal(await f.run(),true);f.controller.dispose();
});
for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
  test(`${agent} controller records provenance, not transaction completion`, async () => {
    const states = []; const f = fixture(agent, index + 1, s => states.push(s.status));
    assert.equal(await f.run(), true);
    assert.deepEqual(states, ["checking", "observed-read-only"]);
    assert.equal(f.controller.state.result.proposalId, `${agent}-1`);
    assert.equal(f.controller.state.result.observation.account, address(index + 1));
    assert.equal(f.controller.state.result.transactionExecuted, false);
    assert.ok(Object.isFrozen(f.controller.state));
  });
}
test("parallel agents do not share policy, result or stop state", async () => {
  const a = fixture("DAT", 1); const b = fixture("EMA", 2); const c = fixture("CAWELON", 3);
  const blocked = deferred(); a.session.getBlockSnapshot = () => blocked.promise;
  const pending = a.run();
  a.controller.stop();
  assert.equal(await b.run(), true);
  assert.equal(await c.run(), true);
  blocked.resolve({ number: "0x2a", hash: HASH });
  assert.equal(await pending, false);
  assert.equal(a.controller.state.status, "stopped");
  assert.equal(b.controller.state.result.observation.agent, "EMA");
  assert.equal(c.controller.state.result.observation.agent, "CAWELON");
});
test("double submission cannot start another inspection", async () => {
  const f = fixture(); const blocked = deferred();
  let calls = 0; f.session.getBlockSnapshot = () => { calls++; return blocked.promise; };
  const pending = f.run();
  assert.equal(await f.run(), false);
  assert.equal(calls, 1);
  blocked.resolve({ number: "0x2a", hash: HASH });
  assert.equal(await pending, true);
});
for (const operation of ["stop", "dispose"]) {
  test(`${operation} ignores a delayed response without clearing shared wallet permissions`, async () => {
    const f = fixture(); const blocked = deferred();
    f.session.getBlockSnapshot = () => blocked.promise;
    const pending = f.run(); f.controller[operation]();
    blocked.resolve({ number: "0x2a", hash: HASH });
    assert.equal(await pending, false);
    assert.equal(f.controller.state.status, "stopped");
    assert.equal(f.controller.state.result, null);
    assert.equal(f.session.state.connected, true);
    assert.deepEqual(f.calls, []);
    if (operation === "dispose") assert.equal(await f.run(), false);
  });
}
test("an old operation cannot overwrite a later result after stop and explicit restart", async () => {
  const f = fixture(); const blocked = deferred();
  const original = f.session.getBlockSnapshot;
  f.session.getBlockSnapshot = () => blocked.promise;
  const old = f.run(); f.controller.stop();
  f.session.getBlockSnapshot = original; f.proposal.id = "new-proposal";
  assert.equal(await f.run(), true);
  blocked.resolve({ number: "0x2a", hash: HASH }); await old;
  assert.equal(f.controller.state.result.proposalId, "new-proposal");
});
test("replacement with an identical-state session invalidates pending inspection", async () => {
  const f = fixture(); const blocked = deferred();
  f.session.getBlockSnapshot = () => blocked.promise;
  const pending = f.run(); f.replace({ ...f.session });
  blocked.resolve({ number: "0x2a", hash: HASH });
  assert.equal(await pending, false);
  assert.equal(f.controller.state.errorCode, "SESSION_REPLACED");
});
test("controller agent cannot be changed by replacing session and policy together", async () => {
  const f = fixture(); const other = fixture("EMA", 2);
  f.replace(other.session);
  assert.equal(await f.controller.inspect(JSON.stringify(other.proposal)), false);
  assert.equal(f.controller.state.errorCode, "CONTROLLER_AGENT_MISMATCH");
  assert.deepEqual(other.calls, []);
});
test("UI callback can stop synchronously before any read", async () => {
  let controller;
  const f = fixture("DAT", 1, state => { if (state.status === "checking") controller.stop(); });
  controller = f.controller;
  assert.equal(await f.run(), false);
  assert.deepEqual(f.calls, []);
});
test("notification failure does not discard a valid read or leak a rejection", async () => {
  const f = fixture("DAT", 1, async () => { throw new Error("UI failure"); });
  assert.equal(await f.run(), true);
  await new Promise(r => setImmediate(r));
  assert.equal(f.controller.state.status, "observed-read-only");
});
test("provider failure is sanitized and never reported as success", async () => {
  const f = fixture();
  f.session.getBlockSnapshot = async () => { throw new Error("private-provider-information"); };
  assert.equal(await f.run(), false);
  assert.equal(f.controller.state.status, "rejected");
  assert.equal(f.controller.state.errorCode, "READ_INSPECTION_FAILED");
  assert.equal(JSON.stringify(f.controller.state).includes("private-provider-information"), false);
});
test("dispose notification cannot reenter and start a new inspection", async () => {
  let controller; let restarted;
  const f = fixture("DAT", 1, state => {
    if (state.status === "stopped") restarted = controller.inspect(JSON.stringify(f.proposal));
  });
  controller = f.controller; controller.dispose();
  assert.equal(await restarted, false);
  assert.deepEqual(f.calls, []);
});
test("callback cancellation observes rejected async policy before discarding it", async () => {
  const f = fixture(); let controller;
  controller = createAgentProposalController({ agent: "DAT", getSession: () => f.session,
    readPolicyText: () => { controller.stop(); return Promise.reject(new Error("private callback failure")); }, now: () => NOW });
  assert.equal(await controller.inspect(JSON.stringify(f.proposal)), false);
  await new Promise(r => setImmediate(r));
  assert.equal(controller.state.status, "stopped");
  assert.deepEqual(f.calls, []);
});
test("asynchronous session callback is observed and cannot create an unhandled rejection", async () => {
  const f = fixture();
  const controller = createAgentProposalController({ agent: "DAT",
    getSession: async () => { throw new Error("private session failure"); },
    readPolicyText: () => JSON.stringify(f.policy), now: () => NOW });
  assert.equal(await controller.inspect(JSON.stringify(f.proposal)), false);
  await new Promise(r => setImmediate(r));
  assert.equal(controller.state.errorCode, "INVALID_SESSION");
  assert.deepEqual(f.calls, []);
});
