import test from "node:test";
import assert from "node:assert/strict";
import { inspectDappSpender, DappPreflightError } from "../src/dapp-preflight.js";
import { ThreeCoreWalletSession, CHAINS } from "../src/wallet-session.js";

const A = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const SPENDER = "0x3333333333333333333333333333333333333333";
const BLOCK = Object.freeze({ number: "0x2a", hash: "0x" + "ab".repeat(32) });
const STATE = Object.freeze({
  agent: "DAT", account: A, chainId: 84532,
  connectionEpoch: 0,
  siteOrigin: "https://dapp.example", connected: true,
  canSign: false, canSendTransactions: false, canBridge: false,
});

function fakeSession(overrides = {}) {
  const calls = [];
  let state = { ...STATE, ...overrides.state };
  const api = {
    calls,
    get state() { return { ...state }; },
    change(patch) { state = { ...state, ...patch }; },
    async getBlockSnapshot() { return { ...BLOCK }; },
    async getContractCode(address) {
      calls.push(["code", address]);
      return overrides.getContractCode
        ? overrides.getContractCode(address, api)
        : { address, deployed: true };
    },
    async getTokenBalance(address) {
      calls.push(["balance", address]);
      return overrides.getTokenBalance
        ? overrides.getTokenBalance(address, api) : 123456789000000000n;
    },
    async getTokenAllowance(token, spender) {
      calls.push(["allowance", token, spender]);
      return overrides.getTokenAllowance
        ? overrides.getTokenAllowance(token, spender, api) : 12345n;
    },
  };
  return api;
}
const options = { tokenAddress: TOKEN, spenderAddress: SPENDER };
const expectCode = (code) =>
  (error) => error instanceof DappPreflightError && error.code === code;

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test(agent + " reads code, balance and allowance without granting an approval", async () => {
    const wallet = fakeSession({ state: { agent } });
    const snapshot = await inspectDappSpender(wallet, options);
    assert.equal(snapshot.agent, agent);
    assert.equal(snapshot.account, A);
    assert.equal(snapshot.chainId, 84532);
    assert.equal(snapshot.tokenBalanceBaseUnits, "123456789000000000");
    assert.equal(snapshot.existingAllowanceBaseUnits, "12345");
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.securityAudit, false);
    assert.deepEqual(snapshot.notices, []);
    assert.deepEqual(wallet.calls, [
      ["code", TOKEN], ["code", SPENDER], ["balance", TOKEN],
      ["allowance", TOKEN, SPENDER],
    ]);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.notices));
    assert.equal(JSON.parse(JSON.stringify(snapshot)).existingAllowanceBaseUnits, "12345");
  });
}

test("missing token code means balances and allowances are unknown, not zero", async () => {
  const wallet = fakeSession({
    getContractCode: async (address) => ({ address, deployed: address !== TOKEN }),
  });
  const result = await inspectDappSpender(wallet, options);
  assert.equal(result.tokenHasCode, false);
  assert.equal(result.tokenBalanceBaseUnits, null);
  assert.equal(result.existingAllowanceBaseUnits, null);
  assert.deepEqual(result.notices, ["TOKEN_CODE_MISSING"]);
  assert.deepEqual(wallet.calls, [["code", TOKEN], ["code", SPENDER]]);
});

test("missing spender bytecode warns without calling it safe", async () => {
  const wallet = fakeSession({
    getContractCode: async (address) => ({ address, deployed: address !== SPENDER }),
  });
  const result = await inspectDappSpender(wallet, options);
  assert.equal(result.spenderHasCode, false);
  assert.deepEqual(result.notices, ["SPENDER_CODE_MISSING"]);
  assert.equal(result.securityAudit, false);
});

test("disconnected sessions cause no RPC calls", async () => {
  const wallet = fakeSession({ state: { connected: false, account: null } });
  await assert.rejects(inspectDappSpender(wallet, options), expectCode("DISCONNECTED"));
  assert.equal(wallet.calls.length, 0);
});

