import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_IDS, CHAINS, WalletConnectionError,
  ThreeCoreWalletSession, normalizeAddress,
  normalizeChainId, validateSiteOrigin,
} from "../src/wallet-session.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const SITE = "https://dex.example";
const CHAIN = CHAINS.BASE_SEPOLIA.id;

class MockProvider {
  constructor({ accounts = [A], chain = CHAINS.BASE_SEPOLIA.hex } = {}) {
    this.accounts = accounts;
    this.chain = chain;
    this.calls = [];
    this.listeners = new Map();
    this.results = {};
  }

  request(args) { return this.respond(args); }

  async respond(args) {
    const { method } = args;
    this.calls.push(args);
    if (method in this.results) {
      const result = this.results[method];
      if (result instanceof Error) throw result;
      return result;
    }
    if (method === "eth_chainId") return this.chain;
    if (method === "eth_requestAccounts" || method === "eth_accounts") {
      return [...this.accounts];
    }
    if (method === "eth_getBalance") return "0x2a";
    if (method === "eth_call") return "0x" + "64".padStart(64, "0");
    throw new Error("Unexpected RPC method: " + method);
  }

  on(name, fn) {
    const current = this.listeners.get(name) ?? new Set();
    current.add(fn);
    this.listeners.set(name, current);
  }

  removeListener(name, fn) {
    this.listeners.get(name)?.delete(fn);
  }

  emit(name, payload) {
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
}

function session(provider = new MockProvider(), overrides = {}) {
  return new ThreeCoreWalletSession({
    provider,
    agent: "DAT",
    siteOrigin: SITE,
    approvedOrigins: [SITE],
    expectedAccount: A,
    chainId: CHAIN,
    ...overrides,
  });
}

function expectCode(code) {
  return (error) => error instanceof WalletConnectionError && error.code === code;
}

test("only the three named ThreeCore agents are supported", () => {
  assert.deepEqual(AGENT_IDS, ["DAT", "EMA", "CAWELON"]);
  for (const agent of AGENT_IDS) {
    assert.equal(session(new MockProvider(), { agent }).state.agent, agent);
  }
  assert.throws(() => session(new MockProvider(), { agent: "CAW" }), expectCode("INVALID_AGENT"));
});

test("Base and Base Sepolia chain identities are explicit", () => {
  assert.equal(normalizeChainId("0x2105"), 8453);
  assert.equal(normalizeChainId("0x14a34"), 84532);
  assert.throws(() => normalizeChainId("8453"), expectCode("INVALID_CHAIN"));
});

test("site origins must be exact and HTTPS outside localhost", () => {
  assert.equal(validateSiteOrigin(SITE), SITE);
  assert.equal(validateSiteOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.throws(() => validateSiteOrigin("http://dex.example"), expectCode("INVALID_ORIGIN"));
  assert.throws(() => validateSiteOrigin(SITE + "/route"), expectCode("INVALID_ORIGIN"));
  assert.throws(() => validateSiteOrigin("not a URL"), expectCode("INVALID_ORIGIN"));
});

test("unapproved third-party sites cannot request wallet access", () => {
  const provider = new MockProvider();
  assert.throws(() => session(provider, { siteOrigin: "https://phishing.example" }), expectCode("SITE_NOT_APPROVED"));
  assert.equal(provider.calls.length, 0);
});

test("missing wallet provider is rejected before any request", () => {
  assert.throws(() => session(null), expectCode("NO_PROVIDER"));
});

test("incorrect wallet address is rejected at construction", () => {
  assert.throws(() => session(new MockProvider(), { expectedAccount: "0xnotanaddress" }), expectCode("INVALID_ADDRESS"));
  assert.equal(normalizeAddress(A.toUpperCase().replace("0X", "0x")), A);
});

test("only explicitly configured Base networks may be selected", () => {
  assert.throws(() => session(new MockProvider(), { chainId: 1 }), expectCode("UNSUPPORTED_CHAIN"));
});

test("initial state is disconnected and cannot sign or send", () => {
  const state = session().state;
  assert.equal(state.connected, false);
  assert.equal(state.account, null);
  assert.equal(state.canSign, false);
  assert.equal(state.canSendTransactions, false);
  assert.equal(state.canBridge, false);
  assert.ok(Object.isFrozen(state));
});

test("explicit Connect Wallet action requests account authorization", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  assert.equal((await wallet.connect()).connected, true);
  assert.equal(wallet.state.account, A);
  assert.equal(provider.calls.filter((call) => call.method === "eth_requestAccounts").length, 1);
});

test("double connect does not request permissions a second time", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  await wallet.connect();
  assert.equal(provider.calls.filter((call) => call.method === "eth_requestAccounts").length, 1);
});

