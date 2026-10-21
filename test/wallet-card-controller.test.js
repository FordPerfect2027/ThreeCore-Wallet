import test from "node:test";
import assert from "node:assert/strict";
import { createWalletCardController } from "../src/wallet-card-controller.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const SPENDER = "0x4444444444444444444444444444444444444444";
const HASH = "0x" + "ab".repeat(32);
const BLOCK = { number: "0x2a", hash: HASH };
const options = { tokenAddress: TOKEN, spenderAddress: SPENDER };
const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(override = () => undefined) {
  const calls = [], views = [], listeners = new Map();
  const provider = {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, value) { for (const fn of [...listeners.get(name) ?? []]) fn(value); },
    async request(args) {
      calls.push(args);
      const custom = await override(args);
      if (custom !== undefined) return custom;
      switch (args.method) {
        case "eth_chainId": return "0x2105";
        case "eth_requestAccounts":
        case "eth_accounts": return [A];
        case "eth_getBlockByNumber": return { ...BLOCK };
        case "eth_getBalance": return "0x10";
        case "eth_getCode": return "0x6000";
        case "eth_call": return word(42);
        default: throw Error("Forbidden method: " + args.method);
      }
    },
  };
  const controller = createWalletCardController({
    agent: "DAT", siteOrigin: "http://localhost:4173", onChange: state => views.push(state),
  });
  return { controller, provider, calls, views, listeners,
    connect: () => controller.connect({ provider, account: A, chainId: 8453 }) };
}

test("repeated pending Connect actions share a single permission request", async () => {
  const gate = deferred(), entered = deferred();
  const f = fixture(({ method }) => {
    if (method === "eth_requestAccounts") { entered.resolve(); return gate.promise; }
  });
  const first = f.connect();
  await entered.promise;
  assert.equal(await f.controller.readBalances(options), false);
  const second = f.connect();
  assert.equal(first, second);
  gate.resolve([A]);
  assert.equal(await first, true);
  assert.equal(f.calls.filter(x => x.method === "eth_requestAccounts").length, 1);
  assert.equal(f.controller.state.phase, "connected");
});

for (const failure of [false, true]) {
  test(`disconnect during connection ignores the delayed ${failure ? "error" : "success"}`, async () => {
    const gate = deferred(), entered = deferred();
    const f = fixture(({ method }) => {
      if (method === "eth_requestAccounts") { entered.resolve(); return gate.promise; }
    });
    const pending = f.connect();
    await entered.promise;
    f.controller.disconnect();
    const view = f.controller.state;
    if (failure) gate.reject(Error("Old permission error")); else gate.resolve([A]);
    assert.equal(await pending, false);
    assert.equal(f.controller.state, view);
    assert.equal(f.controller.state.result, null);
  });
}

for (const operation of ["readBalances", "inspect"]) {
  test(`${operation} cannot overwrite a later disconnect`, async () => {
    const gate = deferred(), entered = deferred();
    const f = fixture(({ method }) => {
      if (method === "eth_getBlockByNumber") { entered.resolve(); return gate.promise; }
    });
    await f.connect();
    const pending = f.controller[operation](options);
    await entered.promise;
    f.controller.disconnect();
    const view = f.controller.state;
    gate.resolve({ ...BLOCK });
    assert.equal(await pending, false);
    assert.equal(f.controller.state, view);
  });
}

test("a slow older read cannot overwrite a newer completed result", async () => {
  const gate = deferred(), entered = deferred();
  let nativeCalls = 0;
  const f = fixture(({ method }) => {
    if (method === "eth_getBalance" && ++nativeCalls === 1) { entered.resolve(); return gate.promise; }
  });
  await f.connect();
  const first = f.controller.readBalances(options);
  await entered.promise;
  assert.equal(await f.controller.readBalances({}), true);
  const newest = f.controller.state;
  gate.resolve("0xff");
  assert.equal(await first, false);
  assert.equal(f.controller.state, newest);
  assert.equal(newest.result.nativeBalanceBaseUnits, "16");
});

