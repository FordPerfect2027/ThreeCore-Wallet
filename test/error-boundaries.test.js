import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";

const ACCOUNT = "0x" + "11".repeat(20);
const BLOCK = { number: "0x2a", hash: "0x" + "ab".repeat(32) };
const options = { agent: "DAT", siteOrigin: "http://localhost:4173" };
const failures = [
  ["null", () => null],
  ["undefined", () => undefined],
  ["string", () => "Synthetic rejection"],
  ["throwing code getter", () => ({ get code() { throw Error("Unreadable code"); } })],
  ["throwing message getter", () => ({ get message() { throw Error("Unreadable message"); } })],
  ["revoked proxy", () => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy; }],
  ["non-primitive properties", () => ({
    code: { [Symbol.toPrimitive]() { throw Error("Never coerce code"); } },
    message: { toString() { throw Error("Never stringify message"); } },
  })],
];

function fixture() {
  let override = () => undefined;
  const calls = [], listeners = new Map();
  const provider = {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    request(args) {
      calls.push(args);
      const result = override(args);
      if (result !== undefined) return result;
      switch (args.method) {
        case "eth_chainId": return Promise.resolve("0x2105");
        case "eth_accounts":
        case "eth_requestAccounts": return Promise.resolve([ACCOUNT]);
        case "eth_getBlockByNumber": return Promise.resolve({ ...BLOCK });
        case "eth_getBalance": return Promise.resolve("0x2a");
        default: throw Error("Forbidden fixture RPC: " + args.method);
      }
    },
  };
  const session = new ThreeCoreWalletSession({
    ...options, provider, expectedAccount: ACCOUNT, chainId: 8453,
    approvedOrigins: [options.siteOrigin],
  });
  const controller = createWalletCardController(options);
  return { provider, session, controller, calls, listeners,
    connect: () => controller.connect({ provider, account: ACCOUNT, chainId: 8453 }),
    override: fn => { override = fn; },
  };
}

for (const [label, makeFailure] of failures) {
  test(`connection recovers from ${label} without leaving a pending UI`, async () => {
    const f = fixture(), error = makeFailure();
    f.override(({ method }) => method === "eth_requestAccounts" ? Promise.reject(error) : undefined);
    assert.equal(await f.connect(), false);
    assert.equal(f.controller.state.phase, "disconnected");
    assert.equal(f.controller.state.result, null);
    assert.equal(typeof f.controller.state.error, "string");
    assert.ok(f.controller.state.error.length > 0);
    assert.ok([...f.listeners.values()].every(set => set.size === 0));
    assert.equal(f.calls.filter(x => x.method === "eth_requestAccounts").length, 1);
    f.override(() => undefined);
    assert.equal(await f.connect(), true);
    assert.equal(await f.controller.readBalances(), true);
    assert.equal(f.controller.state.result.nativeBalanceBaseUnits, "42");
    f.controller.dispose();
  });

  test(`read recovers from ${label} and clears the previous result`, async () => {
    const f = fixture(), error = makeFailure();
    await f.connect();
    await f.controller.readBalances();
    f.override(({ method }) => method === "eth_getBalance" ? Promise.reject(error) : undefined);
    assert.equal(await f.controller.readBalances(), false);
    assert.equal(f.controller.state.phase, "connected");
    assert.equal(f.controller.state.result, null);
    assert.equal(typeof f.controller.state.error, "string");
    assert.ok(f.controller.state.error.length > 0);
    f.override(() => undefined);
    assert.equal(await f.controller.readBalances(), true);
    assert.equal(f.calls.filter(x => x.method === "eth_requestAccounts").length, 1);
    f.controller.dispose();
  });

  test(`session preserves the original ${label} rejection`, async () => {
    const f = fixture(), error = makeFailure();
    await f.session.connect();
    f.override(({ method }) => method === "eth_getBalance" ? Promise.reject(error) : undefined);
    await f.session.getNativeBalance().then(
      () => assert.fail("Expected rejection"),
      actual => assert.ok(actual === error, "Original rejection identity is preserved"),
    );
    assert.equal(f.session.state.connected, true);
    f.session.disconnect();
  });
}

test("a readable terminal code still disconnects when its message getter throws", async () => {
  const f = fixture();
  await f.connect();
  await f.controller.readBalances();
  f.override(({ method }) => method === "eth_getBalance" ? Promise.reject({
    code: 4900, get message() { throw Error("No message"); },
  }) : undefined);
  assert.equal(await f.controller.readBalances(), false);
  assert.equal(f.controller.state.phase, "disconnected");
  assert.equal(f.controller.state.connection, null);
  assert.equal(f.controller.state.result, null);
  assert.ok(f.controller.state.error.length > 0);
});

test("throwing cleanup accessor cannot retain a connected view or stale result", async () => {
  const f = fixture();
  await f.connect();
  await f.controller.readBalances();
  const oldListeners = [...f.listeners.values()].flatMap(set => [...set]);
  Object.defineProperty(f.provider, "removeListener", { configurable: true,
    get() { throw Error("Cleanup accessor failed"); },
  });
  assert.doesNotThrow(() => f.controller.disconnect());
  assert.equal(f.controller.state.phase, "disconnected");
  assert.equal(f.controller.state.connection, null);
  assert.equal(f.controller.state.result, null);
  assert.equal(await f.connect(), true);
  const fresh = f.controller.state;
  for (const listener of oldListeners) listener([]);
  assert.equal(f.controller.state, fresh, "Unremovable old callbacks are inert");
  assert.equal(await f.controller.readBalances(), true);
  assert.doesNotThrow(() => f.controller.dispose());
  assert.equal(f.controller.state.phase, "disposed");
});

test("cleanup accessor failure does not replace the connection rejection", async () => {
  const f = fixture(), error = Error("Permission denied");
  Object.defineProperty(f.provider, "removeListener", { get() { throw Error("Cleanup failed"); } });
  f.override(({ method }) => method === "eth_requestAccounts" ? Promise.reject(error) : undefined);
  await assert.rejects(f.session.connect(), actual => actual === error);
  assert.equal(f.session.state.connected, false);
});

test("disconnect during error inspection cannot restore the read view", async () => {
  const f = fixture();
  await f.connect();
  f.override(({ method }) => method === "eth_getBalance" ? Promise.reject({
    get message() { f.controller.disconnect(); return "Old error"; },
  }) : undefined);
  assert.equal(await f.controller.readBalances(), false);
  assert.equal(f.controller.state.phase, "disconnected");
  assert.equal(f.controller.state.result, null);
});