test("a different active account cannot be used for the DAT wallet", async () => {
  const provider = new MockProvider({ accounts: [B] });
  const wallet = session(provider);
  await assert.rejects(wallet.connect(), expectCode("WRONG_ACCOUNT"));
  assert.equal(wallet.state.connected, false);
});

test("a wrong network cannot connect to the agent session", async () => {
  const provider = new MockProvider({ chain: "0x1" });
  const wallet = session(provider);
  await assert.rejects(wallet.connect(), expectCode("WRONG_CHAIN"));
  assert.equal(provider.calls.some((call) => call.method === "eth_requestAccounts"), false);
});

test("user rejecting the wallet prompt remains disconnected", async () => {
  const provider = new MockProvider();
  provider.results.eth_requestAccounts = Object.assign(new Error("User rejected"), { code: 4001 });
  const wallet = session(provider);
  await assert.rejects(wallet.connect());
  assert.equal(wallet.state.connected, false);
});

test("empty approved account response cannot connect", async () => {
  const provider = new MockProvider({ accounts: [] });
  const wallet = session(provider);
  await assert.rejects(wallet.connect(), expectCode("NO_ACCOUNTS"));
});

test("native balance reads require connection and correct account", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await assert.rejects(wallet.getNativeBalance(), expectCode("NOT_CONNECTED"));
  await wallet.connect();
  assert.equal(await wallet.getNativeBalance(), 42n);
  assert.ok(provider.calls.some((call) =>
    call.method === "eth_getBalance" && call.params[0] === A && call.params[1] === "latest"
  ));
});

test("token balance uses read-only balanceOf ABI call", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  assert.equal(await wallet.getTokenBalance(TOKEN), 100n);
  const call = provider.calls.find((entry) => entry.method === "eth_call");
  assert.deepEqual(call.params, [
    { to: TOKEN, data: "0x70a08231" + A.slice(2).padStart(64, "0") },
    "latest",
  ]);
  assert.equal(provider.calls.some((entry) => entry.method === "eth_sendTransaction"), false);
  assert.equal(provider.calls.some((entry) => entry.method === "personal_sign"), false);
});

test("token contract must be a valid EVM address", async () => {
  const wallet = session();
  await wallet.connect();
  await assert.rejects(wallet.getTokenBalance("not-a-contract"), expectCode("INVALID_ADDRESS"));
});

test("malformed balance RPC response is rejected", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.results.eth_getBalance = "bogus";
  await assert.rejects(wallet.getNativeBalance(), expectCode("INVALID_RPC_RESULT"));
});

test("account changes invalidate the session", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.emit("accountsChanged", [B]);
  assert.equal(wallet.state.connected, false);
  await assert.rejects(wallet.getNativeBalance(), expectCode("NOT_CONNECTED"));
});

test("chain changes invalidate the session", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.emit("chainChanged", "0x1");
  assert.equal(wallet.state.connected, false);
});

test("silent provider changes are checked before every read", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.chain = "0x1";
  await assert.rejects(wallet.getNativeBalance(), expectCode("WRONG_CHAIN"));
  assert.equal(wallet.state.connected, false);
});

