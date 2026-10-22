import test from "node:test";
import assert from "node:assert/strict";
import { readPortfolioSnapshot } from "../src/portfolio-snapshot.js";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";

const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "22".repeat(20);
const SECOND = "0x" + "33".repeat(20);
const HASH = "0x" + "ab".repeat(32);
const HEADER = { number: "0x2a", hash: HASH };
const MAX = (1n << 256n) - 1n;

function fixture({ hook = () => {}, amount = 7n, deployed = true } = {}) {
  const calls = [];
  const state = {
    agent: "DAT", account: ACCOUNT, chainId: 8453, connectionEpoch: 1,
    siteOrigin: "https://example.test", connected: true,
    canSign: false, canSendTransactions: false, canBridge: false,
  };
  const session = {
    get state() { return { ...state }; },
    async getBlockSnapshot(tag) {
      calls.push(["block", tag]);
      const replacement = await hook("block", { tag, state, calls });
      return replacement ?? { ...HEADER };
    },
    async getNativeBalance(hash) {
      calls.push(["native", hash]);
      const replacement = await hook("native", { state, calls });
      return replacement ?? amount;
    },
    async getContractCode(address, hash) {
      calls.push(["code", address, hash]);
      const replacement = await hook("code", { state, address, calls });
      return replacement ?? { address, deployed };
    },
    async getTokenBalance(address, hash) {
      calls.push(["balance", address, hash]);
      const replacement = await hook("balance", { state, address, calls });
      return replacement ?? amount;
    },
  };
  return { session, state, calls };
}

test("multiple holdings use one block hash and output exact JSON-safe units", async () => {
  const f = fixture({ amount: MAX });
  const result = await readPortfolioSnapshot(f.session, { tokens: [TOKEN, SECOND] });
  assert.equal(result.blockNumber, "42");
  assert.equal(result.blockHash, HASH);
  assert.equal(result.nativeBalanceBaseUnits, MAX.toString());
  assert.deepEqual(result.holdings.map(row => row.balanceBaseUnits), [MAX.toString(), MAX.toString()]);
  assert.equal(result.securityAudit, false);
  assert.equal(result.readOnly, true);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(f.calls, [
    ["block", undefined], ["native", HASH],
    ["code", TOKEN, HASH], ["balance", TOKEN, HASH],
    ["code", SECOND, HASH], ["balance", SECOND, HASH], ["block", "0x2a"],
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.holdings));
  assert.ok(result.holdings.every(Object.isFrozen));
});

test("missing token bytecode reports unknown and does not read token balance", async () => {
  const f = fixture({ deployed: false });
  const result = await readPortfolioSnapshot(f.session, { tokens: [TOKEN] });
  assert.deepEqual(result.holdings[0], {
    address: TOKEN, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING",
  });
  assert.equal(f.calls.some(([kind]) => kind === "balance"), false);
});

for (const tokens of [undefined, [], "bad", [TOKEN, TOKEN], [TOKEN, "0x123"], Array(33).fill(TOKEN)]) {
  test("invalid token plan is rejected before reads: " + JSON.stringify(tokens)?.slice(0, 70), async () => {
    const f = fixture();
    await assert.rejects(readPortfolioSnapshot(f.session, { tokens }));
    assert.equal(f.calls.length, 0);
  });
}

for (const timeoutMs of [0, -1, 1.5, Infinity, NaN, 120001, "100"]) {
  test("invalid snapshot timeout is rejected: " + timeoutMs, async () => {
    const f = fixture();
    await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN], timeoutMs }), { code: "INVALID_TIMEOUT" });
    assert.equal(f.calls.length, 0);
  });
}

for (const change of [
  { connected: false }, { account: SECOND }, { chainId: 1 }, { connectionEpoch: 2 },
  { agent: "EMA" }, { siteOrigin: "https://other.test" }, { canSign: true },
  { canSendTransactions: true }, { canBridge: true },
]) {
  for (const stage of ["native", "code", "balance"]) {
    test("changing " + Object.keys(change)[0] + " during " + stage + " discards snapshot", async () => {
      const f = fixture({ hook(kind, { state }) { if (kind === stage) Object.assign(state, change); } });
      await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN] }), { code: "SESSION_CHANGED" });
      assert.notEqual(f.calls.at(-1)?.[0], "block");
    });
  }
}

for (const bad of [-1n, MAX + 1n, "7", 7, false, {}]) {
  test("invalid native amount fails: " + String(bad), async () => {
    const f = fixture({ amount: bad });
    await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN] }), { code: "INVALID_AMOUNT" });
    assert.equal(f.calls.some(([kind]) => kind === "code"), false);
  });
  test("invalid token amount fails: " + String(bad), async () => {
    const f = fixture({ hook(kind) { if (kind === "balance") return bad; } });
    await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN] }), { code: "INVALID_AMOUNT" });
  });
}

