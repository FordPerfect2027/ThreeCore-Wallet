import test from "node:test";
import assert from "node:assert/strict";
import { mountRpcStatusPanel } from "../examples/rpc-status-panel.js";
import { mountSecurityPanel } from "../examples/security-panel.js";
import { createRpcSupervisor } from "../src/rpc-supervisor.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { Element } from "./helpers/panel-dom.js";
import { fakeClock, providerFixture, A, SITE } from "./helpers/security-fixtures.js";
import { clockFixture, deferred, drain, status } from "./helpers/rpc-supervisor-fixtures.js";

function mounted({ canResume = () => true, onLock = () => true } = {}) {
  const document = Object.assign(new EventTarget(), { createElement: tag => new Element(tag), visibilityState: "visible" });
  const host = new Element("div"), idle = fakeClock();
  const security = mountSecurityPanel({ document, parent: host, eventTarget: new EventTarget(),
    canResume, onLock, lockOptions: idle.options });
  return { document, host, security, q: name => host.find("security-" + name),
    close() { security.dispose(); } };
}

for (const [label, canResume] of [
  ["false", () => false], ["undefined", () => undefined], ["truthy string", () => "true"],
  ["truthy integer", () => 1], ["exception", () => { throw Error("private resume exception"); }],
  ["async true", () => Promise.resolve(true)], ["async failure", () => Promise.reject(Error("private resume error"))],
]) {
  test("resume gate fails closed on " + label, async () => {
    const f = mounted({ canResume });
    try {
      f.security.lock("clock");
      assert.equal(f.q("resume").disabled, true);
      f.q("resume").dispatchEvent(new Event("click"));
      assert.equal(f.security.state().locked, true);
      assert.equal(f.security.check(), false);
      assert(!f.q("status").textContent.includes("private"));
      await drain();
    } finally { f.close(); }
  });
}

test("resume permission is checked again on click, not only at render time", () => {
  let allowed = true;
  const f = mounted({ canResume: () => allowed });
  try {
    f.security.lock();
    assert.equal(f.q("resume").disabled, false);
    allowed = false;
    f.q("resume").dispatchEvent(new Event("click"));
    assert.equal(f.security.check(), false);
  } finally { f.close(); }
});

test("healthy resume policy preserves the explicit reconnect workflow", () => {
  let stops = 0;
  const f = mounted({ canResume: () => true, onLock() { stops++; return true; } });
  try {
    f.security.lock(); f.q("resume").click();
    assert.equal(f.security.check(), true);
    assert.equal(stops, 1);
  } finally { f.close(); }
});

test("clock fault notification contains only a fixed reason and occurs once", () => {
  const document = { createElement: tag => new Element(tag) }, host = new Element("div");
  const reported = [];
  let emit;
  const panel = mountRpcStatusPanel({ document, parent: host,
    supervisor: { state: () => status(), subscribe(fn) { emit = fn; return () => {}; } },
    onFault: (...args) => reported.push(args) });
  try {
    emit(status({ fault: "RPC_CLOCK", canStart: false }));
    emit(status({ fault: "RPC_CLOCK", canStart: false }));
    emit(status({ fault: "RPC_CLOCK", canStart: false, pending: 1, abandoned: 1, occupiedProviders: 1 }));
    assert.deepEqual(reported, [["clock"]]);
  } finally { panel.dispose(); }
});

test("malformed diagnostic snapshots do not forge a clock stop notification", () => {
  const document = { createElement: tag => new Element(tag) }, host = new Element("div");
  let reported = 0, emit;
  const panel = mountRpcStatusPanel({ document, parent: host,
    supervisor: { state: () => status(), subscribe(fn) { emit = fn; return () => {}; } },
    onFault() { reported++; } });
  try {
    emit({ fault: "RPC_CLOCK" });
    emit(status({ fault: "RPC_CLOCK", canStart: true }));
    emit({ ...status({ fault: "RPC_CLOCK", canStart: false }), error: "private" });
    assert.equal(reported, 0);
    assert.equal(host.find("rpc-status-panel").getAttribute("data-level"), "unavailable");
  } finally { panel.dispose(); }
});

