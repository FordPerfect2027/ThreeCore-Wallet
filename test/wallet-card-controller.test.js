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

test("portfolio controller requires a previously connected wallet", async () => {
  const f = fixture();
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN] }), /unavailable/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.state.result, null);
});

test("portfolio controller publishes a pinned immutable snapshot without new permissions", async () => {
  const f = fixture();
  await f.connect();
  const before = f.calls.length;
  const result = await f.controller.readPortfolio({ tokens: [TOKEN, SPENDER] });
  assert.equal(result.account, A);
  assert.equal(result.blockHash, HASH);
  assert.equal(result.nativeBalanceBaseUnits, "16");
  assert.equal(result.holdings.length, 2);
  assert.equal(result.holdings[0].balanceBaseUnits, "42");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.holdings), true);
  assert.equal(f.controller.state.result.kind, "portfolio");
  assert.equal(f.controller.state.phase, "connected");
  const reads = f.calls.slice(before);
  assert.equal(reads.some(call => call.method === "eth_requestAccounts"), false);
  for (const call of reads.filter(call => ["eth_getBalance", "eth_getCode", "eth_call"].includes(call.method))) {
    const reference = call.params.at(-1);
    assert.equal(reference.blockHash, HASH);
    assert.equal(reference.requireCanonical, true);
  }
});

for (const action of ["disconnect", "clearResult", "dispose"]) {
  test("portfolio drops a late result after " + action, async () => {
    const gate = deferred(), entered = deferred();
    let delay = true;
    const f = fixture(({ method }) => {
      if (delay && method === "eth_getBalance") {
        entered.resolve();
        return gate.promise;
      }
    });
    await f.connect();
    const pending = f.controller.readPortfolio({ tokens: [TOKEN] });
    const rejected = assert.rejects(pending, /unavailable/);
    await entered.promise;
    f.controller[action]();
    delay = false;
    gate.resolve("0xffff");
    await rejected;
    assert.equal(f.controller.state.result, null);
  });
}

test("portfolio cancellation releases controls without granting permission again", async () => {
  const gate = deferred(), entered = deferred();
  let delay = true;
  const f = fixture(({ method }) => {
    if (delay && method === "eth_getBalance") {
      entered.resolve();
      return gate.promise;
    }
  });
  await f.connect();
  const abort = new AbortController();
  const pending = f.controller.readPortfolio({ tokens: [TOKEN], signal: abort.signal });
  const rejected = assert.rejects(pending, /unavailable/);
  await entered.promise;
  abort.abort();
  await rejected;
  assert.equal(f.controller.state.phase, "connected");
  assert.equal(f.controller.state.result, null);
  delay = false;
  const result = await f.controller.readPortfolio({ tokens: [TOKEN] });
  assert.equal(result.holdings[0].balanceBaseUnits, "42");
  assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
  gate.resolve("0x1");
});

for (const event of ["accountsChanged", "chainChanged", "disconnect"]) {
  test("portfolio invalidates pending observations on provider " + event, async () => {
    const gate = deferred(), entered = deferred();
    const f = fixture(({ method }) => {
      if (method === "eth_getBalance") {
        entered.resolve();
        return gate.promise;
      }
    });
    await f.connect();
    const pending = f.controller.readPortfolio({ tokens: [TOKEN] });
    const rejected = assert.rejects(pending, /unavailable/);
    await entered.promise;
    f.provider.emit(event, event === "accountsChanged" ? [B] : event === "chainChanged" ? "0x1" : {});
    gate.resolve("0x10");
    await rejected;
    assert.equal(f.controller.state.connection?.connected === true, false);
    assert.equal(f.controller.state.result, null);
  });
}

test("a reorganized block never becomes an exportable portfolio", async () => {
  let blocks = 0;
  const f = fixture(({ method }) => method === "eth_getBlockByNumber" && ++blocks === 2
    ? { ...BLOCK, hash: "0x" + "cd".repeat(32) } : undefined);
  await f.connect();
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN] }), /unavailable/);
  assert.equal(f.controller.state.result, null);
  assert.equal(f.controller.state.connection.connected, true);
});

test("portfolio rejects duplicate token plans without issuing balance reads", async () => {
  const f = fixture();
  await f.connect();
  const before = f.calls.length;
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN, TOKEN] }), /unavailable/);
  assert.equal(f.calls.slice(before).some(call => call.method === "eth_getBalance"), false);
  assert.equal(f.controller.state.result, null);
});