test("changing token inputs clears visible results and discards pending reads", async () => {
  const gate = deferred(), entered = deferred();
  let delayed = false;
  const f = fixture(({ method }) => {
    if (delayed && method === "eth_getBalance") { entered.resolve(); return gate.promise; }
  });
  await f.connect();
  await f.controller.readBalances(options);
  assert.ok(f.controller.state.result);
  delayed = true;
  const pending = f.controller.readBalances(options);
  await entered.promise;
  f.controller.clearResult();
  const view = f.controller.state;
  gate.resolve("0x10");
  await pending;
  assert.equal(f.controller.state, view);
  assert.equal(view.phase, "connected");
  assert.equal(view.result, null);
});

test("read inputs are captured and every displayed amount uses the same hash", async () => {
  const f = fixture();
  await f.connect();
  const input = { ...options };
  const pending = f.controller.readBalances(input);
  input.tokenAddress = B;
  await pending;
  const result = f.controller.state.result;
  assert.equal(result.tokenAddress, TOKEN);
  assert.equal(result.nativeBalanceBaseUnits, "16");
  assert.equal(result.existingAllowanceBaseUnits, "42");
  assert.equal(result.blockNumber, "42");
  const reads = f.calls.filter(x => ["eth_getBalance", "eth_getCode", "eth_call"].includes(x.method));
  for (const { params } of reads) assert.deepEqual(params[1], { blockHash: HASH, requireCanonical: true });
});

for (const [event, value] of [
  ["accountsChanged", [B]], ["accountsChanged", []], ["chainChanged", "0x1"], ["disconnect", {}],
]) {
  test(`${event} immediately clears a previously displayed result`, async () => {
    const f = fixture();
    await f.connect();
    await f.controller.inspect(options);
    assert.ok(f.controller.state.result);
    const count = f.calls.length;
    f.provider.emit(event, value);
    assert.equal(f.controller.state.phase, "disconnected");
    assert.equal(f.controller.state.result, null);
    assert.equal(f.calls.length, count, "No automatic reconnection or RPC");
    assert.ok([...f.listeners.values()].every(set => set.size === 0));
  });
}

test("unchanged account and chain events preserve the connection", async () => {
  const f = fixture();
  await f.connect();
  f.provider.emit("accountsChanged", [A]);
  f.provider.emit("chainChanged", "0x2105");
  assert.equal(f.controller.state.phase, "connected");
});

test("old callbacks and delayed permission errors cannot clear a replacement connection", async () => {
  const gate = deferred(), entered = deferred();
  const old = fixture(({ method }) => {
    if (method === "eth_requestAccounts") { entered.resolve(); return gate.promise; }
  });
  const next = fixture();
  const pending = old.connect();
  await entered.promise;
  const staleListeners = [...old.listeners.get("disconnect")];
  await old.controller.connect({ provider: next.provider, account: A, chainId: 8453 });
  const view = old.controller.state;
  for (const callback of staleListeners) callback({});
  gate.reject(Error("Obsolete wallet rejected"));
  await pending;
  assert.equal(old.controller.state, view);
  assert.equal(view.phase, "connected");
});

test("missing token code yields unknown amounts rather than a zero balance", async () => {
  const f = fixture(({ method }) => method === "eth_getCode" ? "0x" : undefined);
  await f.connect();
  await f.controller.readBalances(options);
  assert.equal(f.controller.state.result.tokenHasCode, false);
  assert.equal(f.controller.state.result.tokenBalanceBaseUnits, null);
  assert.equal(f.controller.state.result.existingAllowanceBaseUnits, null);
  assert.equal(f.calls.some(x => x.method === "eth_call"), false);
});

test("a replaced block clears results instead of presenting mixed balances", async () => {
  let headers = 0;
  const f = fixture(({ method }) => {
    if (method === "eth_getBlockByNumber" && ++headers === 2) return { ...BLOCK, hash: "0x" + "cd".repeat(32) };
  });
  await f.connect();
  assert.equal(await f.controller.readBalances(options), false);
  assert.equal(f.controller.state.result, null);
  assert.match(f.controller.state.error, /ブロック/);
});

test("disposing a card removes listeners and blocks later actions", async () => {
  const f = fixture();
  await f.connect();
  f.controller.dispose();
  const count = f.calls.length;
  assert.equal(await f.connect(), false);
  assert.equal(await f.controller.inspect(options), false);
  assert.equal(f.controller.state.phase, "disposed");
  assert.equal(f.calls.length, count);
  assert.ok([...f.listeners.values()].every(set => set.size === 0));
});

