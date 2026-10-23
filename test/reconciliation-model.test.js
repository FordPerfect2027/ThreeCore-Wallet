import test from "node:test";
import assert from "node:assert/strict";
import {
  RECONCILIATION_SCHEMA, RECONCILIATION_AGENTS, RECONCILIATION_PARTS,
  emptyReconciliationWorkspace, validateReconciliationWorkspace, reconciliationKey,
  replaceReconciliationPart, clearReconciliationSlot, describeReconciliationPart,
  reviewReconciliationReplacement,
} from "../src/reconciliation-model.js";
import { scenario, workspace, clone, errorCode, observation, context, OTHER } from "./helpers/reconciliation-fixtures.js";

test("reconciliation: empty workspace has fixed, immutable, unverified slots", () => {
  const value = emptyReconciliationWorkspace();
  assert.equal(value.schema, RECONCILIATION_SCHEMA);
  assert.deepEqual(value.slots.map(slot => slot.agent), ["DAT", "EMA", "CAWELON"]);
  assert.equal(value.readOnly, true);
  assert.equal(value.independentlyVerified, false);
  for (const slot of value.slots) {
    assert.equal(slot.earlier, null);
    assert.equal(slot.later, null);
    assert.equal(slot.archive, null);
    assert.ok(Object.isFrozen(slot));
  }
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.slots));
});

for (const agent of RECONCILIATION_AGENTS) {
  for (const chainId of [8453, 84532]) {
    test(`reconciliation model preserves ${agent} on ${chainId} without mutating input`, () => {
      const input = clone(workspace([scenario(agent, {}, chainId)]));
      const before = JSON.stringify(input);
      const result = validateReconciliationWorkspace(input);
      assert.equal(JSON.stringify(input), before);
      const selected = result.slots.find(slot => slot.agent === agent);
      assert.equal(selected.earlier.chainId, chainId);
      assert.equal(selected.archive.records[0].context.chainId, chainId);
      input.slots.find(slot => slot.agent === agent).earlier.balanceBaseUnits = "0";
      assert.notEqual(selected.earlier.balanceBaseUnits, "0");
      assert.ok(Object.isFrozen(selected.earlier.metadata));
      assert.ok(Object.isFrozen(selected.archive.records));
    });
  }
}

for (const [field, value] of [
  ["schema", "future"], ["readOnly", false], ["readOnly", "true"],
  ["independentlyVerified", true], ["independentlyVerified", null],
]) test(`reconciliation rejects envelope ${field}=${value}`, () => {
  assert.throws(() => validateReconciliationWorkspace({ ...emptyReconciliationWorkspace(), [field]: value }), errorCode("RECONCILIATION_SCHEMA"));
});

for (const field of ["schema", "slots", "readOnly", "independentlyVerified"]) {
  test("reconciliation rejects missing envelope field " + field, () => {
    const value = clone(emptyReconciliationWorkspace());
    delete value[field];
    assert.throws(() => validateReconciliationWorkspace(value), errorCode("RECONCILIATION_SHAPE"));
  });
}

for (const input of [null, [], 1, "text", true]) test("reconciliation rejects non-object " + JSON.stringify(input), () => {
  assert.throws(() => validateReconciliationWorkspace(input), errorCode("RECONCILIATION_SHAPE"));
});

test("reconciliation rejects extra results and prototypes without running accessors", () => {
  const value = clone(emptyReconciliationWorkspace());
  assert.throws(() => validateReconciliationWorkspace({ ...value, report: "verified" }));
  assert.throws(() => validateReconciliationWorkspace(Object.assign(Object.create({ command: "ignored" }), value)));
  let called = false;
  Object.defineProperty(value, "slots", { enumerable: true, get() { called = true; throw Error("not called"); } });
  assert.throws(() => validateReconciliationWorkspace(value));
  assert.equal(called, false);
});

for (const transform of [
  value => ({ ...value, slots: [] }),
  value => ({ ...value, slots: value.slots.slice(0, 2) }),
  value => ({ ...value, slots: [...value.slots, value.slots[0]] }),
  value => ({ ...value, slots: [...value.slots].reverse() }),
  value => ({ ...value, slots: [value.slots[0], value.slots[0], value.slots[2]] }),
  value => ({ ...value, slots: null }),
]) test("reconciliation rejects malformed fixed-slot arrangement " + String(transform), () => {
  assert.throws(() => validateReconciliationWorkspace(transform(emptyReconciliationWorkspace())), errorCode("RECONCILIATION_SLOTS"));
});

