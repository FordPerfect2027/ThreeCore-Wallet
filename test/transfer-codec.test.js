import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TRANSFER_EVENTS, TRANSFER_TOPIC, ZERO_ADDRESS, addressTopic, decodeTransferLog,
  hexQuantity, normalizeTransferEvents, quantity, resolveTransferRange, transferAddress,
  transferDirection, transferHash, transferUnits, validateTransferContext,
  validateTransferRequest, validateTransferSnapshot,
} from "../src/transfer-codec.js";
import { UINT256_MAX } from "../src/token-identity-codec.js";
import { ACCOUNT, OTHER, THIRD, REQUEST, clone, code, context, event, hash, rawLog, snapshot } from "./helpers/transfer-fixtures.js";

test("transfer codec: exact ERC-20 Transfer signature and padded address topic", () => {
  assert.equal(TRANSFER_TOPIC.length, 66);
  assert.equal(addressTopic(ACCOUNT), "0x" + "0".repeat(24) + ACCOUNT.slice(2));
  assert.equal(transferAddress(OTHER.toUpperCase().replace("0X", "0x")), OTHER);
});

for (const value of [null, undefined, 1, {}, "", "0x12", ZERO_ADDRESS, "0X" + "ab".repeat(20), " " + ACCOUNT]) {
  test("transfer codec: rejects invalid account " + JSON.stringify(value), () => {
    assert.throws(() => transferAddress(value), code("TRANSFER_ADDRESS"));
  });
}

test("transfer codec: zero address is allowed only in event endpoints", () => {
  assert.equal(transferAddress(ZERO_ADDRESS, true), ZERO_ADDRESS);
  assert.throws(() => addressTopic(ZERO_ADDRESS), code("TRANSFER_ADDRESS"));
});

for (const [hex, decimal] of [["0x0", "0"], ["0xa", "10"], ["0xFF", "255"], ["0x" + "f".repeat(64), UINT256_MAX.toString()]]) {
  test("transfer codec: lossless quantity " + hex.slice(0, 15), () => {
    assert.equal(quantity(hex), decimal);
    assert.equal(hexQuantity(decimal), hex.toLowerCase());
  });
}

for (const value of ["0x", "0x00", "0x01", "-1", "1", "0x-1", 42, "0x" + "1".repeat(65)]) {
  test("transfer codec: rejects noncanonical RPC quantity " + String(value).slice(0, 20), () => {
    assert.throws(() => quantity(value), code("TRANSFER_QUANTITY"));
  });
}

for (const value of ["-1", "01", "1.0", "1e9", " 1", 1, null, (UINT256_MAX + 1n).toString()]) {
  test("transfer codec: rejects unsafe decimal integer " + String(value).slice(0, 15), () => {
    assert.throws(() => transferUnits(value), code("TRANSFER_INTEGER"));
  });
}

test("transfer codec: context rejects extra fields and unsupported chains", () => {
  assert.throws(() => validateTransferContext({ ...context(), token: OTHER }), code("TRANSFER_SHAPE"));
  assert.throws(() => validateTransferContext(context("DAT", 1)), code("TRANSFER_CONTEXT"));
  assert.throws(() => validateTransferContext(context("DOT")), code("TRANSFER_CONTEXT"));
});

test("transfer codec: input accessors are rejected without invoking them", () => {
  let invoked = false;
  const value = { ...context() };
  Object.defineProperty(value, "account", { enumerable: true, get() { invoked = true; return ACCOUNT; } });
  assert.throws(() => validateTransferContext(value), code("TRANSFER_SHAPE"));
  assert.equal(invoked, false);
});

test("transfer codec: recent range clamps at genesis", () => {
  assert.deepEqual(resolveTransferRange({ fromBlock: null, toBlock: null, lookback: 250 }, "42"), { fromBlock: "0", toBlock: "42" });
  assert.deepEqual(resolveTransferRange({ fromBlock: null, toBlock: null, lookback: 1 }, "42"), { fromBlock: "42", toBlock: "42" });
  assert.deepEqual(resolveTransferRange({ fromBlock: null, toBlock: "20", lookback: 10 }, "42"), { fromBlock: "11", toBlock: "20" });
});

test("transfer codec: range bound is inclusive and checked against current head", () => {
  assert.deepEqual(resolveTransferRange({ fromBlock: "1", toBlock: "2000", lookback: 1 }, "3000"), { fromBlock: "1", toBlock: "2000" });
  assert.throws(() => validateTransferRequest({ fromBlock: "0", toBlock: "2000", lookback: 1 }), code("TRANSFER_RANGE"));
  assert.throws(() => resolveTransferRange({ fromBlock: "43", toBlock: null, lookback: 10 }, "42"), code("TRANSFER_RANGE"));
  assert.throws(() => resolveTransferRange({ fromBlock: null, toBlock: "43", lookback: 10 }, "42"), code("TRANSFER_FUTURE_BLOCK"));
});

