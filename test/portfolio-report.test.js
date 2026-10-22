import test from "node:test";
import assert from "node:assert/strict";
import { encodePortfolioReport, decodePortfolioReport, validatePortfolioSnapshot,
  formatBaseUnits } from "../src/portfolio-report.js";

const ADDRESS = "0x" + "ab".repeat(20);
const MAX = ((1n << 256n) - 1n).toString();
function snapshot() {
  return {
    agent: "DAT", account: ADDRESS, chainId: 8453, siteOrigin: "https://example.test",
    connectionEpoch: 1, blockNumber: "42", blockHash: "0x" + "cd".repeat(32),
    nativeBalanceBaseUnits: MAX,
    holdings: [{address: ADDRESS, hasCode: true, balanceBaseUnits: "17", notice: null}],
    readOnly: true, securityAudit: false,
  };
}

test("roundtrip preserves exact units and identifies an imported historical observation", () => {
  const input = snapshot();
  const text = encodePortfolioReport(input);
  const report = decodePortfolioReport(text);
  assert.deepEqual(report.snapshot, input);
  assert.equal(report.historicalObservation, true);
  assert.equal(report.canAuthorizeConnection, false);
  assert.equal(report.canAuthorizeTransaction, false);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.snapshot));
  assert.ok(Object.isFrozen(report.snapshot.holdings));
  assert.ok(Object.isFrozen(report.snapshot.holdings[0]));
  input.holdings[0].balanceBaseUnits = "999";
  assert.equal(report.snapshot.holdings[0].balanceBaseUnits, "17");
});

test("missing code remains unknown through export/import", () => {
  const input = snapshot();
  input.holdings[0] = {address: ADDRESS, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING"};
  assert.equal(decodePortfolioReport(encodePortfolioReport(input)).snapshot.holdings[0].balanceBaseUnits, null);
});

for (const field of Object.keys(snapshot())) {
  test("missing required field rejected: " + field, () => {
    const input = snapshot();
    delete input[field];
    assert.throws(() => validatePortfolioSnapshot(input), { code: "INVALID_PORTFOLIO_REPORT" });
  });
}

for (const field of ["privateKey", "seedPhrase", "password", "authorization", "__proto__"]) {
  test("unknown top-level field cannot be exported: " + field, () => {
    const input = snapshot();
    Object.defineProperty(input, field, { value: "unwanted", enumerable: true });
    assert.throws(() => encodePortfolioReport(input), { code: "INVALID_PORTFOLIO_REPORT" });
  });
}

for (const raw of ["-1", "01", "1.0", "1e3", " 1", "", "0x1", "9".repeat(79), (1n << 256n).toString(), 1, 1n, null]) {
  test("noncanonical native units rejected: " + String(raw), () => {
    const input = snapshot();
    input.nativeBalanceBaseUnits = raw;
    assert.throws(() => validatePortfolioSnapshot(input));
  });
  test("noncanonical token units rejected: " + String(raw), () => {
    const input = snapshot();
    input.holdings[0].balanceBaseUnits = raw;
    assert.throws(() => validatePortfolioSnapshot(input));
  });
}

for (const change of [
  {agent: "OTHER"}, {account: "bad"}, {chainId: 0}, {chainId: 1.5},
  {connectionEpoch: -1}, {siteOrigin: "http://example.test"},
  {siteOrigin: "https://example.test/path"}, {readOnly: false}, {securityAudit: true},
  {blockHash: "0x123"}, {blockNumber: "-1"}, {holdings: []},
]) {
  test("invalid snapshot field rejected: " + JSON.stringify(change), () => {
    assert.throws(() => validatePortfolioSnapshot({...snapshot(), ...change}));
  });
}

test("accessor is rejected without executing it", () => {
  const input = snapshot();
  let touched = false;
  Object.defineProperty(input, "account", { enumerable: true, get() { touched = true; throw Error("getter"); } });
  assert.throws(() => validatePortfolioSnapshot(input));
  assert.equal(touched, false);
});

test("holding accessor is rejected without executing it", () => {
  const input = snapshot();
  let touched = false;
  Object.defineProperty(input.holdings[0], "address", {enumerable: true, get() { touched = true; return ADDRESS; }});
  assert.throws(() => validatePortfolioSnapshot(input));
  assert.equal(touched, false);
});

test("duplicates and additional holding fields are rejected", () => {
  const input = snapshot();
  input.holdings.push({...input.holdings[0]});
  assert.throws(() => validatePortfolioSnapshot(input));
  input.holdings.pop();
  input.holdings[0].approval = "grant";
  assert.throws(() => validatePortfolioSnapshot(input));
});

for (const row of [
  {hasCode: false, balanceBaseUnits: "0", notice: "TOKEN_CODE_MISSING"},
  {hasCode: true, balanceBaseUnits: null, notice: null},
  {hasCode: false, balanceBaseUnits: null, notice: null},
  {hasCode: true, balanceBaseUnits: "1", notice: "TOKEN_CODE_MISSING"},
]) {
  test("inconsistent holding cannot become a verified balance: " + JSON.stringify(row), () => {
    const input = snapshot();
    input.holdings[0] = {address: ADDRESS, ...row};
    assert.throws(() => validatePortfolioSnapshot(input));
  });
}

for (const text of ["", "null", "[]", "{", "{}", "x".repeat(65537)]) {
  test("malformed or oversized report rejected: " + text.slice(0, 20), () => {
    assert.throws(() => decodePortfolioReport(text), {code: "INVALID_PORTFOLIO_REPORT"});
  });
}

test("unknown schema and altered observation status cannot be imported", () => {
  const report = JSON.parse(encodePortfolioReport(snapshot()));
  report.schema = "future-schema";
  assert.throws(() => decodePortfolioReport(JSON.stringify(report)));
  report.schema = "threecore-portfolio-snapshot-v1";
  report.historicalObservation = false;
  assert.throws(() => decodePortfolioReport(JSON.stringify(report)));
});

for (const [raw, decimals, expected] of [
  ["0", 18, "0"], ["1", 18, "0.000000000000000001"],
  ["1000000", 6, "1"], ["1234567", 6, "1.234567"],
  ["1000000000000000001", 18, "1.000000000000000001"],
  [MAX, 0, MAX], ["10", 1, "1"], ["100", 255, "0." + "0".repeat(252) + "1"],
]) {
  test("exact decimal formatting: " + raw + "/" + decimals, () => {
    assert.equal(formatBaseUnits(raw, decimals), expected);
  });
}

for (const decimals of [-1, 256, 1.5, "18", NaN]) {
  test("invalid explicitly supplied decimals rejected: " + decimals, () => {
    assert.throws(() => formatBaseUnits("1", decimals));
  });
}
