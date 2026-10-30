import test from "node:test";
import assert from "node:assert/strict";
import { allowanceContext, allowanceArray, validateAllowanceTargets } from "../src/allowance-targets.js";
import { validateAllowanceRow, validateAllowanceObservation } from "../src/allowance-observation.js";
import { captureAllowanceBundle, validateAllowanceBundle } from "../src/allowance-bundle.js";
import { allowanceOverview } from "../src/allowance-overview.js";
import { targets, record } from "./helpers/allowance-fixtures.js";
const ownOnly = value => new Proxy(value, { get() { throw Error("Unexpected live allowance read"); } });

test("allowance context projects own values even when the source has other fields", () => {
  assert.deepEqual(allowanceContext(ownOnly(targets())), allowanceContext(targets()));
});
test("allowance context rejects required accessors without invoking them", () => {
  let calls = 0;
  const input = { ...targets(), get agent() { calls++; return "DAT"; } };
  assert.throws(() => allowanceContext(input), { code: "ALLOWANCE_CONTEXT" });
  assert.equal(calls, 0);
});
test("allowance target arrays return detached immutable entries", () => {
  const input = [1], result = allowanceArray(input);
  input[0] = 2; assert.deepEqual(result, [1]); assert(Object.isFrozen(result));
});
test("allowance targets capture each address and label without live map or reads", () => {
  const input = targets();
  assert.deepEqual(validateAllowanceTargets(ownOnly({ ...input, targets: ownOnly(input.targets.map(ownOnly)) })), input);
});
test("allowance result rows retain the exact validated flags and amounts", () => {
  const input = record().rows[0];
  assert.deepEqual(validateAllowanceRow(ownOnly(input), true), input);
});
test("allowance observation captures its root and target-aligned result array", () => {
  const input = record();
  assert.deepEqual(validateAllowanceObservation(ownOnly({ ...input, rows: ownOnly(input.rows.map(ownOnly)) })), input);
});
test("allowance flags cannot change type after their validation", () => {
  const input = record().rows[0]; let reads = 0;
  const changing = new Proxy(input, { get(target, key, receiver) {
    return key === "hasCode" ? ++reads <= 3 ? true : "not-a-boolean" : Reflect.get(target, key, receiver);
  } });
  assert.equal(validateAllowanceRow(changing, true).hasCode, true); assert.equal(reads, 0);
});
test("allowance bundle captures the three observations without live iteration", () => {
  const input = captureAllowanceBundle(["DAT", "EMA", "CAWELON"].map(agent => record({}, agent)));
  assert.deepEqual(validateAllowanceBundle(ownOnly({ ...input, records: ownOnly([...input.records]) })), input);
});
test("allowance overview captures its three cards without live map or field reads", () => {
  const rows = ["DAT", "EMA", "CAWELON"].map(agent => ({ agent, observation: record({}, agent), provenance: "read" }));
  assert.deepEqual(allowanceOverview(ownOnly(rows.map(ownOnly))), allowanceOverview(rows));
});
test("an overview array cannot hide a checked card with changing length", () => {
  const rows = ["DAT", "EMA", "CAWELON"].map(agent => ({ agent, observation: record({}, agent), provenance: "read" }));
  let reads = 0;
  const changing = new Proxy(rows, { get(target, key, receiver) {
    return key === "length" ? ++reads <= 1 ? 3 : 0 : Reflect.get(target, key, receiver);
  } });
  assert.equal(allowanceOverview(changing).cards.length, 3); assert.equal(reads, 0);
});
