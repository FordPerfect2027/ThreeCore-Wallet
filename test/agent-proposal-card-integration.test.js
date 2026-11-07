import test from "node:test";
import assert from "node:assert/strict";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { mountAgentProposalPanel } from "../examples/agent-proposal-panel.js";
import { Element } from "./helpers/panel-dom.js";

const address = n => "0x" + String(n).repeat(40);
const TOKEN = address(4), SPENDER = address(5), HASH = "0x" + "ab".repeat(32), NOW = 1800000000000;
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; }
async function fixture(agent, index, chainId = 84532) {
  const calls = [], files = []; let override = () => undefined;
  const account = address(index), registry = createAgentReadPolicyRegistry();
  const provider = { async request(args) {
    calls.push(args); const custom = await override(args); if (custom !== undefined) return custom;
    switch (args.method) {
      case "eth_chainId": return "0x" + chainId.toString(16);
      case "eth_accounts": case "eth_requestAccounts": return [account];
      case "eth_getBlockByNumber": return { number: "0x2a", hash: HASH };
      case "eth_getCode": return "0x6000";
      case "eth_call": return "0x" + "0".repeat(63) + "7";
      default: throw Error("Unexpected method");
    }
  } };
  let access = true;
  const controller = createWalletCardController({ agent, siteOrigin: "http://localhost:4230", isAccessAllowed: () => access });
  await controller.connect({ provider, account, chainId });
  const document = { createElement: name => new Element(name) }, parent = new Element("div");
  const panel = mountAgentProposalPanel({ document, parent, agent, registry,
    getContext: () => ({ connection: controller.state.connection, tokenAddress: TOKEN, spenderAddress: SPENDER }),
    read: (text, policy, clock) => controller.inspectAgentProposal(text, policy, clock), onCancel: () => controller.clearResult(),
    now: () => NOW, downloadFile: f => files.push(f) });
  const q = name => parent.find("agent-proposal-" + name);
  q("apply").click(); q("build").click();
  return { calls, files, controller, panel, registry, q, setOverride: fn => { override = fn; }, deny: () => { access = false; },
    read: () => controller.inspectAgentProposal(q("draft").value, () => registry.readPolicyText(agent), () => NOW),
    async settled() {
      for (let i = 0; i < 100; i++) {
        if (q("panel").getAttribute("aria-busy") === "false") return;
        await new Promise(r => setImmediate(r));
      }
      throw Error("Read did not settle");
    },
    dispose() { panel.dispose(); controller.dispose(); },
  };
}
for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) for (const chainId of [8453, 84532]) {
  test(`${agent}/${chainId}: UI through card controller and real session reads only pinned queries`, async () => {
    const f = await fixture(agent, index + 1, chainId);
    try {
      f.q("inspect").click(); await f.settled();
      assert.equal(f.controller.state.result.kind, "agent-proposal");
      assert.equal(f.controller.state.result.observation.agent, agent);
      assert.equal(f.controller.state.result.observation.account, address(index + 1));
      assert.equal(f.controller.state.result.observation.chainId, chainId);
      assert.equal(f.controller.state.result.transactionExecuted, false);
      assert.equal(f.calls.filter(r => r.method === "eth_requestAccounts").length, 1);
      assert.ok(f.calls.every(r => ["eth_chainId", "eth_accounts", "eth_requestAccounts", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(r.method)));
      const reads = f.calls.filter(r => r.method === "eth_call");
      assert.deepEqual(reads.map(r => r.params[0].data.slice(0, 10)), ["0x70a08231", "0xdd62ed3e"]);
      assert.ok(reads.every(r => r.params[1].blockHash === HASH && r.params[1].requireCanonical === true));
      f.q("save").click(); await f.settled();
      assert.equal(JSON.parse(f.files[0].text).result.observation.blockHash, HASH);
    } finally { f.dispose(); }
  });
}
test("UI cancellation settles without waiting for an extension's in-flight RPC", async () => {
  const f = await fixture("DAT", 1), gate = deferred(), entered = deferred();
  f.setOverride(({ method }) => { if (method === "eth_getCode") { entered.resolve(); return gate.promise; } });
  try {
    f.q("inspect").click(); await entered.promise;
    f.q("cancel").click(); await f.settled();
    assert.equal(f.controller.state.phase, "connected");
    assert.equal(f.controller.state.result, null);
    assert.match(f.q("status").textContent, /中止/);
    gate.resolve("0x6000");
    await new Promise(r => setImmediate(r));
    assert.equal(f.calls.filter(r => r.method === "eth_call").length, 0);
    assert.equal(f.q("result").textContent, "");
  } finally { gate.resolve("0x6000"); f.dispose(); }
});
test("global protection denies a proposal before provider reads", async () => {
  const f = await fixture("DAT", 1); const before = f.calls.length;
  try {
    f.deny(); await assert.rejects(f.read(), error => error.code === "PROPOSAL_UNAVAILABLE");
    assert.equal(f.calls.length, before);
    assert.equal(f.controller.state.phase, "disconnected");
  } finally { f.dispose(); }
});
test("policy revocation while a provider responds cannot publish a result", async () => {
  const f = await fixture("EMA", 2);
  f.setOverride(({ method }) => { if (method === "eth_getCode") f.registry.revoke("EMA"); });
  try {
    await assert.rejects(f.read(), error => error.code === "INVALID_POLICY");
    assert.equal(f.controller.state.result, null);
    assert.equal(f.calls.filter(r => r.method === "eth_call").length, 0);
  } finally { f.dispose(); }
});
test("disconnected cards cannot implicitly request connection for a proposal", async () => {
  const f = await fixture("CAWELON", 3); f.controller.disconnect(); const before = f.calls.length;
  try { await assert.rejects(f.read(), error => error.code === "PROPOSAL_UNAVAILABLE"); assert.equal(f.calls.length, before); }
  finally { f.dispose(); }
});