test("silent account changes cannot read another wallet", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.accounts = [B];
  await assert.rejects(wallet.getTokenBalance(TOKEN), expectCode("ACCOUNT_CHANGED"));
  assert.equal(wallet.state.connected, false);
});

test("provider disconnect event invalidates authorization", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.emit("disconnect", { code: 4900 });
  assert.equal(wallet.state.connected, false);
});

test("local disconnect removes event listeners and disables reads", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  wallet.disconnect();
  assert.equal(wallet.state.connected, false);
  assert.equal(provider.listeners.get("accountsChanged").size, 0);
  assert.equal(provider.listeners.get("chainChanged").size, 0);
  assert.equal(provider.listeners.get("disconnect").size, 0);
  await assert.rejects(wallet.getNativeBalance(), expectCode("NOT_CONNECTED"));
});

test("DAT, EMA and CAWELON sessions cannot silently share assigned accounts", async () => {
  const provider = new MockProvider({ accounts: [A] });
  const dat = session(provider, { agent: "DAT", expectedAccount: A });
  const ema = session(provider, { agent: "EMA", expectedAccount: B });
  const cawelon = session(provider, { agent: "CAWELON", expectedAccount: B });
  await dat.connect();
  await assert.rejects(ema.connect(), expectCode("WRONG_ACCOUNT"));
  await assert.rejects(cawelon.connect(), expectCode("WRONG_ACCOUNT"));
  assert.equal(dat.state.connected, true);
  assert.equal(ema.state.connected, false);
  assert.equal(cawelon.state.connected, false);
});


test("read-only allowance query uses ERC-20 allowance(owner,spender) ABI", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  assert.equal(await wallet.getTokenAllowance(TOKEN, B), 100n);
  const call = provider.calls.find((entry) => entry.method === "eth_call");
  assert.deepEqual(call.params, [
    {
      to: TOKEN,
      data: "0xdd62ed3e" +
        A.slice(2).padStart(64, "0") +
        B.slice(2).padStart(64, "0"),
    },
    "latest",
  ]);
  assert.equal(provider.calls.some((entry) => entry.method === "eth_sendTransaction"), false);
  assert.equal(provider.calls.some((entry) => entry.method === "eth_requestAccounts"), true);
});

test("allowance queries reject malformed spender and token addresses", async () => {
  const wallet = session();
  await wallet.connect();
  await assert.rejects(wallet.getTokenAllowance(TOKEN, "spender"), expectCode("INVALID_ADDRESS"));
  await assert.rejects(wallet.getTokenAllowance("token", B), expectCode("INVALID_ADDRESS"));
});

test("allowance query is forbidden until the agent explicitly connects", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await assert.rejects(wallet.getTokenAllowance(TOKEN, B), expectCode("NOT_CONNECTED"));
  assert.equal(provider.calls.length, 0);
});

test("allowance query cannot proceed after the selected account changes", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.accounts = [B];
  await assert.rejects(wallet.getTokenAllowance(TOKEN, B), expectCode("ACCOUNT_CHANGED"));
  assert.equal(wallet.state.connected, false);
  assert.equal(provider.calls.some((entry) => entry.method === "eth_call"), false);
});

test("allowance query rejects malformed RPC responses", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.results.eth_call = "not-an-evm-word";
  await assert.rejects(wallet.getTokenAllowance(TOKEN, B), expectCode("INVALID_RPC_RESULT"));
});

test("read-only getCode distinguishes deployed contracts from empty addresses", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.results.eth_getCode = "0x60006000";
  assert.deepEqual(await wallet.getContractCode(TOKEN), {
    address: TOKEN,
    deployed: true,
  });
  provider.results.eth_getCode = "0x";
  assert.deepEqual(await wallet.getContractCode(TOKEN), {
    address: TOKEN,
    deployed: false,
  });
  const codeCall = provider.calls.find((entry) => entry.method === "eth_getCode");
  assert.deepEqual(codeCall.params, [TOKEN, "latest"]);
});

