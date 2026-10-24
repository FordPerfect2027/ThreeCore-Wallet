import test from "node:test";
import assert from "node:assert/strict";
import { validateWalletSetup, encodeWalletSetup, decodeWalletSetup, setupFromFields,
  inspectWalletFields, captureWalletFields, previewWalletSetup, describeWalletSetupReview,
  WALLET_SETUP_LIMIT } from "../src/wallet-setup.js";
import { A, B, C, setup, raw, clone } from "./helpers/setup-fixtures.js";

test("configuration round trip retains three distinct addresses and networks", () => {
  const input = setup([A, B, C], [8453, 84532, 8453]);
  assert.deepEqual(decodeWalletSetup(encodeWalletSetup(input)), input);
  assert.equal(JSON.stringify(input).includes("balance"), false);
});

test("incomplete setup can be saved without inventing wallets", () => {
  const input = setup([A, null, null]);
  assert.deepEqual(decodeWalletSetup(encodeWalletSetup(input)), input);
  const state = inspectWalletFields(raw([A, "", ""]));
  assert.equal(state.configured, 1);
  assert.equal(state.readyForManualConnection, false);
  assert.equal(state.ownershipVerified, false);
});

test("all missing entries remain valid partial configuration", () => {
  const result = setupFromFields(raw());
  assert.deepEqual(result.entries.map(row => row.account), [null, null, null]);
  assert.equal(inspectWalletFields(raw()).configured, 0);
});

test("case normalization is deterministic and does not mutate source", () => {
  const input = setup(["0x" + "AB".repeat(20), B, C]);
  const before = clone(input);
  const result = validateWalletSetup(input);
  assert.equal(result.entries[0].account, A);
  assert.deepEqual(input, before);
});

test("entry order is normalized to DAT EMA CAWELON", () => {
  const input = setup();
  input.entries.reverse();
  assert.deepEqual(validateWalletSetup(input), setup());
});

test("validated configuration is deeply frozen and detached", () => {
  const input = setup();
  const result = validateWalletSetup(input);
  input.entries[0].account = B;
  assert.equal(result.entries[0].account, A);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.entries));
  assert(Object.isFrozen(result.entries[0]));
  assert.throws(() => { result.entries[0].account = B; }, TypeError);
});

for (const [name, mutate, code] of [
  ["same address", p => { p.entries[1].account = A; }, "SETUP_DUPLICATE"],
  ["same address different chain", p => { p.entries[1].account = A; p.entries[1].chainId = 8453; }, "SETUP_DUPLICATE"],
  ["same address upper case", p => { p.entries[1].account = "0x" + "AB".repeat(20); }, "SETUP_DUPLICATE"],
  ["wrong chain", p => { p.entries[0].chainId = 1; }, "SETUP_CHAIN"],
  ["string chain", p => { p.entries[0].chainId = "84532"; }, "SETUP_CHAIN"],
  ["unknown schema", p => { p.schema += "-other"; }, "SETUP_SCHEMA"],
  ["unknown agent", p => { p.entries[0].agent = "DOT"; }, "SETUP_AGENT"],
  ["repeated agent", p => { p.entries[1].agent = "DAT"; }, "SETUP_AGENT"],
  ["missing row", p => { p.entries.pop(); }, "SETUP_ROWS"],
  ["extra row", p => { p.entries.push(clone(p.entries[0])); }, "SETUP_ROWS"],
  ["sparse rows", p => { delete p.entries[0]; }, "SETUP_ROWS"],
  ["extra array property", p => { p.entries.metadata = true; }, "SETUP_ROWS"],
  ["extra secret field", p => { p.privateKey = "not-a-real-key"; }, "SETUP_SHAPE"],
  ["provider injection", p => { p.entries[0].provider = {}; }, "SETUP_SHAPE"],
  ["authorization injection", p => { p.entries[0].connected = true; }, "SETUP_SHAPE"],
  ["missing account", p => { delete p.entries[0].account; }, "SETUP_SHAPE"],
]) {
  test("rejects " + name + " before serialization", () => {
    const input = setup();
    mutate(input);
    assert.throws(() => validateWalletSetup(input), { code });
    assert.throws(() => encodeWalletSetup(input), { code });
  });
}

for (const account of ["", "0x1234", "0x" + "00".repeat(20), "0x" + "gg".repeat(20),
  A + " ", " " + A, 1, {}, [A], undefined, "<script>bad()</script>", "0X" + "ab".repeat(20)]) {
  test("rejects invalid configured address " + String(account), () => {
    assert.throws(() => validateWalletSetup(setup([account, B, C])), { code: "SETUP_ADDRESS" });
  });
}

test("getter input is rejected without executing it", () => {
  const input = setup();
  let reads = 0;
  Object.defineProperty(input.entries[0], "account", { get() { reads++; return A; } });
  assert.throws(() => validateWalletSetup(input), { code: "SETUP_SHAPE" });
  assert.equal(reads, 0);
});

test("accessor array entries are rejected without executing them", () => {
  const input = setup();
  let reads = 0;
  Object.defineProperty(input.entries, "0", { get() { reads++; return setup().entries[0]; } });
  assert.throws(() => validateWalletSetup(input), { code: "SETUP_ROWS" });
  assert.equal(reads, 0);
});

test("symbols and inherited fields cannot carry hidden data", () => {
  const symbols = setup();
  symbols[Symbol("secret")] = "hidden";
  assert.throws(() => validateWalletSetup(symbols), { code: "SETUP_SHAPE" });
  const inherited = Object.create(setup());
  assert.throws(() => validateWalletSetup(inherited), { code: "SETUP_SHAPE" });
});

