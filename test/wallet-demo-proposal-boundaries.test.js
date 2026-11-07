import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountAgentProposalPanel } from "../examples/agent-proposal-panel.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { createWalletDemoProposalFixture, demoProposalTick } from "./helpers/wallet-demo-proposal-fixture.js";

const ORIGIN = "http://127.0.0.1:4230", NOW = 1800000000000;
const address = digit => "0x" + digit.repeat(40);

function snapshotFixture() {
  const parent = new Element("div"), registry = createAgentReadPolicyRegistry();
  const connection = { agent: "DAT", account: address("1"), chainId: 84532,
    siteOrigin: ORIGIN, connected: true, connectionEpoch: 1,
    canSign: false, canSendTransactions: false, canBridge: false };
  const context = { connection, tokenAddress: address("4"), spenderAddress: address("5") };
  let reads = 0;
  const panel = mountAgentProposalPanel({ document: { createElement: name => new Element(name) },
    parent, agent: "DAT", registry, getContext: () => context, now: () => NOW,
    read: () => { reads++; throw Error("Snapshot must not execute a wallet read"); } });
  parent.find("agent-proposal-apply").click();
  assert.ok(registry.read("DAT"));
  return { panel, registry, context, connection, reads: () => reads };
}

test("public proposal context rejects accessor-bearing session data without reading the accessor or changing policy", () => {
  const f = snapshotFixture(); let getterCalls = 0;
  try {
    const policy = f.registry.readPolicyText("DAT");
    f.context.connection = Object.defineProperty({ ...f.connection }, "account", {
      enumerable: true, get() { getterCalls++; return f.connection.account; }
    });
    assert.equal(f.panel.readProposalContext(), null);
    assert.equal(getterCalls, 0);
    assert.equal(f.registry.readPolicyText("DAT"), policy);
    f.context.connection = f.connection;
    assert.equal(f.panel.readProposalContext().policyText, policy);
    assert.equal(f.reads(), 0);
  } finally { f.panel.dispose(); }
});

test("proposal context capture cannot publish after session reflection invalidates or disposes its panel", () => {
  for (const action of ["invalidate", "dispose"]) {
    const f = snapshotFixture(); let callbacks = 0;
    try {
      f.context.connection = new Proxy(f.connection, {
        getOwnPropertyDescriptor(target, name) {
          if (name === "account" && callbacks++ === 0) f.panel[action]();
          return Reflect.getOwnPropertyDescriptor(target, name);
        }
      });
      assert.equal(f.panel.readProposalContext(), null, action);
      assert.ok(callbacks > 0, "Session reflection boundary must have run");
      assert.equal(f.registry.read("DAT"), null);
      assert.equal(f.reads(), 0);
    } finally { f.panel.dispose(); }
  }
});

test("demo context snapshots expose immutable bounded data without mutable sessions or implicit requests", async t => {
  const f = createWalletDemoProposalFixture(); t.after(() => f.dispose());
  await f.prepare("DAT");
  const rpcBefore = f.rpc.length, snapshot = f.app.readProposalContext("DAT");
  assert.deepEqual(Reflect.ownKeys(snapshot).sort(), ["policyText", "sessionState"]);
  assert.deepEqual(Reflect.ownKeys(snapshot.sessionState).sort(), ["account", "agent", "canBridge", "canSendTransactions",
    "canSign", "chainId", "connected", "connectionEpoch", "siteOrigin"]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.sessionState), true);
  assert.throws(() => { snapshot.sessionState.account = address("f"); }, TypeError);
  assert.throws(() => { snapshot.policyText = "{}"; }, TypeError);
  const parsed = JSON.parse(snapshot.policyText);
  parsed.account = address("f"); parsed.targets[0].tokenAddress = address("e");
  assert.deepEqual(f.app.readProposalContext("DAT"), snapshot);
  assert.equal(f.app.readProposalContext("EMA"), null);
  assert.equal(f.rpc.length, rpcBefore);
  assert.equal(f.requests.length, 0);
});