test("canonicality recheck rejects a changed block hash", async () => {
  const f = fixture({ hook(kind, { tag }) {
    if (kind === "block" && tag) return { number: "0x2a", hash: "0x" + "cd".repeat(32) };
  } });
  await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN] }), { code: "BLOCK_CHANGED" });
});

test("wrong contract address cannot be accepted as requested token", async () => {
  const f = fixture({ hook(kind) { if (kind === "code") return { address: SECOND, deployed: true }; } });
  await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN] }), { code: "INVALID_CODE_RESULT" });
});

test("caller's changing token array cannot alter an in-flight read plan", async () => {
  const tokens = [TOKEN];
  const f = fixture({ hook(kind) { if (kind === "native") tokens[0] = SECOND; } });
  const result = await readPortfolioSnapshot(f.session, { tokens });
  assert.equal(result.holdings[0].address, TOKEN);
});

test("already cancelled operation performs no reads", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN], signal: controller.signal }), { code: "ABORTED" });
  assert.equal(f.calls.length, 0);
});

test("abort releases a hung local wait and late response cannot start more reads", async () => {
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture({ hook(kind) {
    if (kind === "native") { started(); return new Promise(resolve => { release = resolve; }); }
  } });
  const controller = new AbortController();
  const pending = readPortfolioSnapshot(f.session, { tokens: [TOKEN], signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, { code: "ABORTED" });
  release(7n);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.map(([kind]) => kind), ["block", "native"]);
});

test("overall timeout bounds a custom adapter that never resolves", async () => {
  const f = fixture({ hook(kind) { if (kind === "native") return new Promise(() => {}); } });
  await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN], timeoutMs: 10 }), { code: "SNAPSHOT_TIMEOUT" });
});

test("real session interface works entirely with an offline synthetic provider", async () => {
  const calls = [];
  const provider = { async request({ method }) {
    calls.push(method);
    if (method === "eth_chainId") return "0x2105";
    if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [ACCOUNT];
    if (method === "eth_getBlockByNumber") return { ...HEADER };
    if (method === "eth_getBalance") return "0x7";
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_call") return "0x" + "0".repeat(63) + "7";
    throw Error("Unexpected provider method " + method);
  } };
  const session = new ThreeCoreWalletSession({
    provider, agent: "EMA", chainId: 8453, expectedAccount: ACCOUNT,
    siteOrigin: "https://example.test", approvedOrigins: ["https://example.test"],
  });
  await session.connect();
  calls.length = 0;
  const result = await readPortfolioSnapshot(session, { tokens: [TOKEN, SECOND] });
  assert.equal(result.agent, "EMA");
  assert.deepEqual(result.holdings.map(row => row.balanceBaseUnits), ["7", "7"]);
  assert.equal(calls.includes("eth_requestAccounts"), false);
  assert.ok(calls.every(method => ["eth_chainId", "eth_accounts", "eth_getBlockByNumber",
    "eth_getBalance", "eth_getCode", "eth_call"].includes(method)));
  session.disconnect();
});

test("progress follows the actual read order and is not persisted in the portfolio", async () => {
  const f = fixture();
  const events = [];
  const result = await readPortfolioSnapshot(f.session, { tokens: [TOKEN, SECOND],
    onProgress: value => events.push(value) });
  assert.deepEqual(events.map(value => value.stage), [
    "block", "native", "token-code", "token-balance", "token-code", "token-balance", "canonical", "complete",
  ]);
  assert.deepEqual(events.map(value => value.completedTokens), [0, 0, 0, 0, 1, 1, 2, 2]);
  assert.equal(events.every(Object.isFrozen), true);
  assert.equal(events[2].tokenAddress, TOKEN);
  assert.equal(events[4].tokenAddress, SECOND);
  assert.equal(Object.hasOwn(result, "onProgress"), false);
  assert.equal(Object.hasOwn(result, "progress"), false);
});

test("missing contract code advances token progress without a fabricated balance phase", async () => {
  const f = fixture({ deployed: false });
  const events = [];
  await readPortfolioSnapshot(f.session, { tokens: [TOKEN, SECOND], onProgress: value => events.push(value) });
  assert.deepEqual(events.map(value => value.stage), [
    "block", "native", "token-code", "token-code", "canonical", "complete",
  ]);
  assert.equal(f.calls.some(([kind]) => kind === "balance"), false);
});

