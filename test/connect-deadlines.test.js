import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";

const ACCOUNT = "0x" + "11".repeat(20);
const BLOCK = { number: "0x2a", hash: "0x" + "ab".repeat(32) };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
function observe(promise) {
  const result = { status: "pending" };
  promise.then(value => Object.assign(result, { status: "fulfilled", value }),
    error => Object.assign(result, { status: "rejected", error }));
  return result;
}
function fixture(config = {}) {
  const calls = [], listeners = new Map();
  let override = () => undefined;
  const provider = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); },
    emit(event, value) { for (const fn of [...listeners.get(event) ?? []]) fn(value); },
    request(args) {
      const index = calls.length;
      calls.push(args);
      const value = override(args, index);
      if (value !== undefined) return Promise.resolve(value);
      switch (args.method) {
        case "eth_chainId": return Promise.resolve("0x2105");
        case "eth_requestAccounts":
        case "eth_accounts": return Promise.resolve([ACCOUNT]);
        case "eth_getBlockByNumber": return Promise.resolve({ ...BLOCK });
        case "eth_getBalance": return Promise.resolve("0x2a");
        default: throw Error("Forbidden request " + args.method);
      }
    },
  };
  const make = (extra = {}) => new ThreeCoreWalletSession({
    provider, agent: "DAT", expectedAccount: ACCOUNT, chainId: 8453,
    siteOrigin: "https://dex.example", approvedOrigins: ["https://dex.example"], ...config, ...extra,
  });
  function hold(index) {
    const gate = deferred(), entered = deferred();
    override = (args, current) => {
      if (current === index) { entered.resolve(); return gate.promise; }
    };
    return { ...gate, started: entered.promise };
  }
  return { wallet: make(), make, provider, calls, listeners, hold, setOverride: fn => { override = fn; } };
}
const stages = ["initial chain", "permission", "confirmed chain", "confirmed account"];
const stageValue = index => index === 0 || index === 2 ? "0x2105" : [ACCOUNT];

for (const [index, label] of stages.entries()) {
  test(`${label} has a deadline and leaves no connected session`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture({ connectTimeoutMs: 100, permissionTimeoutMs: 200 }), gate = f.hold(index);
    t.after(() => { gate.resolve(stageValue(index)); f.wallet.disconnect(); });
    const pending = observe(f.wallet.connect());
    await gate.started;
    const duration = index === 1 ? 200 : 100;
    t.mock.timers.tick(duration - 1);
    await flush();
    assert.equal(pending.status, "pending");
    t.mock.timers.tick(1);
    await flush();
    assert.equal(pending.status, "rejected");
    assert.equal(pending.error.code, index === 1 ? "PERMISSION_TIMEOUT" : "CONNECT_TIMEOUT");
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.wallet.state.account, null);
    assert.equal(f.calls.length, index + 1, "No subsequent step or automatic retry");
    assert.ok([...f.listeners.values()].every(set => set.size === 0));
  });

  test(`${label} can be manually cancelled without a provider reply`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(), gate = f.hold(index);
    const pending = observe(f.wallet.connect());
    await gate.started;
    f.wallet.disconnect();
    await flush();
    assert.equal(pending.status, "rejected");
    assert.equal(pending.error.code, "SESSION_CANCELLED");
    assert.equal(f.calls.length, index + 1);
    gate.resolve(stageValue(index));
    await flush();
    assert.equal(f.wallet.state.connected, false);
    assert.equal((await f.wallet.connect()).connected, true);
    const state = f.wallet.state;
    t.mock.timers.tick(300_000);
    await flush();
    assert.deepEqual(f.wallet.state, state, "Old deadline must be cleared");
    f.wallet.disconnect();
  });
}

for (const [index, duration] of [[0, 30_000], [1, 120_000]]) {
  test(`default ${stages[index]} deadline is ${duration}ms`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(), gate = f.hold(index);
    t.after(() => { gate.resolve(stageValue(index)); f.wallet.disconnect(); });
    const pending = observe(f.wallet.connect());
    await gate.started;
    t.mock.timers.tick(duration - 1);
    await flush();
    assert.equal(pending.status, "pending");
    t.mock.timers.tick(1);
    await flush();
    assert.equal(pending.status, "rejected");
    assert.equal(pending.error.code, index === 1 ? "PERMISSION_TIMEOUT" : "CONNECT_TIMEOUT");
  });
}