for (const part of RECONCILIATION_PARTS) {
  test("reconciliation rejects missing slot part " + part, () => {
    const value = clone(workspace());
    delete value.slots[0][part];
    assert.throws(() => validateReconciliationWorkspace(value), errorCode("RECONCILIATION_SHAPE"));
  });
  test("reconciliation prevents cross-token data in " + part, () => {
    assert.throws(() => replaceReconciliationPart(workspace(), "DAT", part, scenario("EMA")[part]), errorCode("RECONCILIATION_SLOT_AGENT"));
  });
  test("reconciliation supports explicit removal and immutable replacement of " + part, () => {
    const before = workspace();
    const after = replaceReconciliationPart(before, "DAT", part, null);
    assert.equal(after.slots[0][part], null);
    assert.notEqual(before.slots[0][part], null);
    for (const other of RECONCILIATION_PARTS.filter(value => value !== part)) {
      assert.deepEqual(after.slots[0][other], before.slots[0][other]);
    }
  });
}

test("reconciliation keeps conflicting account evidence for an explicit diagnostic", () => {
  const value = replaceReconciliationPart(workspace(), "DAT", "later", observation({}, context("DAT", 8453, OTHER)));
  assert.equal(value.slots[0].later.account, OTHER);
  assert.notEqual(value.slots[0].earlier.account, OTHER);
});

test("reconciliation key canonicalizes input key order and address case", () => {
  const a = workspace();
  const b = clone(a);
  b.slots[0].earlier.account = b.slots[0].earlier.account.toUpperCase().replace("0X", "0x");
  b.slots[0].archive.records[0].events.reverse();
  const reordered = Object.fromEntries(Object.entries(b).reverse());
  assert.equal(reconciliationKey(a), reconciliationKey(reordered));
});

test("reconciliation clear targets exactly one selected token", () => {
  const before = workspace(RECONCILIATION_AGENTS.map(agent => scenario(agent)));
  const after = clearReconciliationSlot(before, "EMA");
  assert.deepEqual(after.slots[1], emptyReconciliationWorkspace().slots[1]);
  assert.deepEqual(after.slots[0], before.slots[0]);
  assert.deepEqual(after.slots[2], before.slots[2]);
});

for (const agent of ["DOT", "KWY", "dat", "all", "", null]) test("reconciliation rejects unknown agent " + agent, () => {
  assert.throws(() => clearReconciliationSlot(workspace(), agent), errorCode("RECONCILIATION_AGENT"));
});

test("reconciliation rejects unknown parts without property assignment", () => {
  for (const part of ["__proto__", "constructor", "balance", null]) {
    assert.throws(() => replaceReconciliationPart(workspace(), "DAT", part, null), errorCode("RECONCILIATION_PART"));
  }
});

test("review binds before key and identifies all nine additions", () => {
  const before = emptyReconciliationWorkspace();
  const after = workspace(RECONCILIATION_AGENTS.map(agent => scenario(agent)));
  const review = reviewReconciliationReplacement(before, after);
  assert.equal(review.beforeKey, reconciliationKey(before));
  assert.equal(review.changes.length, 9);
  assert.ok(review.changes.every(change => change.action === "add"));
  assert.equal(review.requiresReplacementAcknowledgement, false);
  assert.ok(Object.isFrozen(review.changes));
  assert.deepEqual(review.after, after);
});

test("review separates replacement, removal and unchanged parts", () => {
  const before = workspace();
  const after = replaceReconciliationPart(replaceReconciliationPart(before, "DAT", "archive", null),
    "DAT", "later", observation({ blockNumber: "43" }));
  const review = reviewReconciliationReplacement(before, after);
  assert.deepEqual(review.changes.map(change => [change.part, change.action]), [["later", "replace"], ["archive", "remove"]]);
  assert.equal(review.requiresReplacementAcknowledgement, true);
  assert.equal(review.changes[0].before.blockNumber, "42");
  assert.equal(review.changes[0].after.blockNumber, "43");
});

test("review of equal workspaces has no fake changes", () => {
  const review = reviewReconciliationReplacement(workspace(), clone(workspace()));
  assert.deepEqual(review.changes, []);
  assert.equal(review.requiresReplacementAcknowledgement, false);
});

test("part summaries retain full addresses and distinguish absent balance", () => {
  const value = observation({ hasCode: false, metadata: null, balanceBaseUnits: null });
  const description = describeReconciliationPart("earlier", value);
  assert.equal(description.account, value.account);
  assert.equal(description.balanceBaseUnits, null);
  assert.equal(description.siteOrigin, value.siteOrigin);
  assert.equal(describeReconciliationPart("archive", null), null);
  assert.equal(describeReconciliationPart("archive", scenario().archive).records, 1);
});