test("read-only getCode rejects invalid bytecode responses and address input", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  await assert.rejects(wallet.getContractCode("not-a-contract"), expectCode("INVALID_ADDRESS"));
  provider.results.eth_getCode = "0x123";
  await assert.rejects(wallet.getContractCode(TOKEN), expectCode("INVALID_RPC_RESULT"));
  provider.results.eth_getCode = "0xGG";
  await assert.rejects(wallet.getContractCode(TOKEN), expectCode("INVALID_RPC_RESULT"));
});

test("getCode never opens access after a chain change or disconnected session", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.chain = "0x1";
  await assert.rejects(wallet.getContractCode(TOKEN), expectCode("WRONG_CHAIN"));
  assert.equal(provider.calls.some((entry) => entry.method === "eth_getCode"), false);
  wallet.disconnect();
  await assert.rejects(wallet.getContractCode(TOKEN), expectCode("NOT_CONNECTED"));
});

for (const agent of AGENT_IDS) {
  test(agent + " can query separate read-only allowances without signing", async () => {
    const provider = new MockProvider({ accounts: [A] });
    const wallet = session(provider, { agent });
    await wallet.connect();
    assert.equal(await wallet.getTokenAllowance(TOKEN, B), 100n);
    assert.equal(provider.calls.filter((c) => c.method === "eth_call").length, 1);
    assert.equal(provider.calls.some((c) => ["eth_sendTransaction", "personal_sign", "eth_sign"].includes(c.method)), false);
  });
}


test("simultaneous Connect clicks share one wallet permission request", async () => {
  const provider = new MockProvider();
  const request = provider.respond.bind(provider);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  provider.respond = async (args) => {
    if (args.method === "eth_requestAccounts") await gate;
    return request(args);
  };
  const wallet = session(provider);
  const first = wallet.connect();
  const second = wallet.connect();
  assert.equal(first, second);
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.connected, true);
  assert.equal(two.connected, true);
  assert.equal(provider.calls.filter((entry) => entry.method === "eth_requestAccounts").length, 1);
  wallet.disconnect();
});

test("disconnect during a pending wallet permission prompt cancels the session", async () => {
  const provider = new MockProvider();
  const request = provider.respond.bind(provider);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  provider.respond = async (args) => {
    if (args.method === "eth_requestAccounts") await gate;
    return request(args);
  };
  const wallet = session(provider);
  const pending = wallet.connect();
  // Wait for the chain preflight to complete and the permission prompt to begin.
  await Promise.resolve();
  await Promise.resolve();
  wallet.disconnect();
  release();
  await assert.rejects(pending, expectCode("SESSION_CANCELLED"));
  assert.equal(wallet.state.connected, false);
  assert.ok([...provider.listeners.values()].every(listeners => listeners.size === 0));
  // It remains possible to reconnect explicitly after cancellation.
  assert.equal((await wallet.connect()).connected, true);
  wallet.disconnect();
});

test("a previously disconnected account cannot re-enable itself through a stale event", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  provider.emit("accountsChanged", [B]);
  assert.equal(wallet.state.connected, false);
  provider.emit("accountsChanged", [A]);
  assert.equal(wallet.state.connected, false);
  await assert.rejects(wallet.getNativeBalance(), expectCode("NOT_CONNECTED"));
  wallet.disconnect();
});


function controlledRequest(provider, blockedMethod) {
  const originalRequest = provider.respond.bind(provider);
  let signalStart;
  let releaseRequest;
  const started = new Promise((resolve) => { signalStart = resolve; });
  const gate = new Promise((resolve) => { releaseRequest = resolve; });
  provider.respond = async (args) => {
    if (args.method === blockedMethod) {
      signalStart();
      await gate;
    }
    return originalRequest(args);
  };
  return { started, release: () => releaseRequest() };
}