for (const value of [0, -1, 2001, 1.2, "250", null, Infinity, NaN]) {
  test("transfer codec: bounded lookback " + String(value), () => {
    assert.throws(() => validateTransferRequest({ ...REQUEST, lookback: value }), code("TRANSFER_LOOKBACK"));
  });
}

for (const [from, to, direction] of [
  [OTHER, ACCOUNT, "incoming"], [ACCOUNT, OTHER, "outgoing"], [ACCOUNT, ACCOUNT, "self"],
  [ZERO_ADDRESS, ACCOUNT, "mint"], [ACCOUNT, ZERO_ADDRESS, "burn"],
]) {
  test("transfer codec: classifies " + direction + " including zero amounts", () => {
    assert.equal(transferDirection(event({ from, to, amountBaseUnits: "0" }), ACCOUNT), direction);
  });
}

test("transfer codec: unrelated endpoints cannot be smuggled into history", () => {
  assert.throws(() => transferDirection(event({ from: OTHER, to: THIRD }), ACCOUNT), code("TRANSFER_UNRELATED_EVENT"));
});

test("transfer codec: raw log decodes to immutable exact event", () => {
  const parsed = decodeTransferLog(rawLog(), context(), snapshot().range, "incoming");
  assert.deepEqual(parsed, event());
  assert.equal(Object.isFrozen(parsed), true);
});

const corruptLogs = [
  ["wrong contract", { address: OTHER }, "TRANSFER_WRONG_TOKEN"],
  ["removed", { removed: true }, "TRANSFER_REMOVED_LOG"],
  ["missing removed", { removed: undefined }, "TRANSFER_REMOVED_LOG"],
  ["ERC721 topics", { topics: [TRANSFER_TOPIC, addressTopic(OTHER), addressTopic(ACCOUNT), hash(1)] }, "TRANSFER_EVENT_TOPIC"],
  ["wrong topic", { topics: [hash(0), addressTopic(OTHER), addressTopic(ACCOUNT)] }, "TRANSFER_EVENT_TOPIC"],
  ["nonzero padding", { topics: [TRANSFER_TOPIC, "0x1" + "0".repeat(23) + OTHER.slice(2), addressTopic(ACCOUNT)] }, "TRANSFER_TOPIC_ADDRESS"],
  ["short amount", { data: "0x1" }, "TRANSFER_EVENT_DATA"],
  ["long amount", { data: "0x" + "0".repeat(66) }, "TRANSFER_EVENT_DATA"],
  ["pending block", { blockNumber: null }, "TRANSFER_QUANTITY"],
  ["pending hash", { blockHash: null }, "TRANSFER_HASH"],
  ["bad transaction", { transactionHash: "0x1234" }, "TRANSFER_HASH"],
  ["outside range", { blockNumber: "0x2b" }, "TRANSFER_OUTSIDE_RANGE"],
  ["unrelated recipient", { topics: [TRANSFER_TOPIC, addressTopic(OTHER), addressTopic(THIRD)] }, "TRANSFER_FILTER_MISMATCH"],
];
for (const [name, changes, error] of corruptLogs) {
  test("transfer codec: reject raw " + name, () => {
    assert.throws(() => decodeTransferLog(rawLog(changes), context(), snapshot().range, "incoming"), code(error));
  });
}

test("transfer codec: direction filter cannot be widened by caller", () => {
  assert.throws(() => decodeTransferLog(rawLog(), context(), snapshot().range, "outgoing"), code("TRANSFER_FILTER_MISMATCH"));
  assert.throws(() => decodeTransferLog(rawLog(), context(), snapshot().range, "all"), code("TRANSFER_FILTER_MISMATCH"));
});