test("invalid agents and a disposed demo return before reflecting on hostile grant inputs", t => {
  const f = createWalletDemoProposalFixture(); t.after(() => f.dispose());
  let touched = 0;
  const touch = () => { touched++; throw Error("Hostile synthetic input was inspected"); };
  const hostile = new Proxy({}, { get: touch, ownKeys: touch, getPrototypeOf: touch, getOwnPropertyDescriptor: touch });
  for (const agent of ["dat", null, hostile]) {
    assert.equal(f.app.readProposalContext(agent), null);
    assert.equal(f.app.acceptProposalGrant(agent, hostile), false);
    assert.equal(f.app.revokeProposalGrant(agent), false);
  }
  f.app.dispose();
  assert.equal(f.app.readProposalContext("DAT"), null);
  assert.equal(f.app.acceptProposalGrant("DAT", hostile), false);
  assert.equal(f.app.revokeProposalGrant("DAT"), false);
  assert.equal(touched, 0);
  assert.equal(f.rpc.length, 0);
  assert.equal(f.requests.length, 0);
});

test("invalid accessor, origin and agent grant replacements preserve the previously accepted agent capability", async t => {
  let sentAuthorization;
  const f = createWalletDemoProposalFixture({ fetchImpl(_url, init, body) {
    sentAuthorization = init.headers.authorization; return f.response(body.agent);
  } });
  t.after(() => f.dispose());
  await f.prepare("DAT"); await f.prepare("EMA");
  const grant = f.grant("DAT"), rpcBefore = f.rpc.length;
  assert.equal(f.app.acceptProposalGrant("DAT", grant), true);
  let getters = 0;
  for (const key of ["agent", "token"]) {
    const invalid = Object.defineProperty({ ...grant }, key, {
      enumerable: true, get() { getters++; return grant[key]; }
    });
    assert.equal(f.app.acceptProposalGrant("DAT", invalid), false);
  }
  assert.equal(f.app.acceptProposalGrant("DAT", { ...grant, endpoint: "https://other-fixture.example/api/agent/proposal" }), false);
  assert.equal(f.app.acceptProposalGrant("EMA", grant), false);
  assert.equal(getters, 0);
  assert.equal(f.requests.length, 0);
  f.input("DAT", ".agent-proposal-objective", "Explicit synthetic proposal request");
  f.click("DAT", ".agent-proposal-model-request"); await f.settle("DAT");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.agent, "DAT");
  assert.equal(sentAuthorization, "Bearer " + grant.token);
  assert.equal(f.rpc.length, rpcBefore);
});

test("disposing during grant reflection makes the demo inert before an active transport abort can reenter", async t => {
  let started, transportSignal, reentry;
  const entered = new Promise(resolve => { started = resolve; });
  const f = createWalletDemoProposalFixture({ fetchImpl(_url, init) {
    transportSignal = init.signal;
    init.signal.addEventListener("abort", () => {
      reentry = { context: f.app.readProposalContext("DAT"),
        accepted: f.app.acceptProposalGrant("DAT", f.grant("DAT")),
        revoked: f.app.revokeProposalGrant("DAT") };
    }, { once: true });
    started(); return new Promise(() => {});
  } });
  t.after(() => f.dispose());
  await f.prepare("DAT");
  const grant = f.grant("DAT"), rpcBefore = f.rpc.length;
  assert.equal(f.app.acceptProposalGrant("DAT", grant), true);
  f.input("DAT", ".agent-proposal-objective", "Pending synthetic proposal request");
  const draft = f.card("DAT", ".agent-proposal-draft"), before = draft.value;
  f.click("DAT", ".agent-proposal-model-request"); await entered;
  let reflections = 0;
  const replacement = new Proxy({ ...grant, token: "e".repeat(64) }, {
    getOwnPropertyDescriptor(target, name) {
      if (name === "token" && reflections++ === 0) f.app.dispose();
      return Reflect.getOwnPropertyDescriptor(target, name);
    }
  });
  assert.equal(f.app.acceptProposalGrant("DAT", replacement), false);
  await demoProposalTick();
  assert.equal(reflections, 1);
  assert.equal(transportSignal.aborted, true);
  assert.deepEqual(reentry, { context: null, accepted: false, revoked: false });
  assert.equal(draft.value, before);
  assert.equal(f.rpc.length, rpcBefore);
  assert.equal(f.requests.length, 1);
});