for (const [label, method, read] of [
  ["native ETH balance", "eth_getBalance", (wallet) => wallet.getNativeBalance()],
  ["token balance", "eth_call", (wallet) => wallet.getTokenBalance(TOKEN)],
  ["existing allowance", "eth_call", (wallet) => wallet.getTokenAllowance(TOKEN, B)],
  ["deployed code", "eth_getCode", (wallet) => wallet.getContractCode(TOKEN)],
]) {
  test(label + " never reports a stale result after local disconnect", async () => {
    const provider = new MockProvider();
    if (method === "eth_getCode") provider.results.eth_getCode = "0x6000";
    const wallet = session(provider);
    await wallet.connect();
    const gate = controlledRequest(provider, method);
    const pending = read(wallet);
    await gate.started;
    wallet.disconnect();
    gate.release();
    await assert.rejects(pending, expectCode("SESSION_CHANGED"));
    assert.equal(wallet.state.connected, false);
  });
}

test("a remote accountsChanged event invalidates an in-flight ERC-20 balance", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  const gate = controlledRequest(provider, "eth_call");
  const pending = wallet.getTokenBalance(TOKEN);
  await gate.started;
  provider.emit("accountsChanged", [B]);
  gate.release();
  await assert.rejects(pending, expectCode("SESSION_CHANGED"));
  assert.equal(wallet.state.connected, false);
  assert.equal(provider.listeners.get("accountsChanged").size, 0);
});

test("a remote chainChanged event invalidates an in-flight allowance", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  const gate = controlledRequest(provider, "eth_call");
  const pending = wallet.getTokenAllowance(TOKEN, B);
  await gate.started;
  provider.emit("chainChanged", "0x1");
  gate.release();
  await assert.rejects(pending, expectCode("SESSION_CHANGED"));
  assert.equal(wallet.state.connected, false);
});

test("a late eth_accounts response cannot revive an invalidated session", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  const gate = controlledRequest(provider, "eth_accounts");
  const pending = wallet.getNativeBalance();
  await gate.started;
  wallet.disconnect();
  gate.release();
  await assert.rejects(pending, expectCode("SESSION_CHANGED"));
  assert.equal(provider.calls.some(({ method }) => method === "eth_getBalance"), false);
});

test("reconnecting explicitly must not make an earlier stale read valid again", async () => {
  const provider = new MockProvider();
  const wallet = session(provider);
  await wallet.connect();
  const gate = controlledRequest(provider, "eth_getBalance");
  const stale = wallet.getNativeBalance();
  await gate.started;
  wallet.disconnect();
  await wallet.connect();
  gate.release();
  await assert.rejects(stale, expectCode("SESSION_CHANGED"));
  assert.equal(wallet.state.connected, true);
  wallet.disconnect();
});

test("all agent balance and allowance reads reject uint256 overflow without writes", async () => {
  const overflow = "0x1" + "0".repeat(64);
  const maximum = "0x" + "f".repeat(64);
  for (const agent of AGENT_IDS) {
    const provider = new MockProvider();
    const wallet = session(provider, { agent });
    await wallet.connect();
    provider.results.eth_getBalance = overflow;
    provider.results.eth_call = overflow;
    for (const read of [() => wallet.getNativeBalance(),
      () => wallet.getTokenBalance(TOKEN), () => wallet.getTokenAllowance(TOKEN, B)]) {
      await assert.rejects(read(), expectCode("INVALID_RPC_RESULT"));
    }
    provider.results.eth_getBalance = maximum;
    provider.results.eth_call = maximum;
    assert.equal(await wallet.getNativeBalance(), (1n << 256n) - 1n);
    assert.equal(await wallet.getTokenBalance(TOKEN), (1n << 256n) - 1n);
    assert.equal(await wallet.getTokenAllowance(TOKEN, B), (1n << 256n) - 1n);
    assert.ok(provider.calls.every(({ method }) =>
      ["eth_chainId", "eth_requestAccounts", "eth_accounts", "eth_getBalance", "eth_call"].includes(method)));
  }
});
