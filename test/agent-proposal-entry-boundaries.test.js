import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountAgentProposalPanel } from "../examples/agent-proposal-panel.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { inspectAgentReadProposal } from "../src/agent-read-proposal.js";

const NOW = 1800000000000, HASH = "0x" + "ab".repeat(32);
const ACCOUNT = "0x" + "11".repeat(20), TOKEN = "0x" + "22".repeat(20), SPENDER = "0x" + "33".repeat(20);

function fixture() {
  const parent = new Element("div"), registry = createAgentReadPolicyRegistry(), hooks = new Map(), files = [];
  const context = { tokenAddress: TOKEN, spenderAddress: SPENDER,
    connection: { agent: "DAT", account: ACCOUNT, chainId: 84532, siteOrigin: "https://fixture.example",
      connectionEpoch: 1, connected: true, canSign: false, canSendTransactions: false, canBridge: false } };
  let balance = 7n, reads = 0, queries = 0, time = NOW;
  const run = name => { const hook = hooks.get(name); hooks.delete(name); hook?.(); };
  const session = { get state() { return context.connection; },
    async getBlockSnapshot() { queries++; return { number: "0x2a", hash: HASH }; },
    async getContractCode(address) { queries++; return { address, deployed: true }; },
    async getTokenBalance() { queries++; return balance; },
    async getTokenAllowance() { queries++; return 0n; } };
  const panel = mountAgentProposalPanel({ document: { createElement: name => new Element(name) }, parent, agent: "DAT", registry,
    getContext: () => { const snapshot = { ...context }; run("context"); return snapshot; },
    now: () => { run("clock"); return time; }, onCancel: () => {},
    async read(text, policy, clock) {
      reads++;
      const result = await inspectAgentReadProposal(session, text, policy, clock);
      run("read-complete");
      return result;
    },
    readFile: async source => source.text, downloadFile: prepared => files.push(prepared) });
  const q = name => parent.find("agent-proposal-" + name);
  q("apply").click(); q("build").click();
  const draft = q("draft"), status = q("status"), result = q("result");
  return { panel, parent, registry, context, draft, status, result, files, q,
    arm(name, hook) { hooks.set(name, hook); }, setBalance(value) { balance = value; }, setTime(value) { time = value; },
    reads: () => reads, queries: () => queries,
    proposal(id) { return JSON.stringify({ ...JSON.parse(draft.value), id }); },
    async settled() { await new Promise(resolve => setImmediate(resolve)); } };
}

test("Apply cannot re-register policy or change UI after its context callback invalidates or disposes", () => {
  for (const action of ["invalidate", "dispose"]) {
    const f = fixture(), previousDraft = f.draft.value; let currentStatus;
    try {
      f.arm("context", () => { f.panel[action](); currentStatus = f.status.textContent; });
      f.q("apply").click();
      assert.equal(f.registry.read("DAT"), null, action);
      assert.equal(f.draft.value, previousDraft, action);
      assert.equal(f.status.textContent, currentStatus, action);
      assert.equal(f.parent.children.length, action === "dispose" ? 0 : 1, action);
      assert.equal(f.reads(), 0, action);
    } finally { f.panel.dispose(); }
  }
});

test("a nested Apply and Build retain their newer policy, draft and status", () => {
  const f = fixture(); let newerPolicy, newerDraft, newerStatus;
  try {
    f.arm("context", () => {
      f.context.connection = { ...f.context.connection, account: SPENDER, connectionEpoch: 2 };
      f.q("apply").click(); f.q("build").click();
      newerPolicy = f.registry.readPolicyText("DAT"); newerDraft = f.draft.value; newerStatus = f.status.textContent;
    });
    f.q("apply").click();
    assert.equal(f.registry.readPolicyText("DAT"), newerPolicy);
    assert.equal(f.registry.read("DAT").account, SPENDER);
    assert.equal(f.draft.value, newerDraft);
    assert.equal(f.status.textContent, newerStatus);
    assert.equal(f.reads(), 0);
  } finally { f.panel.dispose(); }
});

test("Build cannot replace a newer delivery or cancellation status from its clock callback", () => {
  for (const action of ["deliver", "invalidate", "dispose"]) {
    const f = fixture(), newer = f.proposal("newer-delivery"); let currentDraft, currentStatus, currentPolicy;
    try {
      f.arm("clock", () => {
        if (action === "deliver") assert.equal(f.panel.stageProposal(newer), true);
        else f.panel[action]();
        currentDraft = f.draft.value; currentStatus = f.status.textContent; currentPolicy = f.registry.readPolicyText("DAT");
      });
      f.q("build").click();
      assert.equal(f.draft.value, currentDraft, action);
      assert.equal(f.status.textContent, currentStatus, action);
      assert.equal(f.registry.readPolicyText("DAT"), currentPolicy, action);
      assert.equal(f.reads(), 0, action);
    } finally { f.panel.dispose(); }
  }
});