test("null-prototype data is supported without inheriting behavior", () => {
  const input = Object.assign(Object.create(null), setup());
  input.entries = input.entries.map(row => Object.assign(Object.create(null), row));
  assert.deepEqual(validateWalletSetup(input), setup());
});

test("hostile proxy errors become bounded setup errors", () => {
  const proxy = new Proxy({}, { getPrototypeOf() { throw Error("private payload"); } });
  assert.throws(() => validateWalletSetup(proxy), error => error.code === "SETUP_SHAPE" && !error.message.includes("private"));
});

for (const text of ["", " ", "null", "[]", "{", "not json", " ".repeat(WALLET_SETUP_LIMIT + 1)]) {
  test("rejects unusable JSON input " + text.slice(0, 15), () => {
    assert.throws(() => decodeWalletSetup(text));
  });
}

test("UTF-8 BOM is accepted only at the start of JSON", () => {
  const text = encodeWalletSetup(setup());
  assert.deepEqual(decodeWalletSetup("\ufeff" + text), setup());
  assert.throws(() => decodeWalletSetup("\ufeff\ufeff" + text), { code: "SETUP_JSON" });
});

test("prototype pollution properties are rejected", () => {
  const text = encodeWalletSetup(setup()).replace('"schema":', '"__proto__":{"polluted":true},"schema":');
  // Reject the unsafe member during the new JSON preflight, before schema validation.
  assert.throws(() => decodeWalletSetup(text), { code: "SETUP_JSON" });
  assert.equal({}.polluted, undefined);
});

test("field export trims form whitespace but never trims schema addresses silently", () => {
  const value = setupFromFields(raw(["  " + A + "  ", "\n", C]));
  assert.deepEqual(value, setup([A, null, C]));
  assert.throws(() => validateWalletSetup(setup([" " + A, null, C])), { code: "SETUP_ADDRESS" });
});

test("raw capture preserves incomplete input for comparison", () => {
  const fields = raw(["0x1", "bad", " "]);
  assert.deepEqual(captureWalletFields(fields), fields);
  assert.throws(() => setupFromFields(fields), { code: "SETUP_ADDRESS" });
});

test("readiness identifies both ends of a duplicate", () => {
  const value = inspectWalletFields(raw([A, "0x" + "AB".repeat(20), C]));
  assert.deepEqual(value.entries.map(row => row.status), ["duplicate", "duplicate", "configured"]);
  assert.equal(value.configured, 1);
  assert.equal(value.readyForManualConnection, false);
});

test("readiness distinguishes missing and malformed accounts", () => {
  const value = inspectWalletFields(raw(["", "0x1", C]));
  assert.deepEqual(value.entries.map(row => row.status), ["missing", "invalid", "configured"]);
  assert.equal(value.entries[1].account, null);
});

test("three valid distinct settings never imply ownership", () => {
  const value = inspectWalletFields(raw([A, B, C]));
  assert.equal(value.configured, 3);
  assert.equal(value.readyForManualConnection, true);
  assert.equal(value.ownershipVerified, false);
  assert.equal("connected" in value, false);
});

test("preview describes address and network changes independently", () => {
  const value = previewWalletSetup(encodeWalletSetup(setup([A, B, null], [8453, 84532, 84532])), raw([A, "", C]));
  assert.deepEqual(value.changedAgents, ["DAT", "EMA", "CAWELON"]);
  assert.equal(value.changes[0].chainChanged, true);
  assert.equal(value.changes[0].accountChanged, false);
  assert.equal(value.changes[1].accountChanged, true);
  assert.equal(value.changes[2].after.account, null);
  assert.equal(value.configured, 2);
  assert.equal(value.authorizesConnection, false);
  assert.equal(value.authorizesTransaction, false);
});

test("preview can repair currently invalid and duplicate form values", () => {
  const value = previewWalletSetup(encodeWalletSetup(setup()), raw(["bad", B, B]));
  assert.deepEqual(value.changedAgents, ["DAT", "CAWELON"]);
  assert.equal(value.changes[0].before.account, "bad");
});

test("equivalent case and whitespace do not disconnect a working card", () => {
  const value = previewWalletSetup(encodeWalletSetup(setup()), raw([" 0x" + "AB".repeat(20) + " ", B, C]));
  assert.deepEqual(value.changedAgents, []);
});

test("review text identifies mainnet and token input clearing", () => {
  const value = previewWalletSetup(encodeWalletSetup(setup([A, B, C], [8453, 84532, 84532])), raw());
  const text = describeWalletSetupReview(value);
  assert.match(text, /Base Mainnet（本番・読み取り専用）/);
  assert.match(text, /トークン入力を消去/);
  assert.match(text, /保存履歴は保持/);
  assert.match(text, /接続許可はファイルに保存しません/);
});

test("review text makes removing an account explicit", () => {
  const value = previewWalletSetup(encodeWalletSetup(setup([null, B, C])), raw([A, B, C]));
  const text = describeWalletSetupReview(value);
  assert.match(text, /変更対象: DAT/);
  assert(text.includes("変更前: " + A));
  assert.match(text, /変更後: 未設定/);
});

test("every entry may independently select either supported chain", () => {
  for (const a of [8453, 84532]) for (const b of [8453, 84532]) for (const c of [8453, 84532]) {
    const input = setup([A, B, C], [a, b, c]);
    assert.deepEqual(decodeWalletSetup(encodeWalletSetup(input)), input);
  }
});

test("capture refuses oversized raw inputs and scalar coercion", () => {
  assert.throws(() => captureWalletFields(raw(["x".repeat(257), B, C])), { code: "SETUP_ADDRESS" });
  assert.throws(() => captureWalletFields(raw([null, B, C])), { code: "SETUP_ADDRESS" });
  assert.throws(() => captureWalletFields(raw([{}, B, C])), { code: "SETUP_ADDRESS" });
});
