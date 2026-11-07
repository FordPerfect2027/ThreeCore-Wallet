import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountAgentProposalPanel } from "../examples/agent-proposal-panel.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";

const NOW = 1800000000000;
const ACCOUNT = "0x" + "11".repeat(20), TOKEN = "0x" + "22".repeat(20), SPENDER = "0x" + "33".repeat(20);

function fixture() {
  const parent = new Element("div"), registry = createAgentReadPolicyRegistry();
  const context = { tokenAddress: TOKEN, spenderAddress: SPENDER,
    connection: { agent: "DAT", account: ACCOUNT, chainId: 84532, siteOrigin: "https://fixture.example",
      connectionEpoch: 1, connected: true, canSign: false, canSendTransactions: false, canBridge: false } };
  const hooks = new Map(); let reads = 0, time = NOW;
  const run = name => { const hook = hooks.get(name); hooks.delete(name); hook?.(); };
  const panel = mountAgentProposalPanel({ document: { createElement: name => new Element(name) },
    parent, agent: "DAT", registry, getContext: () => { run("context"); return context; },
    now: () => { run("clock"); return time; },
    read: () => { reads++; throw Error("Staging must not read"); }, onCancel: () => {} });
  const q = name => parent.find("agent-proposal-" + name);
  q("apply").click(); q("build").click();
  const draft = q("draft"), status = q("status"), original = draft.value;
  return { panel, parent, registry, context, draft, status, original, q,
    arm(name, hook) { hooks.set(name, hook); }, reads: () => reads, setTime(value) { time = value; },
    proposal(id) { return JSON.stringify({ ...JSON.parse(original), id }); } };
}

for (const callback of ["clock", "context"]) {
  test(`${callback} reentrancy cannot stage or overwrite status after invalidation or disposal`, () => {
    for (const action of ["invalidate", "dispose"]) {
      const f = fixture(); let currentStatus;
      try {
        f.arm(callback, () => { f.panel[action](); currentStatus = f.status.textContent; });
        assert.equal(f.panel.stageProposal(f.proposal("superseded")), false, action);
        assert.equal(f.draft.value, f.original, action);
        assert.equal(f.status.textContent, currentStatus, action);
        assert.equal(f.registry.read("DAT"), null, action);
        assert.equal(f.parent.children.length, action === "dispose" ? 0 : 1, action);
        assert.equal(f.reads(), 0, action);
      } finally { f.panel.dispose(); }
    }
  });
}

test("a newer nested delivery or draft edit wins over the staging callback that caused it", () => {
  for (const replacement of ["delivery", "input", "value"]) {
    const f = fixture(), newer = f.proposal("newer-draft"); let currentStatus;
    try {
      f.arm("clock", () => {
        if (replacement === "delivery") assert.equal(f.panel.stageProposal(newer), true);
        else {
          f.draft.value = newer;
          if (replacement === "input") f.draft.dispatchEvent(new Event("input"));
        }
        currentStatus = f.status.textContent;
      });
      assert.equal(f.panel.stageProposal(f.proposal("older-delivery")), false, replacement);
      assert.equal(f.draft.value, newer, replacement);
      assert.equal(f.status.textContent, currentStatus, replacement);
      assert.equal(f.reads(), 0, replacement);
    } finally { f.panel.dispose(); }
  }
});

test("clock scope changes cannot stage a proposal assessed against the preceding policy or connection", () => {
  for (const change of ["policy", "account", "target"]) {
    const f = fixture(); let currentPolicy;
    try {
      f.arm("clock", () => {
        if (change === "policy") {
          const { revision, ...policy } = f.registry.read("DAT");
          f.registry.set("DAT", JSON.stringify({ ...policy, schema: "threecore-agent-read-config-v1" }));
        } else if (change === "account") {
          f.context.connection = { ...f.context.connection, account: SPENDER, connectionEpoch: 2 };
        } else f.context.spenderAddress = ACCOUNT;
        currentPolicy = f.registry.readPolicyText("DAT");
      });
      assert.equal(f.panel.stageProposal(f.proposal("obsolete-scope")), false, change);
      assert.equal(f.draft.value, f.original, change);
      assert.equal(f.registry.readPolicyText("DAT"), currentPolicy, change);
      assert.equal(f.context.connection.account, change === "account" ? SPENDER : ACCOUNT, change);
      assert.equal(f.context.spenderAddress, change === "target" ? ACCOUNT : SPENDER, change);
      assert.equal(f.reads(), 0, change);
    } finally { f.panel.dispose(); }
  }
});

test("a proposal that expires while resolving context cannot be staged", () => {
  const f = fixture();
  try {
    f.arm("context", () => f.setTime(JSON.parse(f.original).expiresAtMs));
    assert.equal(f.panel.stageProposal(f.proposal("expired-during-context")), false);
    assert.equal(f.draft.value, f.original);
    assert.match(f.status.textContent, /EXPIRED_PROPOSAL/);
    assert.equal(f.reads(), 0);
  } finally { f.panel.dispose(); }
});
