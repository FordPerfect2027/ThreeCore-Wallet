import test from "node:test";
import assert from "node:assert/strict";
import { validateTransferContext, validateTransferRequest, validateTransferEvent,
  validateTransferSnapshot, decodeTransferLog, normalizeTransferEvents } from "../src/transfer-codec.js";
import { readTransferSnapshot } from "../src/transfer-reader.js";
import { ACCOUNT, OTHER, REQUEST, context, event, rawLog, snapshot, readerFixture, providerFixture } from "./helpers/transfer-fixtures.js";

const ownOnly = value => new Proxy(value, { get(target, key) {
  if (key === "then") return undefined;
  throw Error("Unexpected live read: " + String(key));
} });
const range = { fromBlock: "30", toBlock: "42" };

test("transfer context and request use captured own fields", () => {
  assert.deepEqual(validateTransferContext(ownOnly(context())), context());
  assert.deepEqual(validateTransferRequest(ownOnly(REQUEST)), REQUEST);
});

test("transfer event fields are captured before validation", () => {
  assert.deepEqual(validateTransferEvent(ownOnly(event()), context(), range), event());
});

test("raw log and topic array are captured without live property reads", () => {
  const raw = rawLog();
  assert.deepEqual(decodeTransferLog(ownOnly({ ...raw, topics: ownOnly(raw.topics) }), context(), range, "incoming"), event());
});

test("topic accessors cannot run during log decoding", () => {
  const raw = rawLog(); let invoked = false;
  Object.defineProperty(raw.topics, "1", { get() { invoked = true; return rawLog().topics[1]; } });
  assert.throws(() => decodeTransferLog(raw, context(), range, "incoming"), { code: "TRANSFER_EVENT_TOPIC" });
  assert.equal(invoked, false);
});

test("event-array custom iterator cannot turn a real row into empty history", () => {
  const rows = [event()]; let invoked = false;
  rows[Symbol.iterator] = function* () { invoked = true; };
  assert.throws(() => normalizeTransferEvents(rows, context(), range), { code: "TRANSFER_EVENT_LIMIT" });
  assert.equal(invoked, false);
});

test("event normalization takes bounded own array entries", () => {
  assert.deepEqual(normalizeTransferEvents(ownOnly([ownOnly(event())]), context(), range), [event()]);
});

test("snapshot root, range and event array use one captured version", () => {
  const original = snapshot();
  const input = ownOnly({ ...original, range: ownOnly(original.range), events: ownOnly([ownOnly(event())]) });
  assert.deepEqual(validateTransferSnapshot(input), validateTransferSnapshot(original));
});

test("reader does not invoke a response-array iterator that hides rows", async () => {
  const rows = [event()]; let invoked = false;
  rows[Symbol.iterator] = function* () { invoked = true; };
  const fixture = readerFixture({ override: async (method, args) => method === "events"
    ? args[0].direction === "incoming" ? rows : [] : undefined });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), { code: "TRANSFER_EVENT_LIMIT" });
  assert.equal(invoked, false);
});

test("reader checks direction on captured data rather than a transient field read", async () => {
  const row = new Proxy(event({ from: ACCOUNT, to: OTHER }), { get(target, key, receiver) {
    return key === "to" ? ACCOUNT : Reflect.get(target, key, receiver);
  } });
  const fixture = readerFixture({ override: async (method, args) => method === "events"
    ? args[0].direction === "incoming" ? [row] : [] : undefined });
  await assert.rejects(readTransferSnapshot(fixture.session, REQUEST), { code: "TRANSFER_FILTER_MISMATCH" });
});

test("later RPC replies cannot rewrite an event already accepted by the reader", async () => {
  const row = event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "1" });
  const fixture = readerFixture({ override: async (method, args) => {
    if (method !== "events") return undefined;
    if (args[0].direction === "outgoing") return [row];
    row.amountBaseUnits = "2"; return [];
  } });
  assert.equal((await readTransferSnapshot(fixture.session, REQUEST)).events[0].amountBaseUnits, "1");
});

test("metadata is captured at its accepted read, before the event queries", async () => {
  const metadata = { ...snapshot().metadata, totalSupply: "100" };
  const fixture = readerFixture({ override: async method => {
    if (method === "metadata") return metadata;
    if (method === "events") { metadata.totalSupply = "200"; return []; }
  } });
  assert.equal((await readTransferSnapshot(fixture.session, REQUEST)).metadata.totalSupply, "100");
});

test("wallet adapter captures the requested range and direction before any RPC", async () => {
  const fixture = providerFixture();
  await fixture.session.connect();
  try {
    const result = await fixture.session.getTransferEvents(ownOnly({ ...range, direction: "incoming" }));
    assert.deepEqual(result, [event()]);
    assert.equal(fixture.calls.filter(call => call.method === "eth_getLogs").length, 1);
  } finally { fixture.session.disconnect(); }
});
