import test from "node:test";
import assert from "node:assert/strict";
import { emptyPeriodDraft, validatePeriodDraft, periodDraftKey, periodDraftProgress, periodDraftWorkspace,
  periodDraftAnchors, appendPeriodObservation, appendPeriodRecord } from "../src/period-draft.js";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { workspace, scenario } from "./helpers/reconciliation-fixtures.js";
import { plan, checkpoint, context, observation, clone, code, OTHER, hash, UNIT } from "./helpers/period-fixtures.js";

for (let count = 0; count <= 5; count++) {
  test(`checkpoint stage ${count} has deterministic next action`, () => {
    const value = checkpoint(count);
    const result = periodDraftProgress(value);
    assert.equal(result.completed, count);
    assert.equal(result.total, 5);
    assert.equal(result.complete, count === 5);
    assert.equal(result.windowsCompleted, Math.max(0, count - 2));
    assert.equal(result.next, ["earlier", "later", "history", "history", "history", "recheck"][count]);
    assert.equal(result.nextWindow === null, count === 5);
    assert.deepEqual(validatePeriodDraft(value), value);
  });
}

test("complete draft builds arithmetic agreement for only its selected token", () => {
  const draft = checkpoint();
  const value = periodDraftWorkspace(draft);
  const report = reconcileWorkspace(value);
  assert.equal(report.slots[0].status, "arithmetic-agreement");
  assert.equal(report.slots[0].totals.residualBaseUnits, "0");
  assert.equal(report.slots[1].status, "missing-input");
  assert.equal(report.slots[2].status, "missing-input");
  assert.equal(value.slots[0].archive.records.length, 3);
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test(`handoff of ${agent} preserves other token evidence`, () => {
    const before = workspace([scenario("DAT"), scenario("EMA"), scenario("CAWELON")]);
    const selected = plan({}, context(agent, 84532));
    const after = periodDraftWorkspace(checkpoint(5, selected), before);
    for (let i = 0; i < after.slots.length; i++) {
      if (before.slots[i].agent !== agent) assert.deepEqual(after.slots[i], before.slots[i]);
      else assert.equal(after.slots[i].earlier.chainId, 84532);
    }
  });
}

for (let count = 0; count < 5; count++) {
  test("partial checkpoint cannot be handed off as complete: " + count, () => {
    assert.throws(() => periodDraftWorkspace(checkpoint(count)), code("PERIOD_INCOMPLETE"));
  });
}

test("events and queried anchors are unique, ordered and detached", () => {
  const anchors = periodDraftAnchors(checkpoint());
  assert.deepEqual(anchors.map(row => row.number), ["30", "31", "35", "36", "40", "41", "42"]);
  assert.equal(new Set(anchors.map(row => row.number)).size, anchors.length);
  assert.equal(Object.isFrozen(anchors), true);
  assert.equal(Object.isFrozen(anchors[0]), true);
});

test("empty checkpoints have no claimed anchors", () => {
  assert.deepEqual(periodDraftAnchors(emptyPeriodDraft(plan())), []);
});

test("later observation requires an earlier observation", () => {
  const source = clone(checkpoint(2));
  source.earlier = null;
  assert.throws(() => validatePeriodDraft(source), code("PERIOD_PREFIX"));
});

test("history requires both endpoint observations", () => {
  const source = clone(checkpoint(3));
  source.later = null;
  assert.throws(() => validatePeriodDraft(source), code("PERIOD_PREFIX"));
});

for (const field of ["agent", "account", "chainId"]) {
  test("observation context mismatch: " + field, () => {
    const source = clone(checkpoint(1));
    const selected = { ...context(), [field]: field === "agent" ? "EMA" : field === "account" ? OTHER : 84532 };
    source.earlier = observation({}, selected);
    assert.throws(() => validatePeriodDraft(source), code("PERIOD_CONTEXT_MISMATCH"));
  });
}

for (const part of ["earlier", "later"]) {
  test("observation endpoint mismatch: " + part, () => {
    const source = clone(checkpoint(2));
    source[part].blockNumber = "33";
    assert.throws(() => validatePeriodDraft(source), code("PERIOD_ENDPOINT_MISMATCH"));
  });
  test("endpoint token identity mismatch: " + part, () => {
    const source = clone(checkpoint(2));
    source[part].metadata.symbol = "OTHER";
    assert.throws(() => validatePeriodDraft(source), code("PERIOD_TOKEN_MISMATCH"));
  });
}

test("missing token code cannot be resumed as a known zero balance", () => {
  const source = clone(checkpoint(1));
  Object.assign(source.earlier, { hasCode: false, metadata: null, balanceBaseUnits: null });
  assert.throws(() => validatePeriodDraft(source), code("PERIOD_TOKEN_MISMATCH"));
});

test("valid amount differences are preserved for reconciliation", () => {
  const source = clone(checkpoint());
  source.later.balanceBaseUnits = (108n * UNIT).toString();
  const draft = validatePeriodDraft(source);
  const report = reconcileWorkspace(periodDraftWorkspace(draft));
  assert.equal(report.slots[0].status, "unexplained-difference");
  assert.equal(report.slots[0].totals.residualBaseUnits, UNIT.toString());
});

test("records cannot be reordered or skip an uncollected window", () => {
  const source = clone(checkpoint());
  [source.records[0], source.records[1]] = [source.records[1], source.records[0]];
  assert.throws(() => validatePeriodDraft(source), code("PERIOD_RECORD_RANGE"));
  assert.throws(() => validatePeriodDraft({ ...checkpoint(), records: checkpoint().records.slice(1) }), code("PERIOD_RECORD_RANGE"));
});

test("extra records and non-arrays fail the record limit", () => {
  assert.throws(() => validatePeriodDraft({ ...checkpoint(), records: [...checkpoint().records, checkpoint().records[0]] }), code("PERIOD_RECORDS"));
  assert.throws(() => validatePeriodDraft({ ...checkpoint(), records: {} }), code("PERIOD_RECORDS"));
});

test("final history anchor must agree with later balance anchor", () => {
  const source = clone(checkpoint());
  source.later.blockHash = hash(999);
  assert.throws(() => validatePeriodDraft(source), code("PERIOD_ANCHOR_CONFLICT"));
});

test("observations retain old origins and epochs across explicit resumed reads", () => {
  const source = clone(checkpoint());
  source.earlier.siteOrigin = "http://127.0.0.1:4185";
  source.earlier.connectionEpoch = 17;
  const value = validatePeriodDraft(source);
  assert.equal(value.earlier.siteOrigin, "http://127.0.0.1:4185");
  assert.equal(value.earlier.connectionEpoch, 17);
  assert.notEqual(value.later.siteOrigin, value.earlier.siteOrigin);
});

test("append cannot silently replace a previously obtained balance", () => {
  assert.throws(() => appendPeriodObservation(checkpoint(1), "earlier", observation()), code("PERIOD_ALREADY_COLLECTED"));
  assert.throws(() => appendPeriodObservation(checkpoint(0), "middle", observation()), code("PERIOD_PART"));
});

test("append history validates without mutating the caller checkpoint", () => {
  const before = checkpoint(2);
  const after = appendPeriodRecord(before, checkpoint(3).records[0]);
  assert.equal(before.records.length, 0);
  assert.equal(after.records.length, 1);
  assert.equal(Object.isFrozen(after.records[0].events), true);
});

for (const patch of [{ schema: "v2" }, { readOnly: false }, { independentlyVerified: true }]) {
  test("draft rejects stronger claims: " + JSON.stringify(patch), () => {
    assert.throws(() => validatePeriodDraft({ ...checkpoint(), ...patch }), code("PERIOD_DRAFT_SCHEMA"));
  });
}

test("no unrecognized field is included in a canonical checkpoint", () => {
  assert.throws(() => validatePeriodDraft({ ...checkpoint(), privateKey: "not-a-key" }), code("PERIOD_SHAPE"));
});

test("schema getters are rejected without invoking them", () => {
  const value = clone(checkpoint());
  let invoked = false;
  Object.defineProperty(value, "schema", { get() { invoked = true; return "x"; } });
  assert.throws(() => validatePeriodDraft(value), code("PERIOD_SHAPE"));
  assert.equal(invoked, false);
});

test("canonical draft key is independent of property insertion order", () => {
  const value = checkpoint();
  const shuffled = Object.fromEntries(Object.entries(value).reverse());
  assert.equal(periodDraftKey(value), periodDraftKey(shuffled));
});

test("validation creates a detached immutable copy at every record level", () => {
  const source = clone(checkpoint());
  const result = validatePeriodDraft(source);
  source.plan.earlierBlock = "1";
  source.records[0].events[0].amountBaseUnits = "1";
  assert.equal(result.plan.earlierBlock, "30");
  assert.equal(result.records[0].events[0].amountBaseUnits, (10n * UNIT).toString());
  assert.equal(Object.isFrozen(result.records[0].events[0]), true);
});
