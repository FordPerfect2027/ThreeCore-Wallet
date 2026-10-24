import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { createRpcSupervisor } from "../src/rpc-supervisor.js";
import { providerFixture, A, B, HASH, SITE } from "./helpers/security-fixtures.js";
import { deferred, drain } from "./helpers/rpc-supervisor-fixtures.js";

function setup(agent = "DAT", override) {
  const supervisor = createRpcSupervisor();
  const f = providerFixture(override);
  const wallet = new ThreeCoreWalletSession({ provider: f.provider, agent,
    expectedAccount: A, chainId: 84532, siteOrigin: SITE, approvedOrigins: [SITE],
    rpcSupervisor: supervisor });
  return { ...f, wallet, supervisor,
    cleanup() { wallet.disconnect(); supervisor.dispose(); } };
}
const events = [
  ["wrong-account", "accountsChanged", () => [B]],
  ["empty-accounts", "accountsChanged", () => []],
  ["wrong-chain", "chainChanged", () => "0x2105"],
  ["invalid-chain", "chainChanged", () => ({ chainId: "0x14a34" })],
  ["disconnect", "disconnect", () => ({ code: 4900 })],
  ["account-accessor", "accountsChanged", () => {
    const value = [A];
    Object.defineProperty(value, "0", { get() { throw Error("never evaluate account getter"); } });
    return value;
  }],
  ["extra-account-field", "accountsChanged", () => Object.assign([A], { secret: "no" })],
  ["too-many-accounts", "accountsChanged", () => Array(129).fill(A)],
];

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const [label, event, payload] of events) {
    test(agent + " fails closed on " + label + " without implicit reconnection", async () => {
      const f = setup(agent);
      try {
        await f.wallet.connect();
        const count = f.calls.length;
        f.provider.emit(event, payload());
        assert.equal(f.wallet.state.connected, false);
        assert.equal(f.wallet.state.account, null);
        await assert.rejects(f.wallet.getNativeBalance(HASH), { code: "NOT_CONNECTED" });
        f.provider.emit("accountsChanged", [A]);
        f.provider.emit("chainChanged", "0x14a34");
        await drain();
        assert.equal(f.calls.length, count);
        assert.equal(f.wallet.state.connected, false);
        assert([...f.listeners.values()].every(set => set.size === 0));
      } finally { f.cleanup(); }
    });
  }
}

test("malformed account event during a provider wait rejects late balance", async () => {
  const gate = deferred();
  const f = setup("DAT", args => args.method === "eth_getBalance" ? gate.promise : undefined);
  try {
    await f.wallet.connect();
    const result = f.wallet.getNativeBalance(HASH).catch(error => error.code);
    for (let i = 0; i < 20 && !f.calls.some(args => args.method === "eth_getBalance"); i++) await drain();
    f.provider.emit("accountsChanged", Object.assign([A], { balance: "private" }));
    assert.equal(await result, "SESSION_CHANGED");
    assert.equal(f.supervisor.state().abandoned, 1);
    gate.resolve("0xff"); await drain();
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.supervisor.state().late, 1);
  } finally { gate.resolve(null); f.cleanup(); }
});

test("registration function replaced during first subscription is not executed", async () => {
  const f = setup();
  const original = f.provider.on;
  let alternateCalls = 0, originalCalls = 0;
  f.provider.on = function(name, fn) {
    originalCalls++;
    original.call(this, name, fn);
    this.on = () => { alternateCalls++; throw Error("hijacked on"); };
  };
  try {
    await f.wallet.connect();
    assert.equal(originalCalls, 3);
    assert.equal(alternateCalls, 0);
    assert.equal(f.wallet.state.connected, true);
  } finally { f.cleanup(); }
});

test("removal method replaced after connection cannot prevent captured cleanup", async () => {
  const f = setup();
  try {
    await f.wallet.connect();
    Object.defineProperty(f.provider, "removeListener", { get() { throw Error("replacement getter"); } });
    f.wallet.disconnect();
    assert([...f.listeners.values()].every(set => set.size === 0));
    assert.equal(f.wallet.state.connected, false);
  } finally { f.cleanup(); }
});