for (const [setting, maximum] of [["connectTimeoutMs", 120_000], ["permissionTimeoutMs", 300_000]]) {
  for (const invalid of [0, -1, 1.5, maximum + 1, Infinity, NaN, "100", null]) {
    test(`${setting} rejects ${String(invalid)} before sending requests`, () => {
      assert.throws(() => fixture({ [setting]: invalid }), { code: "INVALID_CONNECT_TIMEOUT" });
    });
  }
}

for (const ending of ["timeout", "disconnect"]) {
  for (const late of ["resolve", "reject"]) {
    test(`permission ${ending} blocks duplicate prompts until its late ${late}`, async t => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const f = fixture({ permissionTimeoutMs: 100 }), gate = f.hold(1);
      const connection = f.wallet.connect(), pending = observe(connection);
      await gate.started;
      assert.equal(f.wallet.connect(), connection, "Same active connect is shared");
      if (ending === "timeout") t.mock.timers.tick(100); else f.wallet.disconnect();
      await flush();
      assert.equal(pending.status, "rejected");
      const count = f.calls.length;
      const replacement = f.make();
      await assert.rejects(f.wallet.connect(), { code: "PERMISSION_PENDING" });
      await assert.rejects(replacement.connect(), { code: "PERMISSION_PENDING" });
      assert.equal(f.calls.length, count, "No RPC or duplicate permission prompt while blocked");
      gate[late](late === "resolve" ? [ACCOUNT] : Object.assign(Error("Old prompt rejected"), { code: 4001 }));
      await flush();
      assert.equal(f.wallet.state.connected, false);
      assert.equal(replacement.state.connected, false, "Old permission cannot connect automatically");
      assert.equal((await replacement.connect()).connected, true);
      assert.equal(f.calls.filter(x => x.method === "eth_requestAccounts").length, 2);
      replacement.disconnect();
    });
  }
}

for (const index of [0, 2, 3]) {
  for (const late of ["resolve", "reject"]) {
    test(`late ${late} from ${stages[index]} cannot damage a reconnected session`, async t => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const f = fixture({ connectTimeoutMs: 100 }), gate = f.hold(index);
      const pending = observe(f.wallet.connect());
      await gate.started;
      t.mock.timers.tick(100);
      await flush();
      assert.equal(pending.status, "rejected");
      assert.equal((await f.wallet.connect()).connected, true);
      const state = f.wallet.state;
      gate[late](late === "resolve" ? "wrong late response" : Object.assign(Error("Old failure"), { code: 4900 }));
      await flush();
      assert.deepEqual(f.wallet.state, state);
      assert.equal(await f.wallet.getNativeBalance(), 42n);
      f.wallet.disconnect();
    });
  }
}

for (const [event, value] of [["accountsChanged", []], ["chainChanged", "0x1"], ["disconnect", {}]]) {
  test(`${event} ends permission waiting while preserving the outstanding-prompt guard`, async () => {
    const f = fixture(), gate = f.hold(1), pending = observe(f.wallet.connect());
    await gate.started;
    f.provider.emit(event, value);
    await flush();
    assert.equal(pending.status, "rejected");
    assert.equal(pending.error.code, "SESSION_CANCELLED");
    await assert.rejects(f.make().connect(), { code: "PERMISSION_PENDING" });
    gate.resolve([ACCOUNT]);
    await flush();
  });
}

test("an outstanding prompt on one provider does not block another provider", async () => {
  const first = fixture(), other = fixture(), gate = first.hold(1);
  const pending = observe(first.wallet.connect());
  await gate.started;
  first.wallet.disconnect();
  assert.equal((await other.wallet.connect()).connected, true);
  gate.resolve([ACCOUNT]);
  await flush();
  assert.equal(pending.error.code, "SESSION_CANCELLED");
  other.wallet.disconnect();
});