test("sessions advertising signing ability are rejected", async () => {
  for (const capability of ["canSign", "canSendTransactions", "canBridge"]) {
    const wallet = fakeSession({ state: { [capability]: true } });
    await assert.rejects(inspectDappSpender(wallet, options), expectCode("UNSAFE_CAPABILITIES"));
    assert.equal(wallet.calls.length, 0);
  }
});

test("rejects unknown agents, missing session methods and invalid addresses", async () => {
  await assert.rejects(inspectDappSpender(fakeSession({ state: { agent: "CAW" } }), options), expectCode("INVALID_SESSION"));
  await assert.rejects(inspectDappSpender(null, options), expectCode("INVALID_SESSION"));
  const wallet = fakeSession();
  await assert.rejects(inspectDappSpender(wallet, { ...options, tokenAddress: "bad" }), expectCode("INVALID_ADDRESS"));
  await assert.rejects(inspectDappSpender(wallet, { ...options, spenderAddress: "bad" }), expectCode("INVALID_ADDRESS"));
  assert.equal(wallet.calls.length, 0);
});

test("account changing mid-inspection invalidates remaining work", async () => {
  const wallet = fakeSession({
    getContractCode: async (address, session) => {
      session.change({ account: SPENDER });
      return { address, deployed: true };
    },
  });
  await assert.rejects(inspectDappSpender(wallet, options), expectCode("SESSION_CHANGED"));
  assert.deepEqual(wallet.calls, [["code", TOKEN]]);
});

test("chain changing during allowance reading rejects partial snapshot", async () => {
  const wallet = fakeSession({
    getTokenAllowance: async (_token, _spender, session) => {
      session.change({ chainId: 8453 });
      return 15n;
    },
  });
  await assert.rejects(inspectDappSpender(wallet, options), expectCode("SESSION_CHANGED"));
});

test("disconnect during balance reading skips subsequent allowance", async () => {
  const wallet = fakeSession({
    getTokenBalance: async (_token, session) => {
      session.change({ connected: false });
      return 100n;
    },
  });
  await assert.rejects(inspectDappSpender(wallet, options), expectCode("SESSION_CHANGED"));
  assert.equal(wallet.calls.some(([method]) => method === "allowance"), false);
});

test("malformed contract-code result fails closed", async () => {
  const wallet = fakeSession({ getContractCode: async (address) => ({ address, deployed: "yes" }) });
  await assert.rejects(inspectDappSpender(wallet, options), expectCode("INVALID_READ_RESULT"));
  assert.deepEqual(wallet.calls, [["code", TOKEN]]);
});

test("non-bigint, negative and overflowing balances or allowances are rejected", async () => {
  for (const invalid of [0, "1", -1n, 1n << 256n]) {
    const balanceWallet = fakeSession({ getTokenBalance: async () => invalid });
    const allowanceWallet = fakeSession({ getTokenAllowance: async () => invalid });
    await assert.rejects(inspectDappSpender(balanceWallet, options), expectCode("INVALID_READ_RESULT"));
    await assert.rejects(inspectDappSpender(allowanceWallet, options), expectCode("INVALID_READ_RESULT"));
  }
});

test("the largest uint256 remains exact in a JSON-safe preflight report", async () => {
  const maximum = (1n << 256n) - 1n;
  const wallet = fakeSession({
    getTokenBalance: async () => maximum,
    getTokenAllowance: async () => maximum,
  });
  const result = JSON.parse(JSON.stringify(await inspectDappSpender(wallet, options)));
  assert.equal(result.tokenBalanceBaseUnits, maximum.toString());
  assert.equal(result.existingAllowanceBaseUnits, maximum.toString());
});

