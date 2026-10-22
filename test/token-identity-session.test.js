import test from "node:test";
import assert from "node:assert/strict";
import { METADATA_FIELDS } from "../src/token-identity-codec.js";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { providerFixture, code, HASH, ORIGIN, ACCOUNT, OTHER,
  word, abiText, deferred, tick } from "./helpers/identity-fixtures.js";

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test(`${agent} ${chainId} session reads exactly four permitted metadata selectors`, async () => {
      const f = providerFixture({ agent, chainId });
      try {
        await f.session.connect();
        const metadata = await f.session.getTokenMetadata(f.row.tokenAddress, HASH);
        assert.deepEqual(metadata, f.row.metadata);
        const calls = f.calls.filter(call => call.method === "eth_call");
        assert.deepEqual(calls.map(call => call.params[0].data), Object.values(METADATA_FIELDS));
        for (const call of calls) {
          assert.deepEqual(call.params[1], { blockHash: HASH, requireCanonical: true });
          assert.equal(call.params[0].to, f.row.tokenAddress);
          assert.deepEqual(Object.keys(call.params[0]), ["to", "data"]);
        }
        assert.equal(Object.isFrozen(metadata), true);
      } finally { f.session.disconnect(); }
    });
    test(`${agent} ${chainId} actual adapter composes a complete observation`, async () => {
      const f = providerFixture({ agent, chainId });
      try {
        await f.session.connect();
        const result = await readTokenIdentity(f.session);
        assert.equal(result.agent, agent);
        assert.equal(result.chainId, chainId);
        assert.equal(result.tokenAddress, f.row.tokenAddress);
        assert.equal(result.balanceBaseUnits, f.row.balanceBaseUnits);
        const permitted = new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId",
          "eth_getBlockByNumber", "eth_getCode", "eth_getBalance", "eth_call"]);
        assert.equal(f.calls.every(call => permitted.has(call.method)), true);
        assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
      } finally { f.session.disconnect(); }
    });
  }
}

test("metadata requires explicit connection and never opens a permission prompt", async () => {
  const f = providerFixture();
  await assert.rejects(f.session.getTokenMetadata(f.row.tokenAddress, HASH), code("NOT_CONNECTED"));
  assert.deepEqual(f.calls, []);
});

test("metadata refuses latest or absent block hash before any RPC", async () => {
  const f = providerFixture();
  await assert.rejects(f.session.getTokenMetadata(f.row.tokenAddress), code("IDENTITY_BLOCK_REQUIRED"));
  await assert.rejects(f.session.getTokenMetadata(f.row.tokenAddress, "latest"), code("INVALID_BLOCK_HASH"));
  assert.deepEqual(f.calls, []);
});

test("invalid contract cannot cause any metadata request", async () => {
  const f = providerFixture();
  await assert.rejects(f.session.getTokenMetadata("bad", HASH), code("IDENTITY_ADDRESS"));
  assert.deepEqual(f.calls, []);
});

for (const [field, raw, errorCode] of [
  ["name", "0x", "IDENTITY_ABI_STRING"],
  ["symbol", word(0), "IDENTITY_ABI_STRING"],
  ["decimals", word(256), "IDENTITY_DECIMALS"],
  ["totalSupply", "0x1234", "IDENTITY_ABI_WORD"],
]) {
  test("malformed " + field + " stops the metadata read", async () => {
    const f = providerFixture({ override: async args => args.method === "eth_call" &&
      args.params[0].data === METADATA_FIELDS[field] ? raw : undefined });
    try {
      await f.session.connect();
      await assert.rejects(f.session.getTokenMetadata(f.row.tokenAddress, HASH), code(errorCode));
      const callCount = Object.keys(METADATA_FIELDS).indexOf(field) + 1;
      assert.equal(f.calls.filter(call => call.method === "eth_call").length, callCount);
      assert.equal(f.session.state.connected, true);
    } finally { f.session.disconnect(); }
  });
}

for (const event of ["accountsChanged", "chainChanged", "disconnect"]) {
  test("extension event invalidates pending metadata: " + event, async () => {
    const gate = deferred();
    const entered = deferred();
    const f = providerFixture({ override: async args => {
      if (args.method === "eth_call") { entered.resolve(); return gate.promise; }
    } });
    await f.session.connect();
    const pending = f.session.getTokenMetadata(f.row.tokenAddress, HASH);
    await entered.promise;
    f.provider.emit(event, event === "accountsChanged" ? [OTHER] : event === "chainChanged" ? "0x1" : {});
    await assert.rejects(pending);
    gate.resolve(abiText("DATCORE"));
    await tick();
    assert.equal(f.session.state.connected, false);
    assert.equal(f.calls.filter(call => call.method === "eth_call").length, 1);
  });
}

