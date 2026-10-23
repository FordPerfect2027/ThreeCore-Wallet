import test from "node:test";
import assert from "node:assert/strict";
import { readTransferSnapshot } from "../src/transfer-reader.js";
import { MAX_TRANSFER_EVENTS } from "../src/transfer-codec.js";
import { ACCOUNT, OTHER, REQUEST, code, context, deferred, event, hash, readerFixture, tick } from "./helpers/transfer-fixtures.js";

test("transfer reader: pinned metadata, both directional queries and final boundaries", async () => {
  const fixture = readerFixture();
  const progress = [];
  const result = await readTransferSnapshot(fixture.session, REQUEST, { onProgress: value => progress.push(value) });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].amountBaseUnits, "1234567890123456789");
  assert.deepEqual(fixture.calls.filter(call => call.method === "events").map(call => call.args[0]), [
    { fromBlock: "30", toBlock: "42", direction: "outgoing" },
    { fromBlock: "30", toBlock: "42", direction: "incoming" },
  ]);
  assert.equal(fixture.calls.find(call => call.method === "metadata").args[1], hash(42));
  assert.deepEqual(fixture.calls.slice(-2).map(call => call.args[0]), ["0x1e", "0x2a"]);
  assert.equal(progress.at(-1).stage, "complete");
  assert.equal(progress.at(-1).completed, 1);
  assert.equal(result.completeHistory, false);
});

test("transfer reader: empty successful response is explicitly a bounded observation", async () => {
  const fixture = readerFixture({ rows: [] });
  const result = await readTransferSnapshot(fixture.session, REQUEST);
  assert.deepEqual(result.events, []);
  assert.equal(result.independentVerification, false);
  assert.equal(fixture.calls.filter(call => call.method === "events").length, 2);
});

test("transfer reader: self transfer returned in both filters is counted once", async () => {
  const fixture = readerFixture({ rows: [event({ from: ACCOUNT })] });
  const result = await readTransferSnapshot(fixture.session, REQUEST);
  assert.equal(result.events.length, 1);
});

test("transfer reader: fixed historical end pins metadata to that block", async () => {
  const fixture = readerFixture({ rows: [] });
  const result = await readTransferSnapshot(fixture.session, { fromBlock: null, toBlock: "20", lookback: 5 });
  assert.deepEqual(result.range, { fromBlock: "16", toBlock: "20" });
  assert.equal(fixture.calls.find(call => call.method === "metadata").args[1], hash(20));
});

test("transfer reader: genesis single-block request does not subtract below zero", async () => {
  const fixture = readerFixture({ rows: [] });
  const result = await readTransferSnapshot(fixture.session, { fromBlock: null, toBlock: "0", lookback: 250 });
  assert.deepEqual(result.range, { fromBlock: "0", toBlock: "0" });
  assert.equal(result.fromBlockHash, result.toBlockHash);
});

for (const stage of ["block", "code", "metadata", "events"]) {
  test("transfer reader: RPC failure at " + stage + " never yields empty success", async () => {
    const fixture = readerFixture({ override: async method => { if (method === stage) throw Error("RPC offline"); } });
    await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_RPC_FAILED"));
  });
}

test("transfer reader: failed incoming query cannot publish outgoing partial data", async () => {
  const fixture = readerFixture({ rows: [event({ from: ACCOUNT, to: OTHER })], override: async (method, args) => {
    if (method === "events" && args[0].direction === "incoming") throw Error("provider range limit");
  } });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_RPC_FAILED"));
});

test("transfer reader: no token code stops before metadata and event requests", async () => {
  const fixture = readerFixture({ override: async (method, args) => method === "code" ? { address: args[0], deployed: false } : undefined });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_TOKEN_UNAVAILABLE"));
  assert.equal(fixture.calls.some(call => call.method === "events"), false);
});

test("transfer reader: metadata mismatch stops before event requests", async () => {
  const fixture = readerFixture({ override: async method => method === "metadata" ? {
    name: "DATCORE", symbol: "BAD", decimals: 18, totalSupply: "1",
  } : undefined });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_METADATA_MISMATCH"));
  assert.equal(fixture.calls.some(call => call.method === "events"), false);
});

test("transfer reader: wrong header height is rejected", async () => {
  const fixture = readerFixture({ override: async (method, args) => method === "block" && args[0] === "0x1e"
    ? { number: "0x1f", hash: hash(31) } : undefined });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_BLOCK_HEADER"));
});

test("transfer reader: event block hash is independently matched to its height", async () => {
  const fixture = readerFixture({ rows: [event({ blockHash: hash(999) })] });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_BLOCK_CHANGED"));
});

test("transfer reader: end block change after log collection fails atomically", async () => {
  let logsRead = false;
  const fixture = readerFixture({ override: async (method, args) => {
    if (method === "events") logsRead = true;
    if (method === "block" && logsRead && args[0] === "0x2a") return { number: "0x2a", hash: hash(999) };
  } });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_BLOCK_CHANGED"));
});