test("sessions without a valid connection epoch are rejected before reading", async () => {
  for (const connectionEpoch of [undefined, -1, 0.5, "0", NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const wallet = fakeSession({ state: { connectionEpoch } });
    await assert.rejects(inspectDappSpender(wallet, options), expectCode("INVALID_SESSION"));
    assert.equal(wallet.calls.length, 0);
  }
});

for (const boundary of [1, 2, 3, 4]) {
  test(`same-account reconnect after preflight read ${boundary} invalidates the report`, async () => {
    const provider = {
      async request({ method }) {
        if (method === "eth_chainId") return CHAINS.BASE_SEPOLIA.hex;
        if (method === "eth_getBlockByNumber") return { ...BLOCK };
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [A];
        if (method === "eth_getCode") return "0x6000";
        if (method === "eth_call") return "0x" + "2a".padStart(64, "0");
        throw new Error("Unexpected request: " + method);
      },
    };
    const wallet = new ThreeCoreWalletSession({
      provider, agent: "DAT", siteOrigin: STATE.siteOrigin,
      approvedOrigins: [STATE.siteOrigin], expectedAccount: A, chainId: STATE.chainId,
    });
    await wallet.connect();
    const epoch = wallet.state.connectionEpoch;
    let reads = 0;
    for (const method of ["getContractCode", "getTokenBalance", "getTokenAllowance"]) {
      const original = wallet[method].bind(wallet);
      wallet[method] = async (...args) => {
        const result = await original(...args);
        if (++reads === boundary) {
          wallet.disconnect();
          await wallet.connect();
        }
        return result;
      };
    }
    await assert.rejects(inspectDappSpender(wallet, options), expectCode("SESSION_CHANGED"));
    assert.equal(reads, boundary);
    assert.equal(wallet.state.connected, true);
    assert.equal(wallet.state.connectionEpoch, epoch + 1);
    // A fresh inspection is permitted after the explicit reconnection.
    const fresh = await inspectDappSpender(wallet, options);
    assert.equal(fresh.connectionEpoch, epoch + 1);
    wallet.disconnect();
  });
}

test("propagates RPC errors and never retries dangerous actions", async () => {
  const wallet = fakeSession({ getContractCode: async () => { throw new Error("RPC timeout"); } });
  await assert.rejects(inspectDappSpender(wallet, options), /RPC timeout/);
  assert.equal(wallet.calls.length, 1);
});

test("integrates with a real ThreeCoreWalletSession using mock EIP-1193 RPC", async () => {
  const methods = [];
  const provider = {
    async request({ method }) {
      methods.push(method);
      switch (method) {
        case "eth_chainId": return CHAINS.BASE_SEPOLIA.hex;
        case "eth_getBlockByNumber": return { ...BLOCK };
        case "eth_requestAccounts":
        case "eth_accounts": return [A];
        case "eth_getCode": return "0x6000";
        case "eth_call": return "0x" + "2a".padStart(64, "0");
        default: throw new Error("Unexpected request: " + method);
      }
    },
  };
  const wallet = new ThreeCoreWalletSession({
    provider, agent: "EMA",
    siteOrigin: "http://localhost:4173",
    approvedOrigins: ["http://localhost:4173"],
    expectedAccount: A, chainId: CHAINS.BASE_SEPOLIA.id,
  });
  await wallet.connect();
  const result = await inspectDappSpender(wallet, options);
  assert.equal(result.agent, "EMA");
  assert.equal(result.tokenBalanceBaseUnits, "42");
  assert.equal(result.existingAllowanceBaseUnits, "42");
  assert.deepEqual(methods.filter((method) => method === "eth_getCode").length, 2);
  assert.deepEqual(methods.filter((method) => method === "eth_call").length, 2);
  assert.equal(methods.some((method) => /sign|sendTransaction|approve/i.test(method)), false);
  wallet.disconnect();
});

test("custom session block results must be valid and independently rechecked", async () => {
  for (const header of [null, {}, { ...BLOCK, number: "0x00" }, { ...BLOCK, hash: "0x12" }]) {
    const wallet = fakeSession();
    wallet.getBlockSnapshot = async () => header;
    await assert.rejects(inspectDappSpender(wallet, options), expectCode("INVALID_READ_RESULT"));
    assert.equal(wallet.calls.length, 0);
  }
  const wallet = fakeSession();
  let headers = 0;
  const mutable = { ...BLOCK };
  wallet.getBlockSnapshot = async () => {
    if (++headers === 2) mutable.hash = "0x" + "cd".repeat(32);
    return mutable;
  };
  await assert.rejects(inspectDappSpender(wallet, options), expectCode("BLOCK_CHANGED"));
});