for (const type of ["account", "chain"]) {
  test("silent provider " + type + " change after eth_call is rejected", async () => {
    const f = providerFixture({ override: async (args, provider) => {
      if (args.method === "eth_call") {
        if (type === "account") provider.account = OTHER;
        else provider.chain = "0x1";
        return abiText("DATCORE");
      }
    } });
    await f.session.connect();
    await assert.rejects(f.session.getTokenMetadata(f.row.tokenAddress, HASH));
    assert.equal(f.session.state.connected, false);
    assert.equal(f.calls.filter(call => call.method === "eth_call").length, 1);
  });
}

test("unsupported hash-pinned RPC never retries with latest", async () => {
  const f = providerFixture({ override: async args => {
    if (args.method === "eth_call") throw Object.assign(Error("Unsupported"), { code: -32602 });
  } });
  try {
    await f.session.connect();
    await assert.rejects(f.session.getTokenMetadata(f.row.tokenAddress, HASH));
    assert.equal(f.calls.filter(call => call.method === "eth_call").length, 1);
    assert.equal(f.calls.some(call => call.method === "eth_call" && call.params[1] === "latest"), false);
  } finally { f.session.disconnect(); }
});

test("session deadline ends a stuck metadata RPC and releases local access", async () => {
  const gate = deferred();
  const f = providerFixture({ readTimeoutMs: 10, override: async args => {
    if (args.method === "eth_call") return gate.promise;
  } });
  await f.session.connect();
  await assert.rejects(f.session.getTokenMetadata(f.row.tokenAddress, HASH), code("READ_TIMEOUT"));
  assert.equal(f.session.state.connected, false);
  gate.resolve(abiText("DATCORE"));
  await tick();
  assert.equal(f.calls.filter(call => call.method === "eth_call").length, 1);
});

test("old session results cannot disconnect an explicitly reconnected session", async () => {
  const gate = deferred();
  const entered = deferred();
  let delay = true;
  const f = providerFixture({ override: async args => {
    if (delay && args.method === "eth_call") { entered.resolve(); return gate.promise; }
  } });
  await f.session.connect();
  const old = f.session.getTokenMetadata(f.row.tokenAddress, HASH);
  await entered.promise;
  f.session.disconnect();
  await assert.rejects(old);
  delay = false;
  await f.session.connect();
  gate.resolve(abiText("DATCORE"));
  await tick();
  assert.equal(f.session.state.connected, true);
  assert.deepEqual(await f.session.getTokenMetadata(f.row.tokenAddress, HASH), f.row.metadata);
  f.session.disconnect();
});

function cardFixture(override) {
  const f = providerFixture({ override });
  const states = [];
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: ORIGIN,
    onChange: state => states.push(state) });
  return { ...f, controller, states,
    connect: () => controller.connect({ provider: f.provider, account: ACCOUNT, chainId: 8453 }) };
}

test("card controller exposes identity read without a second connection", async () => {
  const f = cardFixture();
  try {
    assert.equal(await f.connect(), true);
    const result = await f.controller.readIdentity({ tokenAddress: f.row.tokenAddress });
    assert.equal(result.agent, "DAT");
    assert.equal(f.controller.state.result.kind, "token-identity");
    assert.equal(f.controller.state.phase, "connected");
    assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
  } finally { f.controller.dispose(); }
});

test("card identity operation refuses a disconnected card", async () => {
  const f = cardFixture();
  await assert.rejects(f.controller.readIdentity({}), code("IDENTITY_NOT_CONNECTED"));
  assert.deepEqual(f.calls, []);
  f.controller.dispose();
});

for (const action of ["disconnect", "clearResult", "dispose"]) {
  test("card " + action + " suppresses delayed identity results", async () => {
    const gate = deferred();
    const entered = deferred();
    const f = cardFixture(async args => {
      if (args.method === "eth_call" && args.params[0].data === "0x06fdde03") {
        entered.resolve();
        return gate.promise;
      }
    });
    await f.connect();
    const pending = f.controller.readIdentity({});
    await entered.promise;
    f.controller[action]();
    const state = f.controller.state;
    gate.resolve(abiText("DATCORE"));
    await assert.rejects(pending);
    assert.equal(f.controller.state, state);
    assert.equal(state.result, null);
    f.controller.dispose();
  });
}

test("identity error code reaches the display controller without success state", async () => {
  const f = cardFixture(async args => args.method === "eth_call" ? "0x" : undefined);
  try {
    await f.connect();
    await assert.rejects(f.controller.readIdentity({}), code("IDENTITY_ABI_STRING"));
    assert.equal(f.controller.state.result, null);
    assert.equal(f.controller.state.phase, "connected");
  } finally { f.controller.dispose(); }
});