test("local grant revocation preserves populated draft and observation history while another agent remains usable", async t => {
  const f = createWalletDemoProposalFixture(); t.after(() => f.dispose());
  await f.prepare("DAT"); await f.prepare("EMA");
  f.click("DAT", ".agent-proposal-inspect"); await f.settle("DAT");
  const draft = f.card("DAT", ".agent-proposal-draft").value;
  const history = f.card("DAT", ".agent-proposal-result").textContent;
  assert.equal(JSON.parse(history).result.observation.agent, "DAT");
  const context = f.app.readProposalContext("DAT"), rpcBefore = f.rpc.length;
  for (const agent of ["DAT", "EMA"]) {
    assert.equal(f.app.acceptProposalGrant(agent, f.grant(agent)), true);
    f.input(agent, ".agent-proposal-objective", "Explicit independent agent proposal");
  }
  assert.equal(f.app.revokeProposalGrant("DAT"), true);
  assert.deepEqual(f.app.readProposalContext("DAT"), context);
  assert.equal(f.card("DAT", ".agent-proposal-draft").value, draft);
  assert.equal(f.card("DAT", ".agent-proposal-result").textContent, history);
  assert.equal(f.card("DAT", ".agent-proposal-model-request").disabled, true);
  assert.equal(f.card("EMA", ".agent-proposal-model-request").disabled, false);
  assert.equal(f.requests.length, 0);
  f.click("EMA", ".agent-proposal-model-request"); await f.settle("EMA");
  assert.deepEqual(f.requests.map(request => request.body.agent), ["EMA"]);
  assert.equal(f.rpc.length, rpcBefore);
  assert.equal(f.card("DAT", ".agent-proposal-draft").value, draft);
  assert.equal(f.card("DAT", ".agent-proposal-result").textContent, history);
});

test("one listener cleanup failure cannot strand a proposal transport or permit late publication after demo disposal", async () => {
  let resolveResponse, started, signal;
  const entered = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { resolveResponse = resolve; });
  const f = createWalletDemoProposalFixture({ fetchImpl(_url, init) {
    signal = init.signal; started(); return pending;
  } });
  const originalRemove = f.eventTarget.removeEventListener;
  try {
    await f.prepare("DAT");
    const response = f.response("DAT"), draft = f.card("DAT", ".agent-proposal-draft");
    const originalDraft = draft.value;
    assert.equal(f.app.acceptProposalGrant("DAT", f.grant("DAT")), true);
    f.input("DAT", ".agent-proposal-objective", "Synthetic cleanup failure boundary");
    f.click("DAT", ".agent-proposal-model-request"); await entered;
    const removals = []; let injected = false, disposeThrew = false;
    f.eventTarget.removeEventListener = function (type, ...args) {
      removals.push(type);
      if (type === "pointerdown" && !injected) {
        injected = true; throw Error("SYNTHETIC_LISTENER_CLEANUP_FAILURE");
      }
      return Reflect.apply(originalRemove, this, [type, ...args]);
    };
    try { f.app.dispose(); } catch { disposeThrew = true; }
    const abortedAtDispose = signal.aborted;
    f.eventTarget.removeEventListener = originalRemove;
    f.app.dispose();
    resolveResponse(response); await demoProposalTick(); await demoProposalTick();
    assert.deepEqual({
      injected, disposeThrew, abortedAtDispose,
      remainingSecurityListenersAttempted: ["keydown", "pagehide", "pageshow"].every(type => removals.includes(type)),
      providerDisconnected: f.sessions.get("DAT").state.connected === false,
      cardRemoved: f.card("DAT") === null,
      lateDraftPublished: draft.value !== originalDraft,
      appContext: f.app.readProposalContext("DAT"), requests: f.requests.length,
    }, {
      injected: true, disposeThrew: false, abortedAtDispose: true,
      remainingSecurityListenersAttempted: true, providerDisconnected: true,
      cardRemoved: true, lateDraftPublished: false, appContext: null, requests: 1,
    });
  } finally {
    f.eventTarget.removeEventListener = originalRemove;
    resolveResponse(new Response("{}"));
    f.dispose();
  }
});
