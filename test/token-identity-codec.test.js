import test from "node:test";
import assert from "node:assert/strict";
import { decodeMetadataWord, decodeMetadataString, decodeMetadataField,
  identityUnits, identityAddress, metadataText, metadataDecimals,
  validateTokenMetadata, identityObject, formatTokenUnits, parseTokenUnits,
  UINT256_MAX } from "../src/token-identity-codec.js";
import { abiText, word, code, observation, ACCOUNT } from "./helpers/identity-fixtures.js";

test("ABI metadata fields have exact types", () => {
  assert.equal(decodeMetadataField("name", abiText("DATCORE")), "DATCORE");
  assert.equal(decodeMetadataField("symbol", abiText("DAT")), "DAT");
  assert.equal(decodeMetadataField("decimals", word(18)), 18);
  assert.equal(decodeMetadataField("totalSupply", word(UINT256_MAX)), UINT256_MAX.toString());
  assert.throws(() => decodeMetadataField("approve", word(1)), code("IDENTITY_FIELD"));
});

for (const text of ["DATCORE", "EMA CORE", "CAWELON CORE", "トークン", "x".repeat(32), "x".repeat(33), "x".repeat(128)]) {
  test("strict UTF-8 ABI string round trip: " + text.slice(0, 20), () => {
    assert.equal(decodeMetadataString(abiText(text)), text);
  });
}

test("multibyte size is checked in bytes, not JavaScript characters", () => {
  assert.equal(decodeMetadataString(abiText("あ".repeat(42))), "あ".repeat(42));
  assert.throws(() => decodeMetadataString(abiText("あ".repeat(43))), code("IDENTITY_ABI_STRING"));
});

const invalidStrings = [
  ["empty", "0x"],
  ["bytes32 not guessed", word(42)],
  ["offset missing", word(0) + abiText("DAT").slice(66)],
  ["offset 64", word(64) + abiText("DAT").slice(66)],
  ["length zero", word(32) + word(0).slice(2)],
  ["length huge", word(32) + word(UINT256_MAX).slice(2)],
  ["length 129", abiText("x".repeat(129))],
  ["truncated", abiText("DAT").slice(0, -2)],
  ["trailing word", abiText("DAT") + "0".repeat(64)],
  ["nonzero padding", abiText("DAT").slice(0, -2) + "01"],
  ["odd hex", abiText("DAT") + "0"],
  ["not hex", abiText("DAT").slice(0, -2) + "zz"],
  ["invalid UTF8", word(32) + word(1).slice(2) + "ff".padEnd(64, "0")],
  ["overlong UTF8", word(32) + word(2).slice(2) + "c080".padEnd(64, "0")],
  ["number instead of hex", 42],
];
for (const [name, value] of invalidStrings) {
  test("reject malformed metadata string: " + name, () => {
    assert.throws(() => decodeMetadataString(value), code("IDENTITY_ABI_STRING"));
  });
}

for (const value of ["", " ", " DAT", "DAT ", "DA\nT", "DA\0T", "x\u202eabc", "x\u2066abc", "x\u007f", "x\ud800", "x".repeat(129), null, 18]) {
  test("unsafe or oversized display metadata rejected: " + JSON.stringify(value), () => {
    assert.throws(() => metadataText(value), code("IDENTITY_METADATA_TEXT"));
  });
}

for (const value of ["0x", "0x1", "0x" + "0".repeat(63), "0x" + "0".repeat(65), "0x" + "g".repeat(64), 0, null, "0X" + "0".repeat(64)]) {
  test("uint256 word requires exact ABI bytes: " + String(value).slice(0, 15), () => {
    assert.throws(() => decodeMetadataWord(value), code("IDENTITY_ABI_WORD"));
  });
}

test("uint256 word includes both endpoints", () => {
  assert.equal(decodeMetadataWord(word(0)), 0n);
  assert.equal(decodeMetadataWord(word(UINT256_MAX)), UINT256_MAX);
});

for (const value of ["-1", "+1", "01", "1.0", "1e3", " 1", "1 ", "", "0x10", (UINT256_MAX + 1n).toString(), 1, 1n, null]) {
  test("base units reject coercion or overflow: " + String(value), () => {
    assert.throws(() => identityUnits(value), code("IDENTITY_AMOUNT"));
  });
}

