import test from "node:test";
import assert from "node:assert/strict";
import { validateAllowanceRow, validateAllowanceObservation, summarizeAllowances,
  compareAllowances, filterAllowances } from "../src/allowance-observation.js";
import { UINT256_MAX } from "../src/token-identity-codec.js";
import { record, targets, S1, S2, S3, ACCOUNT, OTHER, clone, code, nextRecord } from "./helpers/allowance-fixtures.js";

test("allowance observation: valid deeply frozen observation independent of caller", () => {
  const input = record();
  const expected = clone(input);
  const result = validateAllowanceObservation(input);
  input.rows[0].allowanceBaseUnits = "999";
  input.targets.targets[0].label = "changed";
  assert.deepEqual(result, expected);
  for (const item of [result, result.identity, result.rows, result.rows[0], result.targets]) assert(Object.isFrozen(item));
});
for (const field of ["readOnly", "completeDiscovery", "securityAudit"]) {
  test("allowance observation: fixed scope flag " + field, () => {
    const input = record();
    input[field] = !input[field];
    assert.throws(() => validateAllowanceObservation(input), code("ALLOWANCE_SCHEMA"));
  });
}
for (const change of [
  r => { r.rows.pop(); },
  r => { r.rows.reverse(); },
  r => { r.rows[0].label = "different"; },
  r => { r.rows[0].spenderAddress = S3; },
  r => { r.targets = targets("EMA"); },
  r => { r.rows.extra = "extra"; },
  r => { r.rows[0].extra = "extra"; },
  r => { r.schema = "old"; },
  r => { r.provesSafe = true; },
]) {
  test("allowance observation: reject mismatched record " + change.toString(), () => {
    const input = record();
    change(input);
    assert.throws(() => validateAllowanceObservation(input));
  });
}
for (const raw of ["-1", "+1", "01", "1.0", "1e18", "", 0, 1n, UINT256_MAX + 1n, "9".repeat(79)]) {
  test("allowance observation: invalid uint256 " + String(raw), () => {
    const input = record();
    input.rows[0].allowanceBaseUnits = raw;
    assert.throws(() => validateAllowanceObservation(input), code("ALLOWANCE_AMOUNT"));
  });
}
for (const raw of ["0", "1", "900719925474099312345", UINT256_MAX.toString()]) {
  test("allowance observation: exact uint256 " + raw, () => {
    const input = record();
    input.rows[0].allowanceBaseUnits = raw;
    assert.equal(validateAllowanceObservation(input).rows[0].allowanceBaseUnits, raw);
  });
}
for (const change of [
  r => { r.hasCode = "true"; },
  r => { r.hasCode = null; },
  r => { r.codeError = "READ_FAILED"; },
  r => { r.allowanceBaseUnits = null; },
  r => { r.allowanceError = "READ_FAILED"; },
  r => { r.allowanceError = "anything"; },
  r => { r.codeError = "TOKEN_UNAVAILABLE"; r.hasCode = null; },
  r => { r.allowanceError = "TOKEN_UNAVAILABLE"; r.allowanceBaseUnits = null; },
]) {
  test("allowance observation: incompatible row values " + change.toString(), () => {
    const row = record().rows[0];
    change(row);
    assert.throws(() => validateAllowanceRow(row, true), code("ALLOWANCE_ROW"));
  });
}
for (const codeError of ["READ_FAILED", "INVALID_RESPONSE"]) {
  for (const allowanceError of ["READ_FAILED", "INVALID_RESPONSE"]) {
    test("allowance observation: independent unknown fields " + codeError + "/" + allowanceError, () => {
      const input = record();
      Object.assign(input.rows[0], { hasCode: null, codeError, allowanceBaseUnits: null, allowanceError });
      const s = summarizeAllowances(input);
      assert.equal(s.rows[0].status, "unknown");
      assert.equal(s.unknownAmounts, 1);
      assert.equal(s.codeUnavailable, 1);
      assert.equal(s.rows[0].amount, null);
      assert.equal(s.rows[0].smallerAmount, null);
      assert.equal(s.rows[0].exceedsObservedBalance, null);
    });
  }
}
test("allowance observation: missing token code means unavailable, never zero", () => {
  const input = record();
  Object.assign(input.identity, { hasCode: false, metadata: null, balanceBaseUnits: null });
  for (const row of input.rows) Object.assign(row, { allowanceBaseUnits: null, allowanceError: "TOKEN_UNAVAILABLE" });
  const s = summarizeAllowances(input);
  assert.equal(s.zeroAmounts, 0);
  assert.equal(s.unknownAmounts, 2);
  assert.equal(s.rows[0].smallerOfBalanceAndAllowance, null);
  input.rows[0].allowanceError = "READ_FAILED";
  assert.throws(() => validateAllowanceObservation(input), code("ALLOWANCE_ROW"));
});
test("allowance observation: maximum amount distinguished without Number rounding or exposure sum", () => {
  const input = record();
  input.rows[0].allowanceBaseUnits = UINT256_MAX.toString();
  const s = summarizeAllowances(input);
  assert.equal(s.maximumAmounts, 1);
  assert.equal(s.positiveAmounts, 2);
  assert.equal(s.rows[0].status, "maximum");
  assert.equal(s.rows[0].smallerOfBalanceAndAllowance, input.identity.balanceBaseUnits);
  assert.equal(s.rows[0].exceedsObservedBalance, true);
  assert.equal(s.totalExposure, null);
  assert.equal(s.provesCurrentPermission, false);
  assert.equal(s.securityAudit, false);
});
test("allowance observation: code absence is independent from known nonzero amount", () => {
  const input = record();
  input.rows[1].hasCode = false;
  const s = summarizeAllowances(input);
  assert.equal(s.codeAbsent, 1);
  assert.equal(s.positiveAmounts, 1);
  assert.equal(s.completeRows, 2);
  assert.equal(s.rows[1].contractSafetyVerified, false);
});
test("allowance observation: mismatched token decimals withhold formatted amounts", () => {
  const input = record();
  input.identity.metadata.decimals = 6;
  const s = summarizeAllowances(input);
  assert.equal(s.rows[1].allowanceBaseUnits, "10");
  assert.equal(s.rows[1].amount, null);
  assert.equal(s.rows[1].smallerAmount, null);
});
test("allowance observation: wallet and token self-target labels are explicit", () => {
  const input = record();
  input.targets.targets[0].address = ACCOUNT;
  input.targets.targets[1].address = input.identity.tokenAddress;
  input.rows[0].spenderAddress = ACCOUNT;
  input.rows[1].spenderAddress = input.identity.tokenAddress;
  const s = summarizeAllowances(input);
  assert.equal(s.rows[0].selfSpender, true);
  assert.equal(s.rows[1].tokenIsSpender, true);
});
test("allowance comparison: exact signed deltas across blocks", () => {
  const before = record();
  const after = nextRecord(before);
  after.rows[0].allowanceBaseUnits = "900719925474099312345";
  after.rows[1].allowanceBaseUnits = "0";
  const result = compareAllowances(before, after);
  assert.equal(result.rows[0].deltaBaseUnits, "900719925474099312345");
  assert.equal(result.rows[0].deltaAmount, "+900.719925474099312345");
  assert.equal(result.rows[1].deltaBaseUnits, "-10");
  assert.equal(result.rows[1].status, "decreased");
  assert.equal(result.provesRevocation, false);
  assert.equal(result.provesApprovalTransactions, false);
});
for (const field of ["account", "agent", "chainId", "siteOrigin", "tokenAddress"]) {
  test("allowance comparison: rejects different identity " + field, () => {
    const before = record();
    const after = nextRecord(before);
    if (field === "account") after.identity.account = OTHER;
    if (field === "siteOrigin") after.identity.siteOrigin = "http://127.0.0.1:9999";
    if (field === "tokenAddress") after.identity.tokenAddress = S3;
    if (field === "agent") Object.assign(after, record({}, "EMA"));
    if (field === "chainId") Object.assign(after, record({}, "DAT", 84532));
    assert.throws(() => compareAllowances(before, after));
  });
}
test("allowance comparison: backwards observation rejected", () => {
  const before = record();
  const after = nextRecord(before);
  assert.throws(() => compareAllowances(after, before), code("ALLOWANCE_COMPARE_ORDER"));
});
test("allowance comparison: same-height different hash rejected", () => {
  const before = record();
  const after = clone(before);
  after.identity.blockHash = "0x" + "cd".repeat(32);
  assert.throws(() => compareAllowances(before, after), code("ALLOWANCE_BLOCK_CONFLICT"));
});
for (const change of [
  r => { r.rows[0].allowanceBaseUnits = "1"; },
  r => { r.rows[0].hasCode = false; },
  r => { r.identity.balanceBaseUnits = "0"; },
  r => { r.identity.nativeBalanceBaseUnits = "0"; },
  r => { r.identity.metadata.name = "Other"; },
]) {
  test("allowance comparison: same-block contradictory value " + change.toString(), () => {
    const before = record();
    const after = clone(before);
    change(after);
    assert.throws(() => compareAllowances(before, after), code("ALLOWANCE_SAME_BLOCK_CONFLICT"));
  });
}
test("allowance comparison: adding/removing observed targets never proves permission changes", () => {
  const before = record();
  const after = nextRecord(before);
  after.targets.targets[1].address = S3;
  after.rows[1].spenderAddress = S3;
  const result = compareAllowances(before, after);
  assert.deepEqual(result.rows.map(r => r.status), ["unchanged", "omitted-target", "new-target"]);
  assert.equal(result.rows[1].deltaBaseUnits, null);
  assert.equal(result.rows[2].deltaBaseUnits, null);
});
test("allowance comparison: labels and target order do not affect arithmetic", () => {
  const before = record();
  const after = nextRecord(before);
  after.targets.targets.reverse();
  after.rows.reverse();
  after.targets.targets[0].label = after.rows[0].label = "Renamed";
  const result = compareAllowances(before, after);
  assert.equal(result.rows[0].status, "unchanged");
  assert.equal(result.rows[1].labelChanged, true);
});
test("allowance comparison: unknown before amount cannot become claimed increase", () => {
  const before = record();
  Object.assign(before.rows[0], { allowanceBaseUnits: null, allowanceError: "READ_FAILED" });
  const after = nextRecord(record());
  const result = compareAllowances(before, after);
  assert.equal(result.rows[0].status, "unknown");
  assert.equal(result.rows[0].deltaBaseUnits, null);
});
test("allowance comparison: mismatched metadata withholds human-unit delta", () => {
  const before = record();
  const after = nextRecord(before);
  after.identity.metadata.symbol = "OTHER";
  after.rows[1].allowanceBaseUnits = "11";
  const result = compareAllowances(before, after);
  assert.equal(result.rows[1].deltaBaseUnits, "1");
  assert.equal(result.rows[1].deltaAmount, null);
});
test("allowance filters: status/search intersection preserves the source", () => {
  const input = record();
  const before = clone(input);
  assert.equal(filterAllowances(input).length, 2);
  assert.equal(filterAllowances(input, { status: "nonzero" }).length, 1);
  assert.equal(filterAllowances(input, { status: "zero" })[0].spenderAddress, S1);
  assert.equal(filterAllowances(input, { search: "exchange b" })[0].spenderAddress, S2);
  assert.equal(filterAllowances(input, { status: "zero", search: S2 }).length, 0);
  assert(Object.isFrozen(filterAllowances(input)));
  assert.deepEqual(input, before);
});
for (const options of [{ status: "safe" }, { search: null }, { search: "x".repeat(129) }]) {
  test("allowance filters: reject unsupported filter " + JSON.stringify(options), () => {
    assert.throws(() => filterAllowances(record(), options), code("ALLOWANCE_FILTER"));
  });
}