for (const code of [4100, 4900, 4901]) {
  for (const operation of ["readBalances", "inspect"]) {
    test(`${operation}: provider error ${code} clears the view without a disconnect event`, async () => {
      let failed = false;
      const f = fixture(({ method }) => {
        if (failed && method === "eth_call") throw Object.assign(Error("Provider unavailable"), { code });
      });
      await f.connect();
      assert.equal(await f.controller[operation](options), true);
      assert.ok(f.controller.state.result);
      failed = true;
      assert.equal(await f.controller[operation](options), false);
      assert.equal(f.controller.state.phase, "disconnected");
      assert.equal(f.controller.state.connection, null);
      assert.equal(f.controller.state.result, null);
      assert.match(f.controller.state.error, /再接続/);
      const count = f.calls.length;
      await f.controller[operation](options);
      assert.equal(f.calls.length, count);
      assert.ok([...f.listeners.values()].every(set => set.size === 0));
      failed = false;
      assert.equal(await f.connect(), true);
      assert.equal(await f.controller[operation](options), true);
      f.controller.dispose();
    });
  }

  test(`an older read's ${code} clears a newer result from the same invalidated session`, async () => {
    const gate = deferred(), entered = deferred();
    let calls = 0;
    const f = fixture(({ method }) => {
      if (method === "eth_getBalance" && ++calls === 1) { entered.resolve(); return gate.promise; }
    });
    await f.connect();
    const pending = f.controller.readBalances(options);
    await entered.promise;
    assert.equal(await f.controller.readBalances(options), true);
    assert.ok(f.controller.state.result);
    gate.reject(Object.assign(Error("Connection lost"), { code }));
    assert.equal(await pending, false);
    assert.equal(f.controller.state.phase, "disconnected");
    assert.equal(f.controller.state.result, null);
    assert.equal(f.controller.state.connection, null);
    f.controller.dispose();
  });

  test(`an older read's ${code} preserves a replacement connection and its result`, async () => {
    const gate = deferred(), entered = deferred();
    let calls = 0;
    const f = fixture(({ method }) => {
      if (method === "eth_getBalance" && ++calls === 1) { entered.resolve(); return gate.promise; }
    });
    await f.connect();
    const pending = f.controller.readBalances(options);
    await entered.promise;
    f.controller.disconnect();
    await f.connect();
    assert.equal(await f.controller.readBalances(options), true);
    const fresh = f.controller.state;
    gate.reject(Object.assign(Error("Obsolete connection lost"), { code }));
    assert.equal(await pending, false);
    assert.equal(f.controller.state, fresh);
    f.controller.dispose();
  });
}

for (const action of ["clearResult", "dispose"]) {
  test(`a late connection failure after ${action} cannot leave stale connected UI`, async () => {
    const gate = deferred(), entered = deferred();
    const f = fixture(({ method }) => {
      if (method === "eth_getBalance") { entered.resolve(); return gate.promise; }
    });
    await f.connect();
    const pending = f.controller.readBalances(options);
    await entered.promise;
    f.controller[action]();
    gate.reject(Object.assign(Error("Disconnected"), { code: 4900 }));
    assert.equal(await pending, false);
    assert.equal(f.controller.state.phase, action === "dispose" ? "disposed" : "disconnected");
    assert.equal(f.controller.state.connection, null);
    assert.equal(f.controller.state.result, null);
    f.controller.dispose();
  });
}

test("an unsupported pinned call clears the report but permits another explicit read", async () => {
  let unsupported = true;
  const f = fixture(({ method }) => {
    if (unsupported && method === "eth_call") throw Object.assign(Error("Unsupported pinned call"), { code: 4200 });
  });
  await f.connect();
  assert.equal(await f.controller.inspect(options), false);
  assert.equal(f.controller.state.phase, "connected");
  assert.equal(f.controller.state.result, null);
  unsupported = false;
  assert.equal(await f.controller.inspect(options), true);
  assert.equal(f.calls.filter(x => x.method === "eth_requestAccounts").length, 1);
  f.controller.dispose();
});