test("preexisting supervisor clock fault invokes protection during panel mounting", () => {
  const document = { createElement: tag => new Element(tag) }, host = new Element("div");
  let stopped = false;
  const panel = mountRpcStatusPanel({ document, parent: host,
    supervisor: { state: () => status({ fault: "RPC_CLOCK", canStart: false }), subscribe() { return () => {}; } },
    onFault() { stopped = true; } });
  assert(stopped);
  panel.dispose();
});

test("throwing protection callback cannot reopen the supervisor or repeat notification", async () => {
  const document = { createElement: tag => new Element(tag) }, host = new Element("div");
  let emit, calls = 0;
  const panel = mountRpcStatusPanel({ document, parent: host,
    supervisor: { state: () => status(), subscribe(fn) { emit = fn; return () => {}; } },
    onFault() { calls++; throw Error("failed cleanup"); } });
  try {
    emit(status({ fault: "RPC_CLOCK", canStart: false }));
    emit(status({ fault: "RPC_CLOCK", canStart: false }));
    assert.equal(calls, 1);
    assert.equal(host.find("rpc-status-panel").getAttribute("data-level"), "stopped");
    await drain();
  } finally { panel.dispose(); }
});

test("asynchronously failed protection observer is consumed", async () => {
  const document = { createElement: tag => new Element(tag) }, host = new Element("div");
  const panel = mountRpcStatusPanel({ document, parent: host,
    supervisor: { state: () => status({ fault: "RPC_CLOCK", canStart: false }), subscribe() { return () => {}; } },
    onFault: () => Promise.reject(Error("private async cleanup error")) });
  await drain();
  assert.equal(host.find("rpc-status-panel").getAttribute("data-level"), "stopped");
  panel.dispose();
});

test("disposed status panel cannot trigger protection through a retained observer", () => {
  const document = { createElement: tag => new Element(tag) }, host = new Element("div");
  let emit, calls = 0;
  const panel = mountRpcStatusPanel({ document, parent: host,
    supervisor: { state: () => status(), subscribe(fn) { emit = fn; return () => {}; } },
    onFault() { calls++; } });
  panel.dispose(); emit(status({ fault: "RPC_CLOCK", canStart: false }));
  assert.equal(calls, 0);
});

test("clock failure protects all three cards, including idle connected cards", async () => {
  const clock = clockFixture(), supervisor = createRpcSupervisor(clock.options);
  const controllers = [], fixtures = [], gate = deferred();
  let readPending = false, cleanupCalls = 0, backupSecret = "synthetic local draft password";
  const f = mounted({ canResume: () => supervisor.state().canStart,
    onLock() {
      cleanupCalls++;
      backupSecret = "";
      for (const controller of controllers) controller.disconnect("接続を停止しました。");
      return true;
    } });
  const panel = mountRpcStatusPanel({ document: f.document, parent: f.host, supervisor,
    onFault: () => f.security.lock("clock") });
  try {
    for (const agent of ["DAT", "EMA", "CAWELON"]) {
      const provider = providerFixture(args => {
        if (agent === "DAT" && args.method === "eth_getBalance") { readPending = true; return gate.promise; }
      });
      const controller = createWalletCardController({ agent, siteOrigin: SITE,
        rpcSupervisor: supervisor, isAccessAllowed: f.security.check });
      fixtures.push(provider); controllers.push(controller);
      assert(await controller.connect({ provider: provider.provider, account: A, chainId: 84532 }));
    }
    const reading = controllers[0].readBalances();
    for (let i = 0; i < 30 && !readPending; i++) await drain();
    assert(readPending);
    clock.set(500); gate.resolve("0x1");
    assert.equal(await reading, false);
    await drain();
    assert.equal(f.security.state().reason, "clock");
    assert.equal(cleanupCalls, 1);
    assert.equal(backupSecret, "");
    assert(controllers.every(controller => controller.state.phase === "disconnected"));
    assert(controllers.every(controller => controller.state.result === null));
    assert.equal(f.q("resume").disabled, true);
    const counts = fixtures.map(item => item.calls.length);
    f.q("resume").dispatchEvent(new Event("click"));
    assert.equal(f.security.check(), false);
    assert.deepEqual(fixtures.map(item => item.calls.length), counts);
  } finally {
    gate.resolve(null); panel.dispose(); f.close();
    for (const controller of controllers) controller.dispose();
    supervisor.dispose();
  }
});