test("simultaneous sessions racing through prechecks create only one permission request", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  f.setOverride(({ method }) => {
    if (method === "eth_requestAccounts") { entered.resolve(); return gate.promise; }
  });
  const other = f.make(), first = observe(f.wallet.connect()), second = observe(other.connect());
  await entered.promise;
  await flush();
  assert.equal(f.calls.filter(x => x.method === "eth_requestAccounts").length, 1);
  assert.equal(first.status, "pending");
  assert.equal(second.status, "rejected");
  assert.equal(second.error.code, "PERMISSION_PENDING");
  gate.resolve([ACCOUNT]);
  await flush();
  assert.equal(first.status, "fulfilled");
  assert.equal(other.state.connected, false);
  f.wallet.disconnect();
});

test("a synchronous disconnect while opening permission settles locally and retains the prompt guard", async () => {
  const f = fixture(), gate = deferred();
  f.setOverride(({ method }) => {
    if (method === "eth_requestAccounts") {
      f.provider.emit("disconnect", {});
      return gate.promise;
    }
  });
  await assert.rejects(f.wallet.connect(), { code: "SESSION_CANCELLED" });
  const count = f.calls.length;
  await assert.rejects(f.make().connect(), { code: "PERMISSION_PENDING" });
  assert.equal(f.calls.length, count);
  gate.resolve([ACCOUNT]);
  await flush();
  f.setOverride(() => undefined);
  assert.equal((await f.wallet.connect()).connected, true);
  f.wallet.disconnect();
});

for (const sync of [true, false]) {
  test(`${sync ? "synchronous" : "asynchronous"} permission failure releases the prompt guard`, async () => {
    const f = fixture(), error = Object.assign(Error("Denied"), { code: 4001 });
    f.setOverride(({ method }) => {
      if (method === "eth_requestAccounts") {
        if (sync) throw error;
        return Promise.reject(error);
      }
    });
    await assert.rejects(f.wallet.connect(), actual => actual === error);
    f.setOverride(() => undefined);
    assert.equal((await f.wallet.connect()).connected, true);
    f.wallet.disconnect();
  });
}

test("cancelling and immediately reconnecting cannot let an old finally erase the new pending operation", async () => {
  const f = fixture(), first = f.hold(0), old = observe(f.wallet.connect());
  await first.started;
  f.wallet.disconnect();
  const second = f.hold(1), current = f.wallet.connect();
  await second.started;
  await flush();
  assert.equal(old.error.code, "SESSION_CANCELLED");
  assert.equal(f.wallet.connect(), current);
  first.resolve("0x1");
  second.resolve("0x2105");
  assert.equal((await current).connected, true);
  f.wallet.disconnect();
});

for (const index of [0, 1]) {
  test(`controller recovers from ${stages[index]} timeout without duplicating permission`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(), gate = f.hold(index);
    const controller = createWalletCardController({ agent: "DAT", siteOrigin: "https://dex.example",
      createSession: args => new ThreeCoreWalletSession({ ...args, connectTimeoutMs: 100, permissionTimeoutMs: 100 }) });
    t.after(() => { gate.resolve(stageValue(index)); controller.dispose(); });
    const connect = () => controller.connect({ provider: f.provider, account: ACCOUNT, chainId: 8453 });
    const pending = observe(connect());
    await gate.started;
    t.mock.timers.tick(100);
    await flush();
    assert.equal(pending.value, false);
    assert.equal(controller.state.phase, "disconnected");
    assert.equal(controller.state.result, null);
    assert.match(controller.state.error, index === 1 ? /許可.*再接続/ : /応答.*再接続/);
    if (index === 1) {
      const count = f.calls.length;
      assert.equal(await connect(), false);
      assert.match(controller.state.error, /許可画面.*再接続/);
      assert.equal(f.calls.length, count);
      gate.resolve([ACCOUNT]);
      await flush();
    }
    assert.equal(await connect(), true);
    assert.equal(await controller.readBalances(), true);
  });
}
