import test from "node:test";
import assert from "node:assert/strict";
import { validateTokenObservation, assessTokenObservation, compareTokenObservations,
  observationContextKey } from "../src/token-identity-model.js";
import { UINT256_MAX } from "../src/token-identity-codec.js";
import { observation, clone, code, OTHER } from "./helpers/identity-fixtures.js";

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chain of [8453, 84532]) {
    test(`${agent} ${chain} metadata and amounts match registered identity`, () => {
      const row = observation({}, agent, chain);
      const result = assessTokenObservation(row);
      assert.equal(result.status, "matched");
      assert.deepEqual(result.mismatchFields, []);
      assert.equal(result.tokenAmount, "1.234567890123456789");
      assert.equal(result.nativeAmount, "9.007199254740993123");
      assert.equal(result.expected.testnet, chain === 84532);
      assert.equal(result.securityAudit, false);
      assert.equal(result.ownershipVerified, false);
      assert.equal(result.authorizesTransaction, false);
      assert.equal(result.provesCurrentBalance, false);
    });
    test(`${agent} ${chain} lower supply remains within issuance without claiming a burn`, () => {
      const row = observation({}, agent, chain);
      row.metadata.totalSupply = (BigInt(row.metadata.totalSupply) - 1n).toString();
      const result = assessTokenObservation(row);
      assert.equal(result.status, "matched");
      assert.equal(result.belowInitialSupply, true);
      assert.equal("burnVerified" in result, false);
    });
    test(`${agent} ${chain} excessive supply is not accepted`, () => {
      const row = observation({}, agent, chain);
      row.metadata.totalSupply = (BigInt(row.metadata.totalSupply) + 1n).toString();
      const result = assessTokenObservation(row);
      assert.equal(result.status, "mismatch");
      assert.deepEqual(result.mismatchFields, ["supply"]);
      assert.equal(result.tokenAmount, null);
    });
  }
}

for (const [field, value] of [["name", "Fake DAT"], ["symbol", "DOT"], ["decimals", 6]]) {
  test("mismatched " + field + " hides formatted balance", () => {
    const row = observation();
    row.metadata[field] = value;
    const result = assessTokenObservation(row);
    assert.equal(result.status, "mismatch");
    assert.deepEqual(result.mismatchFields, [field]);
    assert.equal(result.tokenAmount, null);
    assert.equal(result.nativeAmount, "9.007199254740993123");
  });
}

test("missing code is not represented by zero tokens or fabricated metadata", () => {
  const row = observation({ hasCode: false, metadata: null, balanceBaseUnits: null });
  const result = assessTokenObservation(row);
  assert.equal(result.status, "missing-code");
  assert.equal(result.tokenAmount, null);
  assert.equal(result.checks.find(check => check.field === "balance").status, "unknown");
});

test("wallet balance above reported supply is inconsistent", () => {
  const row = observation();
  row.balanceBaseUnits = (BigInt(row.metadata.totalSupply) + 1n).toString();
  const result = assessTokenObservation(row);
  assert.equal(result.status, "mismatch");
  assert.deepEqual(result.mismatchFields, ["balance"]);
  assert.equal(result.tokenAmount, null);
});

test("zero balance and zero supply are both representable", () => {
  const row = observation({ balanceBaseUnits: "0" });
  row.metadata.totalSupply = "0";
  const result = assessTokenObservation(row);
  assert.equal(result.status, "matched");
  assert.equal(result.tokenAmount, "0");
  assert.equal(result.belowInitialSupply, true);
});

const invalidRecords = [
  ["schema", { schema: "unknown" }, "IDENTITY_SCHEMA"],
  ["catalog version", { catalogVersion: "future" }, "IDENTITY_SCHEMA"],
  ["audit assertion", { securityAudit: true }, "IDENTITY_SCHEMA"],
  ["write capability", { readOnly: false }, "IDENTITY_SCHEMA"],
  ["account zero", { account: "0x" + "0".repeat(40) }, "IDENTITY_ADDRESS"],
  ["token address", { tokenAddress: OTHER }, "IDENTITY_CONTRACT_MISMATCH"],
  ["chain", { chainId: 1 }, "IDENTITY_CONTEXT"],
  ["insecure origin", { siteOrigin: "http://public.example" }, "IDENTITY_ORIGIN"],
  ["origin path", { siteOrigin: "https://example.org/path" }, "IDENTITY_ORIGIN"],
  ["epoch negative", { connectionEpoch: -1 }, "IDENTITY_EPOCH"],
  ["epoch unsafe", { connectionEpoch: Number.MAX_SAFE_INTEGER + 1 }, "IDENTITY_EPOCH"],
  ["block negative", { blockNumber: "-1" }, "IDENTITY_AMOUNT"],
  ["block exponent", { blockNumber: "1e4" }, "IDENTITY_AMOUNT"],
  ["block hash", { blockHash: "0x42" }, "IDENTITY_BLOCK"],
  ["code flag string", { hasCode: "true" }, "IDENTITY_CODE"],
  ["no code with metadata", { hasCode: false }, "IDENTITY_MISSING_CODE_DATA"],
  ["code with null metadata", { metadata: null }, "IDENTITY_SHAPE"],
  ["code with null balance", { balanceBaseUnits: null }, "IDENTITY_AMOUNT"],
  ["native negative", { nativeBalanceBaseUnits: "-1" }, "IDENTITY_AMOUNT"],
  ["balance overflow", { balanceBaseUnits: (UINT256_MAX + 1n).toString() }, "IDENTITY_AMOUNT"],
];
for (const [label, changes, expected] of invalidRecords) {
  test("observation rejects " + label, () => {
    assert.throws(() => validateTokenObservation(observation(changes)), code(expected));
  });
}