test("Inspect cannot start a read after its initial validation callback invalidates the panel", async () => {
  const f = fixture(); let currentStatus;
  try {
    f.arm("clock", () => { f.panel.invalidate(); currentStatus = f.status.textContent; });
    f.q("inspect").click(); await f.settled();
    assert.equal(f.reads(), 0);
    assert.equal(f.queries(), 0);
    assert.equal(f.result.textContent, "");
    assert.equal(f.status.textContent, currentStatus);
  } finally { f.panel.dispose(); }
});

test("Inspect final validation cannot replace a cancelled, disposed or newly restored historical record", async () => {
  for (const action of ["invalidate", "dispose", "restore"]) {
    const f = fixture(); let currentResult, currentStatus;
    try {
      f.q("inspect").click(); await f.settled();
      if (action === "restore") {
        const archive = JSON.parse(f.result.textContent);
        archive.result.observation.tokenBalanceBaseUnits = "11";
        f.q("file").files = [{ text: JSON.stringify(archive) }];
        f.q("file").dispatchEvent(new Event("change")); await f.settled();
        assert.equal(f.q("restore").disabled, false);
      }
      f.setBalance(9n);
      f.arm("read-complete", () => f.arm("clock", () => {
        if (action === "restore") { f.panel.invalidate(); f.q("restore").click(); }
        else f.panel[action]();
        currentResult = f.result.textContent; currentStatus = f.status.textContent;
      }));
      f.q("inspect").click(); await f.settled();
      assert.equal(f.result.textContent, currentResult, action);
      assert.equal(f.status.textContent, currentStatus, action);
      assert.equal(f.registry.read("DAT"), null, action);
      assert.equal(JSON.parse(f.result.textContent).result.observation.tokenBalanceBaseUnits, action === "restore" ? "11" : "7", action);
      if (action !== "dispose") {
        f.q("save").click(); await f.settled();
        assert.equal(f.files[0].text, currentResult, action);
      }
    } finally { f.panel.dispose(); }
  }
});

test("Build resolves the current account and epoch after its clock callback replaces the connection", () => {
  for (const boundary of [1, 2]) {
    const f = fixture(), previousDraft = f.draft.value;
    try {
      const replace = () => { f.context.connection = { ...f.context.connection, account: SPENDER, connectionEpoch: 2 }; };
      f.arm("clock", boundary === 1 ? replace : () => f.arm("clock", replace));
      f.q("build").click();
      assert.equal(f.draft.value, previousDraft, `clock ${boundary}`);
      assert.equal(f.context.connection.account, SPENDER, `clock ${boundary}`);
      assert.match(f.status.textContent, /SESSION_BINDING_MISMATCH/);
      assert.equal(f.reads(), 0, `clock ${boundary}`);
    } finally { f.panel.dispose(); }
  }
});

test("Inspect final clock cannot publish an observation for the preceding account and epoch", async () => {
  for (const boundary of [1, 2]) {
    const f = fixture();
    try {
      f.q("inspect").click(); await f.settled();
      const previousResult = f.result.textContent;
      f.setBalance(9n);
      const replace = () => { f.context.connection = { ...f.context.connection, account: SPENDER, connectionEpoch: 2 }; };
      f.arm("read-complete", () => f.arm("clock", boundary === 1 ? replace : () => f.arm("clock", replace)));
      f.q("inspect").click(); await f.settled();
      assert.equal(f.result.textContent, previousResult, `clock ${boundary}`);
      assert.equal(f.context.connection.account, SPENDER, `clock ${boundary}`);
      assert.match(f.status.textContent, /SESSION_BINDING_MISMATCH/);
      f.q("save").click(); await f.settled();
      assert.equal(f.files[0].text, previousResult, `clock ${boundary}`);
    } finally { f.panel.dispose(); }
  }
});

test("Inspect preserves its earlier record when resolving final context consumes the proposal lifetime", async () => {
  const f = fixture();
  try {
    f.q("inspect").click(); await f.settled();
    const previousResult = f.result.textContent, expiresAtMs = JSON.parse(f.draft.value).expiresAtMs;
    f.setBalance(9n);
    f.arm("read-complete", () => f.arm("context", () => f.setTime(expiresAtMs)));
    f.q("inspect").click(); await f.settled();
    assert.equal(f.result.textContent, previousResult);
    assert.match(f.status.textContent, /EXPIRED_PROPOSAL/);
  } finally { f.panel.dispose(); }
});