test("address normalization preserves the whole address and rejects zero", () => {
  const upper = "0x" + "AB".repeat(20);
  assert.equal(identityAddress(upper), upper.toLowerCase());
  assert.equal(identityAddress(ACCOUNT), ACCOUNT);
  assert.throws(() => identityAddress("0x" + "00".repeat(20)), code("IDENTITY_ADDRESS"));
  assert.throws(() => identityAddress(ACCOUNT.slice(0, -1)), code("IDENTITY_ADDRESS"));
});

for (const value of [-1, 256, 1.2, "18", NaN, Infinity, null]) {
  test("decimals enforce uint8 range: " + String(value), () => {
    assert.throws(() => metadataDecimals(value), code("IDENTITY_DECIMALS"));
  });
}

test("large ABI decimals never truncate to a number", () => {
  assert.throws(() => decodeMetadataField("decimals", word(256)), code("IDENTITY_DECIMALS"));
  assert.throws(() => decodeMetadataField("decimals", word(UINT256_MAX)), code("IDENTITY_DECIMALS"));
});

test("metadata validation returns a detached immutable copy", () => {
  const metadata = observation().metadata;
  const result = validateTokenMetadata(metadata);
  metadata.name = "changed";
  assert.equal(result.name, "DATCORE");
  assert.equal(Object.isFrozen(result), true);
});

test("metadata accessors never run", () => {
  let calls = 0;
  const metadata = observation().metadata;
  Object.defineProperty(metadata, "name", { get() { calls++; return "DATCORE"; }, enumerable: true });
  assert.throws(() => validateTokenMetadata(metadata), code("IDENTITY_SHAPE"));
  assert.equal(calls, 0);
});

test("schema refuses symbols, unknown fields, prototypes and missing keys", () => {
  const extra = { ...observation().metadata, approved: true };
  assert.throws(() => validateTokenMetadata(extra), code("IDENTITY_SHAPE"));
  const symbol = { ...observation().metadata, [Symbol("secret")]: 1 };
  assert.throws(() => validateTokenMetadata(symbol), code("IDENTITY_SHAPE"));
  const inherited = Object.create(observation().metadata);
  assert.throws(() => validateTokenMetadata(inherited), code("IDENTITY_SHAPE"));
  assert.throws(() => identityObject([], []), code("IDENTITY_SHAPE"));
});

const amounts = [
  ["0", 18, "0"],
  ["1", 18, "0.000000000000000001"],
  ["1000000000000000000", 18, "1"],
  ["1234567890123456789", 18, "1.234567890123456789"],
  ["9007199254740993123", 18, "9.007199254740993123"],
  ["1234500", 6, "1.2345"],
  ["12345", 0, "12345"],
  ["100", 2, "1"],
  ["101", 2, "1.01"],
  ["1", 255, "0." + "0".repeat(254) + "1"],
];
for (const [raw, decimals, expected] of amounts) {
  test("exact decimal placement: " + raw + " / " + decimals, () => {
    assert.equal(formatTokenUnits(raw, decimals), expected);
    assert.equal(parseTokenUnits(expected, decimals), raw);
  });
}

test("uint256 maximum survives every supported decimal position", () => {
  for (let decimals = 0; decimals <= 255; decimals++) {
    const raw = UINT256_MAX.toString();
    const formatted = formatTokenUnits(raw, decimals);
    assert.equal(parseTokenUnits(formatted, decimals), raw);
    assert.equal(/[eE]/.test(formatted), false);
  }
});

for (const value of ["01", "1e18", "1E18", "-1", "+1", "1,000", ".5", "1.", " 1", "1 ", "NaN", "Infinity", "", 1, null]) {
  test("human amount input is strict: " + String(value), () => {
    assert.throws(() => parseTokenUnits(value, 18), code("IDENTITY_DECIMAL_TEXT"));
  });
}

test("fractional precision is rejected instead of rounded", () => {
  assert.throws(() => parseTokenUnits("1.0000001", 6), code("IDENTITY_PRECISION"));
  assert.throws(() => parseTokenUnits("1.0", 0), code("IDENTITY_PRECISION"));
  assert.equal(parseTokenUnits("0.000000", 6), "0");
  assert.throws(() => parseTokenUnits((UINT256_MAX + 1n).toString(), 0), code("IDENTITY_AMOUNT"));
});