test("observation rejects unknown authorizations and property accessors", () => {
  assert.throws(() => validateTokenObservation({ ...observation(), authorization: "yes" }), code("IDENTITY_SHAPE"));
  let calls = 0;
  const row = observation();
  Object.defineProperty(row, "balanceBaseUnits", { get() { calls++; return "1"; } });
  assert.throws(() => validateTokenObservation(row), code("IDENTITY_SHAPE"));
  assert.equal(calls, 0);
});

test("observation and assessment are immutable detached trees", () => {
  const original = observation();
  const checked = validateTokenObservation(original);
  const assessed = assessTokenObservation(original);
  original.metadata.name = "changed";
  assert.equal(checked.metadata.name, "DATCORE");
  assert.equal(Object.isFrozen(checked.metadata), true);
  assert.equal(Object.isFrozen(assessed.checks), true);
  assert.equal(Object.isFrozen(assessed.checks[0]), true);
  assert.throws(() => { assessed.checks[0].status = "fake"; });
});

test("address and block-hash case are normalized without changing identity", () => {
  const row = observation();
  row.tokenAddress = "0x" + row.tokenAddress.slice(2).toUpperCase();
  row.blockHash = "0x" + row.blockHash.slice(2).toUpperCase();
  const checked = validateTokenObservation(row);
  assert.equal(checked.tokenAddress, observation().tokenAddress);
  assert.equal(checked.blockHash, observation().blockHash);
});

for (const [amount, direction, delta, display] of [
  ["1234567890123456790", "increased", "1", "+0.000000000000000001"],
  ["1234567890123456788", "decreased", "-1", "-0.000000000000000001"],
  ["1234567890123456789", "unchanged", "0", "0"],
]) {
  test("exact comparison " + direction, () => {
    const first = observation();
    const later = observation({ blockNumber: "43", balanceBaseUnits: amount });
    const result = compareTokenObservations(first, later);
    assert.equal(result.deltaBaseUnits, delta);
    assert.equal(result.deltaAmount, display);
    assert.equal(result.direction, direction);
    assert.equal(result.comparable, true);
    assert.equal(result.provesTransfers, false);
    assert.equal(result.provesProfit, false);
  });
}

test("large block numbers are sorted as integers, never floating point", () => {
  const before = observation({ blockNumber: "9007199254740993000" });
  const after = observation({ blockNumber: "9007199254740993001", balanceBaseUnits: "1" });
  assert.equal(compareTokenObservations(before, after).sameBlock, false);
  assert.throws(() => compareTokenObservations(after, before), code("IDENTITY_COMPARISON_ORDER"));
});

for (const changes of [{ account: OTHER }, { siteOrigin: "http://localhost:4188" }]) {
  test("different identity is never compared: " + Object.keys(changes)[0], () => {
    assert.throws(() => compareTokenObservations(observation(), observation(changes)), code("IDENTITY_COMPARISON_CONTEXT"));
  });
}

test("different tokens and networks cannot be combined into an amount", () => {
  assert.throws(() => compareTokenObservations(observation(), observation({}, "EMA")), code("IDENTITY_COMPARISON_CONTEXT"));
  assert.throws(() => compareTokenObservations(observation(), observation({}, "DAT", 84532)), code("IDENTITY_COMPARISON_CONTEXT"));
});

test("connection epochs may differ for the same observed wallet", () => {
  const before = observation();
  const after = observation({ connectionEpoch: 99 });
  assert.equal(observationContextKey(before), observationContextKey(after));
  assert.equal(compareTokenObservations(before, after).sameBlock, true);
});

test("same height different hash is a conflict", () => {
  assert.throws(() => compareTokenObservations(observation(), observation({ blockHash: "0x" + "cd".repeat(32) })), code("IDENTITY_BLOCK_CONFLICT"));
});

for (const field of ["balanceBaseUnits", "nativeBalanceBaseUnits", "metadata", "hasCode"]) {
  test("same-block conflicting " + field + " is not a valid delta", () => {
    const after = observation();
    if (field === "metadata") after.metadata.totalSupply = "999999999999999999999999999";
    else if (field === "hasCode") Object.assign(after, { hasCode: false, metadata: null, balanceBaseUnits: null });
    else after[field] = "1";
    assert.throws(() => compareTokenObservations(observation(), after), code("IDENTITY_OBSERVATION_CONFLICT"));
  });
}

test("unknown balance in either observation makes comparison unavailable", () => {
  const before = observation({ hasCode: false, metadata: null, balanceBaseUnits: null });
  const after = observation({ blockNumber: "43" });
  const result = compareTokenObservations(before, after);
  assert.equal(result.comparable, false);
  assert.equal(result.deltaBaseUnits, null);
  assert.equal(result.direction, "unknown");
});

test("a metadata mismatch is not formatted using the expected decimals", () => {
  const after = observation({ blockNumber: "43" });
  after.metadata.decimals = 6;
  const result = compareTokenObservations(observation(), after);
  assert.equal(result.comparable, false);
  assert.equal(result.deltaAmount, null);
});

test("comparison leaves inputs unchanged", () => {
  const before = observation();
  const after = observation({ blockNumber: "43", balanceBaseUnits: "1" });
  const copies = clone([before, after]);
  compareTokenObservations(before, after);
  assert.deepEqual([before, after], copies);
});