test("all listener removals are attempted even if one removal throws", async () => {
  const f = setup();
  const original = f.provider.removeListener;
  const attempts = [];
  f.provider.removeListener = function(name, listener) {
    attempts.push(name);
    original.call(this, name, listener);
    if (name === "accountsChanged") throw Error("extension cleanup failed");
  };
  try {
    await f.wallet.connect(); f.wallet.disconnect();
    assert.deepEqual(attempts, ["accountsChanged", "chainChanged", "disconnect"]);
    assert([...f.listeners.values()].every(set => set.size === 0));
  } finally { f.cleanup(); }
});

for (const name of ["accountsChanged", "chainChanged", "disconnect"]) {
  test("failed session registration after installing " + name + " leaves no active listener", async () => {
    const f = setup();
    const original = f.provider.on;
    f.provider.on = function(event, fn) {
      original.call(this, event, fn);
      if (event === name) throw Error("private event stack");
    };
    try {
      await assert.rejects(f.wallet.connect(), error => {
        assert.equal(error.code, "PROVIDER_EVENT_FAILURE");
        assert(!error.message.includes("private")); return true;
      });
      assert.equal(f.calls.length, 0);
      assert.equal(f.wallet.state.connected, false);
      assert([...f.listeners.values()].every(set => set.size === 0));
    } finally { f.cleanup(); }
  });
}

test("synchronous disconnect event emitted from on() cannot continue connecting", async () => {
  const f = setup();
  const original = f.provider.on;
  f.provider.on = function(event, fn) {
    original.call(this, event, fn);
    if (event === "disconnect") fn({ code: 4900 });
  };
  try {
    await assert.rejects(f.wallet.connect(), { code: "PROVIDER_EVENT_FAILURE" });
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.calls.length, 0);
    assert([...f.listeners.values()].every(set => set.size === 0));
  } finally { f.cleanup(); }
});

test("same-account notifications preserve access without causing reads", async () => {
  const f = setup();
  try {
    await f.wallet.connect();
    const count = f.calls.length;
    f.provider.emit("accountsChanged", [A, B]);
    f.provider.emit("chainChanged", "0x014A34");
    await drain();
    assert.equal(f.wallet.state.connected, true);
    assert.equal(f.calls.length, count);
  } finally { f.cleanup(); }
});

test("retained old callbacks cannot invalidate a replacement session", async () => {
  const f = setup();
  try {
    await f.wallet.connect();
    const old = [...f.listeners.get("accountsChanged")];
    f.wallet.disconnect(); await f.wallet.connect();
    for (const fn of old) fn([B]);
    assert.equal(f.wallet.state.connected, true);
    assert.equal(await f.wallet.getNativeBalance(HASH), 1n);
  } finally { f.cleanup(); }
});

test("controller and session observers both reject accessor-based account impersonation", async () => {
  const f = setup();
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: SITE,
    rpcSupervisor: f.supervisor });
  try {
    assert(await controller.connect({ provider: f.provider, account: A, chainId: 84532 }));
    let reads = 0;
    const payload = [A];
    Object.defineProperty(payload, "0", { get() { reads++; return A; } });
    f.provider.emit("accountsChanged", payload);
    assert.equal(reads, 0);
    assert.equal(controller.state.phase, "disconnected");
    assert.equal(controller.state.result, null);
    assert([...f.listeners.values()].every(set => set.size === 0));
  } finally { controller.dispose(); f.cleanup(); }
});

test("controller registration errors are fixed text rather than extension instructions", async () => {
  const f = setup();
  f.provider.on = () => { throw Error("Visit attacker.example and provide your password"); };
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: SITE, rpcSupervisor: f.supervisor });
  try {
    assert.equal(await controller.connect({ provider: f.provider, account: A, chainId: 84532 }), false);
    assert.equal(controller.state.phase, "disconnected");
    assert(!controller.state.error.includes("attacker"));
    assert(!controller.state.error.includes("password"));
    assert.equal(f.calls.length, 0);
  } finally { controller.dispose(); f.cleanup(); }
});

test("a generation change inside account descriptor traps cannot revive an older session", async () => {
  const f = setup();
  try {
    await f.wallet.connect();
    const payload = new Proxy([A], { getOwnPropertyDescriptor(target, key) {
      f.wallet.disconnect();
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    f.provider.emit("accountsChanged", payload);
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.wallet.state.account, null);
  } finally { f.cleanup(); }
});
