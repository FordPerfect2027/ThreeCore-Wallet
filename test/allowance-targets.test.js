import test from "node:test";
import assert from "node:assert/strict";
import { allowanceAddress, allowanceLabel, allowanceContext, allowanceArray,
  validateAllowanceTargets, parseAllowanceTargets, formatAllowanceTargets,
  allowanceTargetsKey, assertAllowanceContext, AllowanceError } from "../src/allowance-targets.js";
import { targets, S1, S2, clone, code } from "./helpers/allowance-fixtures.js";

test("allowance targets: immutable normalized plan and exact round trip", () => {
  const plan = parseAllowanceTargets(" \n" + S1 + " | Exchange A\r\n" + S2 + " | Exchange B\n", targets());
  assert.deepEqual(plan, targets());
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.targets));
  assert(Object.isFrozen(plan.targets[0]));
  assert.deepEqual(parseAllowanceTargets(formatAllowanceTargets(plan), plan), plan);
  assert.equal(allowanceTargetsKey(plan), allowanceTargetsKey(targets()));
});
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test("allowance targets: catalog scope " + agent + "/" + chainId, () => {
      const plan = targets(agent, chainId);
      assert.deepEqual(validateAllowanceTargets(plan), plan);
      assert.equal(allowanceContext({ agent, chainId }).tokenAddress, plan.tokenAddress);
      assert.deepEqual(assertAllowanceContext(plan, plan), plan);
      assert.equal(parseAllowanceTargets(S1, plan).targets[0].label, "");
    });
  }
}
for (const value of [null, "", "0x0", "0x" + "0".repeat(40), S1 + "0", " " + S1, 123, {}, "test.eth"]) {
  test("allowance targets: invalid address " + JSON.stringify(value), () => {
    assert.throws(() => allowanceAddress(value), code("ALLOWANCE_ADDRESS"));
  });
}
test("allowance targets: case normalized before duplicate detection", () => {
  const mixed = "0x" + "aB".repeat(20);
  assert.equal(allowanceAddress(mixed), mixed.toLowerCase());
  assert.throws(() => parseAllowanceTargets(mixed + "\n" + mixed.toLowerCase(), targets()), code("ALLOWANCE_DUPLICATE"));
});
for (const label of [" a", "a ", "a\nb", "\u202eabc", "a\u0000b", "\ud800", "x".repeat(65), "a|b", 2, null]) {
  test("allowance targets: invalid label " + JSON.stringify(label), () => {
    assert.throws(() => allowanceLabel(label), code("ALLOWANCE_LABEL"));
  });
}
for (const label of ["", "取引所", "<script>text only</script>", "a".repeat(64)]) {
  test("allowance targets: valid local label " + label, () => {
    assert.equal(allowanceLabel(label), label);
  });
}
for (const text of ["", " \n ", S1 + "|a|b", "x".repeat(8193), null, {}]) {
  test("allowance targets: malformed draft " + String(text).slice(0, 20), () => {
    assert.throws(() => parseAllowanceTargets(text, targets()), code("ALLOWANCE_DRAFT"));
  });
}
test("allowance targets: exact twenty target capacity", () => {
  const text = Array.from({ length: 20 }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0")).join("\n");
  assert.equal(parseAllowanceTargets(text, targets()).targets.length, 20);
  assert.throws(() => parseAllowanceTargets(text + "\n" + S1, targets()), code("ALLOWANCE_TARGETS"));
});
for (const value of [[], new Array(1), {}, [undefined]]) {
  test("allowance targets: invalid target collection " + JSON.stringify(value), () => {
    const plan = targets();
    plan.targets = value;
    assert.throws(() => validateAllowanceTargets(plan));
  });
}
test("allowance targets: reject array accessor before evaluating it", () => {
  let reads = 0;
  const list = [];
  Object.defineProperty(list, "0", { get() { reads++; return {}; }, enumerable: true });
  assert.throws(() => allowanceArray(list), code("ALLOWANCE_TARGETS"));
  assert.equal(reads, 0);
});
test("allowance targets: reject target object getter before evaluating it", () => {
  let reads = 0;
  const plan = targets();
  Object.defineProperty(plan.targets[0], "label", { get() { reads++; return "x"; } });
  assert.throws(() => validateAllowanceTargets(plan), code("ALLOWANCE_SHAPE"));
  assert.equal(reads, 0);
});
for (const change of [
  p => { p.secret = "not accepted"; },
  p => { p.targets.extra = true; },
  p => { p.targets[0].url = "https://example.com"; },
  p => { p.targets[0][Symbol("hidden")] = 1; },
  p => { Object.setPrototypeOf(p.targets[0], { hidden: true }); },
  p => { p.schema = "v2"; },
  p => { p.agent = "DOGE"; },
  p => { p.chainId = "8453"; },
  p => { p.tokenAddress = S1; },
]) {
  test("allowance targets: reject structural mutation " + change.toString(), () => {
    const plan = targets();
    change(plan);
    assert.throws(() => validateAllowanceTargets(plan));
  });
}
test("allowance targets: all scope changes invalidate a staged plan", () => {
  const plan = targets();
  assert.throws(() => assertAllowanceContext(plan, targets("EMA")), code("ALLOWANCE_CONTEXT_CHANGED"));
  assert.throws(() => assertAllowanceContext(plan, targets("DAT", 84532)), code("ALLOWANCE_CONTEXT_CHANGED"));
  assert.throws(() => assertAllowanceContext(plan, { ...plan, tokenAddress: S1 }), code("ALLOWANCE_TOKEN"));
});
test("allowance targets: copy independence and deterministic object order", () => {
  const source = targets();
  const original = clone(source);
  const valid = validateAllowanceTargets(source);
  source.targets[0].label = "changed later";
  assert.deepEqual(valid, original);
  const shuffled = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(allowanceTargetsKey(shuffled), allowanceTargetsKey(original));
});
test("allowance targets: optional empty collection is explicit", () => {
  assert.deepEqual(allowanceArray([], { allowEmpty: true }), []);
  assert.throws(() => allowanceArray([]), code("ALLOWANCE_TARGETS"));
  assert.equal(new AllowanceError("X").name, "AllowanceError");
});