for (const stage of ["block", "native", "token-code", "token-balance", "canonical", "complete"]) {
  test("observer cancellation during " + stage + " stops local completion", async () => {
    const f = fixture();
    const abort = new AbortController();
    await assert.rejects(readPortfolioSnapshot(f.session, {
      tokens: [TOKEN], signal: abort.signal,
      onProgress(value) { if (value.stage === stage) abort.abort(); },
    }), { code: "ABORTED" });
    const expected = { block: 0, native: 1, "token-code": 2, "token-balance": 3, canonical: 4, complete: 5 };
    assert.equal(f.calls.length, expected[stage]);
  });
}

for (const field of ["account", "chainId", "connectionEpoch", "connected"]) {
  test("observer-driven session change is rechecked before the next request: " + field, async () => {
    const f = fixture();
    const values = { account: SECOND, chainId: 84532, connectionEpoch: 2, connected: false };
    await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN],
      onProgress(value) { if (value.stage === "native") f.state[field] = values[field]; },
    }), { code: "SESSION_CHANGED" });
    assert.equal(f.calls.length, 1);
  });
}

test("throwing progress observers cannot corrupt portfolio data or stop cleanup", async () => {
  const f = fixture();
  let notifications = 0;
  const result = await readPortfolioSnapshot(f.session, { tokens: [TOKEN],
    onProgress() { notifications++; throw Error("display failure"); } });
  assert.equal(result.holdings[0].balanceBaseUnits, "7");
  assert.equal(notifications, 6);
});

test("rejected asynchronous observers cannot become unhandled browser errors", async () => {
  const f = fixture();
  const errors = [];
  const capture = reason => errors.push(reason);
  process.on("unhandledRejection", capture);
  try {
    const result = await readPortfolioSnapshot(f.session, { tokens: [TOKEN],
      async onProgress() { throw Error("async display failure"); } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.holdings[0].balanceBaseUnits, "7");
    assert.deepEqual(errors, []);
  } finally {
    process.removeListener("unhandledRejection", capture);
  }
});

test("a never-resolving observer is not awaited as a provider operation", async () => {
  const f = fixture();
  const result = await readPortfolioSnapshot(f.session, { tokens: [TOKEN], timeoutMs: 1000,
    onProgress() { return new Promise(() => {}); } });
  assert.equal(result.holdings.length, 1);
});

test("progress events cannot be mutated into fabricated completion", async () => {
  const f = fixture();
  const mutations = [];
  const result = await readPortfolioSnapshot(f.session, { tokens: [TOKEN],
    onProgress(value) {
      try { value.stage = "complete"; } catch (error) { mutations.push(error); }
    } });
  assert.equal(mutations.length, 6);
  assert.equal(result.blockHash, HASH);
});

for (const observer of [null, false, "callback", {}, []]) {
  test("invalid observer is rejected before any read: " + JSON.stringify(observer), async () => {
    const f = fixture();
    await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN], onProgress: observer }),
      { code: "INVALID_PROGRESS_OBSERVER" });
    assert.equal(f.calls.length, 0);
  });
}

test("failed canonical block recheck never emits a completion event", async () => {
  const events = [];
  const f = fixture({ hook(kind, { tag }) {
    if (kind === "block" && tag) return { number: HEADER.number, hash: "0x" + "cd".repeat(32) };
  } });
  await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN],
    onProgress: value => events.push(value) }), { code: "BLOCK_CHANGED" });
  assert.equal(events.at(-1).stage, "canonical");
  assert.equal(events.some(value => value.stage === "complete"), false);
});

test("progress does not cause a failed token call to produce a partial portfolio", async () => {
  const events = [];
  const f = fixture({ hook(kind) { if (kind === "balance") throw Error("provider rejected"); } });
  await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN],
    onProgress: value => events.push(value) }), /provider rejected/);
  assert.equal(events.at(-1).stage, "token-balance");
  assert.equal(events.some(value => value.stage === "complete"), false);
});

test("timeout during a pending balance stops subsequent progress even after a late reply", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const events = [];
  const f = fixture({ hook(kind) { if (kind === "balance") return pending; } });
  await assert.rejects(readPortfolioSnapshot(f.session, { tokens: [TOKEN], timeoutMs: 20,
    onProgress: value => events.push(value) }), { code: "SNAPSHOT_TIMEOUT" });
  const count = events.length;
  release(9n);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, count);
  assert.equal(events.at(-1).stage, "token-balance");
});

test("observer metadata contains no account, native balance, block hash or provider payload", async () => {
  const f = fixture();
  const events = [];
  await readPortfolioSnapshot(f.session, { tokens: [TOKEN], onProgress: value => events.push(value) });
  for (const value of events) {
    assert.deepEqual(Object.keys(value).sort(),
      ["completedTokens", "stage", "tokenAddress", "tokenIndex", "totalTokens"]);
    assert.equal(JSON.stringify(value).includes(ACCOUNT), false);
    assert.equal(JSON.stringify(value).includes(HASH), false);
  }
});