test("transfer codec: merges identical self events across account queries only once", () => {
  const self = event({ from: ACCOUNT });
  const result = normalizeTransferEvents([self, clone(self)], context(), snapshot().range);
  assert.equal(result.length, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.notEqual(result[0], self);
});

test("transfer codec: conflicting same event identity fails", () => {
  assert.throws(() => normalizeTransferEvents([event(), event({ amountBaseUnits: "2" })], context(), snapshot().range),
    code("TRANSFER_CONFLICTING_DUPLICATE"));
});

test("transfer codec: two transactions cannot share one log position", () => {
  assert.throws(() => normalizeTransferEvents([event(), event({ transactionHash: hash(999) })], context(), snapshot().range),
    code("TRANSFER_LOG_POSITION"));
});

test("transfer codec: transaction cannot move across blocks in one observation", () => {
  assert.throws(() => normalizeTransferEvents([event(), event({ blockNumber: "41", blockHash: hash(41), logIndex: "1" })],
    context(), snapshot().range), code("TRANSFER_TRANSACTION_POSITION"));
});

test("transfer codec: block hashes must agree at one height", () => {
  assert.throws(() => normalizeTransferEvents([event(), event({ blockHash: hash(99) }, 1)], context(), snapshot().range),
    code("TRANSFER_BLOCK_CHANGED"));
});

test("transfer codec: two hashes cannot occupy one transaction slot", () => {
  assert.throws(() => normalizeTransferEvents([event(), event({ transactionIndex: "0" }, 1)], context(), snapshot().range),
    code("TRANSFER_TRANSACTION_POSITION"));
});

test("transfer codec: transaction order and block-wide log order must agree", () => {
  assert.throws(() => normalizeTransferEvents([event({ logIndex: "4" }), event({ logIndex: "3" }, 1)], context(), snapshot().range),
    code("TRANSFER_LOG_ORDER"));
});

test("transfer codec: multiple Transfer events in a transaction share its slot", () => {
  const rows = [event(), event({ transactionHash: event().transactionHash, transactionIndex: "0" }, 1)];
  assert.equal(normalizeTransferEvents(rows, context(), snapshot().range).length, 2);
});

test("transfer codec: sort uses integers, not lexicographic order", () => {
  const result = normalizeTransferEvents([event({}, 20), event({}, 2), event({}, 10)], context(), snapshot().range);
  assert.deepEqual(result.map(row => row.logIndex), ["2", "10", "20"]);
});

test("transfer codec: a normal maximum response stays lossless", () => {
  const events = Array.from({ length: MAX_TRANSFER_EVENTS }, (_, index) => event({}, index));
  const result = validateTransferSnapshot(snapshot({ events }));
  assert.equal(result.events.length, 500);
  assert.equal(result.events[499].amountBaseUnits, "1234567890123456789");
});

test("transfer codec: rejects too many unique events", () => {
  const events = Array.from({ length: 501 }, (_, index) => event({}, index));
  assert.throws(() => validateTransferSnapshot(snapshot({ events })), code("TRANSFER_EVENT_LIMIT"));
});

test("transfer codec: limits occupied block-header work", () => {
  const events = Array.from({ length: 101 }, (_, index) => event({ blockNumber: String(index), blockHash: hash(index) }, index));
  assert.throws(() => validateTransferSnapshot(snapshot({ events, range: { fromBlock: "0", toBlock: "102" },
    fromBlockHash: hash(0), toBlockHash: hash(102) })), code("TRANSFER_EVENT_LIMIT"));
});

test("transfer codec: exported snapshots cannot contain duplicate events", () => {
  assert.throws(() => validateTransferSnapshot(snapshot({ events: [event(), event()] })), code("TRANSFER_DUPLICATE_FILE_EVENT"));
});

test("transfer codec: snapshot clones and freezes every nested collection", () => {
  const input = snapshot();
  const parsed = validateTransferSnapshot(input);
  input.events[0].amountBaseUnits = "0";
  input.context.account = OTHER;
  assert.equal(parsed.events[0].amountBaseUnits, "1234567890123456789");
  assert.equal(parsed.context.account, ACCOUNT);
  for (const value of [parsed, parsed.context, parsed.range, parsed.metadata, parsed.events, parsed.events[0]]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

for (const flag of ["readOnly", "completeHistory", "independentVerification"]) {
  test("transfer codec: cannot claim unsupported capability " + flag, () => {
    const input = snapshot();
    input[flag] = !input[flag];
    assert.throws(() => validateTransferSnapshot(input), code("TRANSFER_SCHEMA"));
  });
}

for (const field of ["name", "symbol", "decimals"]) {
  test("transfer codec: registered token metadata mismatch " + field, () => {
    const input = snapshot();
    input.metadata[field] = field === "decimals" ? 6 : "OTHER";
    assert.throws(() => validateTransferSnapshot(input), code("TRANSFER_METADATA_MISMATCH"));
  });
}

test("transfer codec: burned supply may differ from initial supply", () => {
  const input = snapshot();
  input.metadata.totalSupply = "1";
  assert.equal(validateTransferSnapshot(input).metadata.totalSupply, "1");
});

test("transfer codec: boundary events must agree with boundary hash", () => {
  assert.throws(() => validateTransferSnapshot(snapshot({ events: [event({ blockNumber: "42" })] })), code("TRANSFER_BLOCK_CHANGED"));
});

test("transfer codec: one-block observation has a single boundary hash", () => {
  assert.throws(() => validateTransferSnapshot(snapshot({ range: { fromBlock: "40", toBlock: "40" } })), code("TRANSFER_BLOCK_CHANGED"));
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test(`transfer codec: catalog binding ${agent} ${chainId}`, () => {
      const value = validateTransferSnapshot(snapshot({}, context(agent, chainId)));
      assert.equal(value.metadata.symbol, agent);
      assert.equal(value.context.chainId, chainId);
      assert.equal(value.readOnly, true);
    });
  }
}

test("transfer codec: hash parser normalizes hex without changing bytes", () => {
  assert.equal(transferHash("0x" + "AB".repeat(32)), "0x" + "ab".repeat(32));
  assert.throws(() => transferHash("0x" + "ab".repeat(31)), code("TRANSFER_HASH"));
});