test("transfer reader: boundary change also fails when no events were returned", async () => {
  let logsRead = false;
  const fixture = readerFixture({ rows: [], override: async (method, args) => {
    if (method === "events") logsRead = true;
    if (method === "block" && logsRead && args[0] === "0x1e") return { number: "0x1e", hash: hash(999) };
  } });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_BLOCK_CHANGED"));
});

test("transfer reader: direct session cannot return wrong directional events", async () => {
  const fixture = readerFixture({ override: async method => method === "events" ? [event()] : undefined });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_FILTER_MISMATCH"));
});

test("transfer reader: duplicate within one response is not silently collapsed", async () => {
  const fixture = readerFixture({ rows: [event(), event()] });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_DUPLICATE_RESPONSE"));
});

test("transfer reader: excessive directional result is rejected before header amplification", async () => {
  const rows = Array.from({ length: MAX_TRANSFER_EVENTS + 1 }, (_, index) => event({}, index));
  const fixture = readerFixture({ rows });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_EVENT_LIMIT"));
  assert.equal(fixture.calls.filter(call => call.method === "block").length, 2);
});

for (const [field, value] of [["account", OTHER], ["chainId", 84532], ["agent", "EMA"],
  ["connectionEpoch", 2], ["connected", false], ["siteOrigin", "https://elsewhere.example"]]) {
  test("transfer reader: rejects changed session " + field, async () => {
    const fixture = readerFixture({ override: async (method, args, state) => {
      if (method === "events") state[field] = value;
    } });
    await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_SESSION_CHANGED"));
  });
}

for (const field of ["canSign", "canBridge", "canSendTransactions"]) {
  test("transfer reader: non-read-only capability " + field + " rejected before RPC", async () => {
    const fixture = readerFixture();
    fixture.state[field] = true;
    await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_CAPABILITIES"));
    assert.equal(fixture.calls.length, 0);
  });
}

test("transfer reader: disconnected session never requests permission automatically", async () => {
  const fixture = readerFixture();
  fixture.state.connected = false;
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), code("TRANSFER_NOT_CONNECTED"));
  assert.equal(fixture.calls.length, 0);
});

test("transfer reader: cancellation before first RPC", async () => {
  const fixture = readerFixture();
  const aborter = new AbortController();
  aborter.abort();
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST, { signal: aborter.signal }), code("TRANSFER_CANCELLED"));
  assert.equal(fixture.calls.length, 0);
});

test("transfer reader: cancel pending read and discard late reply", async () => {
  const pending = deferred();
  const fixture = readerFixture({ override: async method => method === "metadata" ? pending.promise : undefined });
  const aborter = new AbortController();
  const reading = readTransferSnapshot(fixture.session, REQUEST, { signal: aborter.signal });
  await tick();
  aborter.abort();
  await assert.rejects(reading, code("TRANSFER_CANCELLED"));
  pending.resolve(fixture.observed.metadata);
  await tick();
  assert.equal(fixture.calls.some(call => call.method === "events"), false);
});

test("transfer reader: timeout rejects even if provider promise never settles", async () => {
  const fixture = readerFixture({ override: async method => method === "block" ? new Promise(() => {}) : undefined });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST, { timeoutMs: 10 }), code("TRANSFER_TIMEOUT"));
  assert.equal(fixture.calls.length, 1);
});

test("transfer reader: observation callback failures cannot corrupt result", async () => {
  const fixture = readerFixture();
  const result = await readTransferSnapshot(fixture.session, REQUEST, { onProgress: () => { throw Error("view failed"); } });
  assert.equal(result.events.length, 1);
});

test("transfer reader: asynchronous observer rejection is handled", async () => {
  const fixture = readerFixture();
  const result = await readTransferSnapshot(fixture.session, REQUEST, { onProgress: async () => { throw Error("view failed"); } });
  assert.equal(result.events.length, 1);
  await tick();
});

test("transfer reader: callback-triggered context mutation is rejected before next RPC", async () => {
  const fixture = readerFixture();
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST, { onProgress: () => { fixture.state.account = OTHER; } }),
    code("TRANSFER_SESSION_CHANGED"));
  assert.equal(fixture.calls.length, 0);
});

for (const options of [{ timeoutMs: 0 }, { timeoutMs: 120001 }, { timeoutMs: "10" }, { signal: {} }, { onProgress: true }]) {
  test("transfer reader: invalid options " + JSON.stringify(options), async () => {
    const fixture = readerFixture();
    await assert.rejects(readTransferSnapshot(fixture.session, REQUEST, options));
    assert.equal(fixture.calls.length, 0);
  });
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test(`transfer reader: isolates ${agent} on ${chainId}`, async () => {
      const fixture = readerFixture({ selected: context(agent, chainId) });
      const result = await readTransferSnapshot(fixture.session, REQUEST);
      assert.equal(result.context.agent, agent);
      assert.equal(result.context.chainId, chainId);
      assert.equal(result.metadata.symbol, agent);
    });
  }
}
