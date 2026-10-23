import test from "node:test";
import assert from "node:assert/strict";
import { TRANSFER_TOPIC, addressTopic } from "../src/transfer-codec.js";
import { readTransferSnapshot } from "../src/transfer-reader.js";
import { ACCOUNT, OTHER, REQUEST, code, context, deferred, event, providerFixture, rawLog, tick } from "./helpers/transfer-fixtures.js";

const query = direction => ({ fromBlock: "30", toBlock: "42", direction });

test("transfer session: requires explicit connection before log access", async () => {
  const fixture = providerFixture();
  await assert.rejects(fixture.session.getTransferEvents(query("incoming")), code("NOT_CONNECTED"));
  assert.equal(fixture.calls.length, 0);
});

test("transfer session: only registered contract, topic and bound account reach RPC", async () => {
  const fixture = providerFixture();
  await fixture.session.connect();
  await fixture.session.getTransferEvents(query("outgoing"));
  await fixture.session.getTransferEvents(query("incoming"));
  const logs = fixture.calls.filter(call => call.method === "eth_getLogs");
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0].params, [{ address: fixture.observed.tokenAddress, fromBlock: "0x1e", toBlock: "0x2a",
    topics: [TRANSFER_TOPIC, addressTopic(ACCOUNT)] }]);
  assert.deepEqual(logs[1].params[0].topics, [TRANSFER_TOPIC, null, addressTopic(ACCOUNT)]);
  for (const call of logs) assert.equal(Object.hasOwn(call.params[0], "blockHash"), false);
  fixture.session.disconnect();
});

test("transfer session: chain and account are rechecked after every log response", async () => {
  const fixture = providerFixture();
  await fixture.session.connect();
  await fixture.session.getTransferEvents(query("incoming"));
  const index = fixture.calls.findIndex(call => call.method === "eth_getLogs");
  assert.deepEqual(fixture.calls.slice(index + 1).map(call => call.method), ["eth_chainId", "eth_accounts"]);
  fixture.session.disconnect();
});

for (const value of ["all", "", null, 1]) {
  test("transfer session: unsupported direction " + value, async () => {
    const fixture = providerFixture();
    await assert.rejects(fixture.session.getTransferEvents(query(value)), code("TRANSFER_FILTER_MISMATCH"));
    assert.equal(fixture.calls.length, 0);
  });
}

test("transfer session: cannot inject custom token, topics or extra RPC keys", async () => {
  const fixture = providerFixture();
  await assert.rejects(fixture.session.getTransferEvents({ ...query("incoming"), address: OTHER }), code("TRANSFER_SHAPE"));
  await assert.rejects(fixture.session.getTransferEvents({ ...query("incoming"), topics: [] }), code("TRANSFER_SHAPE"));
  assert.equal(fixture.calls.length, 0);
});

test("transfer session: duplicate provider rows fail", async () => {
  const fixture = providerFixture({ override: async args => args.method === "eth_getLogs" ? [rawLog(), rawLog()] : undefined });
  await fixture.session.connect();
  await assert.rejects(fixture.session.getTransferEvents(query("incoming")), code("TRANSFER_DUPLICATE_RESPONSE"));
  fixture.session.disconnect();
});

for (const response of [null, {}, "[]", [rawLog({ removed: true })]]) {
  test("transfer session: invalid logs response " + JSON.stringify(response).slice(0, 30), async () => {
    const fixture = providerFixture({ override: async args => args.method === "eth_getLogs" ? response : undefined });
    await fixture.session.connect();
    await assert.rejects(fixture.session.getTransferEvents(query("incoming")));
    fixture.session.disconnect();
  });
}

test("transfer session: silent account change invalidates returned logs", async () => {
  const fixture = providerFixture({ override: async (args, provider) => {
    if (args.method === "eth_getLogs") provider.account = OTHER;
  } });
  await fixture.session.connect();
  await assert.rejects(fixture.session.getTransferEvents(query("incoming")), code("ACCOUNT_CHANGED"));
  assert.equal(fixture.session.state.connected, false);
});

test("transfer session: silent chain change invalidates returned logs", async () => {
  const fixture = providerFixture({ override: async (args, provider) => {
    if (args.method === "eth_getLogs") provider.chain = "0x14a34";
  } });
  await fixture.session.connect();
  await assert.rejects(fixture.session.getTransferEvents(query("incoming")));
  assert.equal(fixture.session.state.connected, false);
});

test("transfer session: disconnect during pending request discards late logs", async () => {
  const pending = deferred();
  const fixture = providerFixture({ override: async args => args.method === "eth_getLogs" ? pending.promise : undefined });
  await fixture.session.connect();
  const reading = fixture.session.getTransferEvents(query("incoming"));
  const rejected = assert.rejects(reading);
  await tick();
  fixture.session.disconnect();
  await rejected;
  pending.resolve([rawLog()]);
  await tick();
  assert.equal(fixture.session.state.connected, false);
});

test("transfer session: logs timeout disconnects the session", async () => {
  const fixture = providerFixture({ readTimeoutMs: 10, override: async args => args.method === "eth_getLogs" ? new Promise(() => {}) : undefined });
  await fixture.session.connect();
  await assert.rejects(fixture.session.getTransferEvents(query("incoming")), code("READ_TIMEOUT"));
  assert.equal(fixture.session.state.connected, false);
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test(`transfer session: full reader integration ${agent} ${chainId} uses read-only methods`, async () => {
      const fixture = providerFixture({ selected: context(agent, chainId), rows: [event(), event({ from: ACCOUNT, to: OTHER }, 1)] });
      await fixture.session.connect();
      const result = await readTransferSnapshot(fixture.session, REQUEST);
      assert.equal(result.events.length, 2);
      assert.equal(result.context.agent, agent);
      const allowed = new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getLogs"]);
      assert.ok(fixture.calls.every(call => allowed.has(call.method)));
      assert.equal(fixture.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
      assert.ok(fixture.calls.filter(call => call.method === "eth_call").every(call => call.params[1].requireCanonical === true));
      fixture.session.disconnect();
      assert.ok([...fixture.listeners.values()].every(set => set.size === 0));
    });
  }
}