test("missing code remains unknown and is not queried as an ERC-20 contract", async () => {
  const f = fixture(({ method }) => method === "eth_getCode" ? "0x" : undefined);
  await f.connect();
  const result = await f.controller.readPortfolio({ tokens: [TOKEN] });
  assert.equal(result.holdings[0].hasCode, false);
  assert.equal(result.holdings[0].balanceBaseUnits, null);
  assert.equal(f.calls.some(call => call.method === "eth_call"), false);
});

test("newer balance reads supersede a pending portfolio result", async () => {
  const gate = deferred(), entered = deferred();
  let delay = true;
  const f = fixture(({ method }) => {
    if (delay && method === "eth_getBalance") {
      entered.resolve();
      return gate.promise;
    }
  });
  await f.connect();
  const old = f.controller.readPortfolio({ tokens: [TOKEN] });
  const rejected = assert.rejects(old, /unavailable/);
  await entered.promise;
  delay = false;
  assert.equal(await f.controller.readBalances(options), true);
  const view = f.controller.state;
  gate.resolve("0xffff");
  await rejected;
  assert.equal(f.controller.state, view);
  assert.equal(f.controller.state.result.kind, "balances");
});


test("portfolio errors preserve only a safe code for an invalid token plan", async () => {
  const f = fixture();
  await f.connect();
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN, TOKEN] }),
    error => error.code === "DUPLICATE_TOKEN" && error.message === "Portfolio snapshot unavailable");
  assert.equal(f.controller.state.result, null);
});

test("portfolio timeout preserves retry guidance without a provider diagnostic payload", async () => {
  const gate = deferred();
  const f = fixture(({ method }) => method === "eth_getBalance" ? gate.promise : undefined);
  await f.connect();
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN], timeoutMs: 20 }),
    error => error.code === "SNAPSHOT_TIMEOUT" && error.message === "Portfolio snapshot unavailable");
  assert.equal(f.controller.state.result, null);
  gate.resolve("0x10");
});

test("portfolio provider errors outside the known allowlist become a generic code", async () => {
  const f = fixture(({ method }) => method === "eth_call"
    ? Promise.reject({ code: "UNTRUSTED_INTERNAL", message: "private payload" }) : undefined);
  await f.connect();
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN] }), error => {
    assert.equal(error.code, "PORTFOLIO_UNAVAILABLE");
    assert.equal(error.message, "Portfolio snapshot unavailable");
    assert.doesNotMatch(JSON.stringify(error), /private payload|UNTRUSTED/);
    return true;
  });
  assert.doesNotMatch(f.controller.state.error, /private payload|UNTRUSTED/);
});

test("portfolio card forwards progress without enabling another permission request", async () => {
  const f = fixture();
  await f.connect();
  const events = [];
  await f.controller.readPortfolio({ tokens: [TOKEN, SPENDER], onProgress: value => events.push(value) });
  assert.deepEqual(events.map(value => value.stage), [
    "block", "native", "token-code", "token-balance", "token-code", "token-balance", "canonical", "complete",
  ]);
  assert.equal(events[4].completedTokens, 1);
  assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
  assert.equal(f.controller.state.result.kind, "portfolio");
});

test("disconnecting from a card progress callback cannot publish a completed portfolio", async () => {
  const f = fixture();
  await f.connect();
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN], onProgress(value) {
    if (value.stage === "token-code") f.controller.disconnect();
  } }), /unavailable/);
  assert.equal(f.controller.state.result, null);
  assert.equal(f.controller.state.connection?.connected === true, false);
  assert.equal(f.calls.some(call => call.method === "eth_getCode"), false);
});

test("clearing from a complete progress callback still suppresses the old result", async () => {
  const f = fixture();
  await f.connect();
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN], onProgress(value) {
    if (value.stage === "complete") f.controller.clearResult();
  } }), /unavailable/);
  assert.equal(f.controller.state.result, null);
  assert.equal(f.controller.state.phase, "connected");
});

test("a progress callback exception cannot leak a private message into the connected card", async () => {
  const f = fixture();
  await f.connect();
  const result = await f.controller.readPortfolio({ tokens: [TOKEN], onProgress() {
    throw Error("private observer payload");
  } });
  assert.equal(result.holdings[0].balanceBaseUnits, "42");
  assert.equal(f.controller.state.error, null);
});

test("invalid progress observer fails before RPC and returns only a finite failure code", async () => {
  const f = fixture();
  await f.connect();
  const before = f.calls.length;
  await assert.rejects(f.controller.readPortfolio({ tokens: [TOKEN], onProgress: "not-a-function" }),
    { code: "INVALID_PROGRESS_OBSERVER" });
  assert.equal(f.calls.length, before);
  assert.equal(f.controller.state.result, null);
});
