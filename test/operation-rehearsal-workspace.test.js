import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExample, rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { createRehearsalWorkspace, validateRehearsalWorkspace, encodeRehearsalWorkspace,
  decodeRehearsalWorkspace, reportRehearsalWorkspace, REHEARSAL_WORKSPACE_SCHEMA,
  REHEARSAL_WORKSPACE_LIMIT, REHEARSAL_AGENTS } from "../src/operation-rehearsal-workspace.js";
const pack = (ledgers = [rehearsalExampleV2()], activeAgent = "DAT") =>
  ({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent, ledgers });
const event = (agent = "DAT", id = "add") => ({ id, kind: "deposit", agent, chainId: 84532,
  account: rehearsalExampleV2(agent).account, amount: "1000000" });
const seeded = () => { const w = createRehearsalWorkspace(); w.reset(rehearsalExampleV2()); return w; };

test("round trip preserves mixed versions and canonical agent order without migration", () => {
  const data = decodeRehearsalWorkspace(encodeRehearsalWorkspace(pack([
    rehearsalExampleV2("CAWELON"), rehearsalExample("DAT"), rehearsalExampleV2("EMA")], "EMA")));
  assert.deepEqual(data.ledgers.map(x => x.agent), REHEARSAL_AGENTS);
  assert.equal(data.ledgers[0].schema, "threecore.operation-rehearsal.v1");
  assert.equal(data.activeAgent, "EMA"); assert.ok(Object.isFrozen(data.ledgers[0].policy));
  assert.throws(() => data.ledgers.push(rehearsalExample()));
});
test("absent agents are unknown, never zero; reports do not aggregate unlike assets", () => {
  const alternate = { ...rehearsalExampleV2("EMA"), chainId: 8453,
    asset: { ...rehearsalExampleV2().asset, symbol: "OTHER", decimals: 18 }, events: [] };
  const r = reportRehearsalWorkspace(pack([rehearsalExampleV2(), alternate]));
  assert.equal(r.rows[2].present, false); assert.equal(r.rows[2].report, null);
  assert.equal(r.rows[2].recordCount, null); assert.equal(r.rows[1].report.asset.decimals, 18);
  assert.equal(Object.hasOwn(r, "total"), false); assert.equal(Object.hasOwn(r, "cash"), false);
  assert.equal(r.sourceVerified, false); assert.equal(r.authorizesExecution, false);
});
test("strict workspace rejects duplicates, unknown fields, sparse arrays and derived reports", () => {
  for (const input of [pack([rehearsalExampleV2(), rehearsalExampleV2()]),
    { ...pack(), extra: true }, { ...pack(), activeAgent: "OTHER" },
    pack(new Array(2)), pack(Array(4).fill(rehearsalExampleV2())),
    pack([{ ...rehearsalExampleV2(), result: "trusted" }]), { ...pack(), simulationOnly: false }])
    assert.throws(() => validateRehearsalWorkspace(input));
});
test("getters are not invoked, duplicate JSON keys and oversized text are refused", () => {
  let called = false; const input = pack();
  Object.defineProperty(input, "ledgers", { get() { called = true; return []; }, enumerable: true });
  assert.throws(() => validateRehearsalWorkspace(input)); assert.equal(called, false);
  assert.throws(() => decodeRehearsalWorkspace('{"schema":1,"schema":2}'), { code: "INVALID_JSON" });
  assert.throws(() => decodeRehearsalWorkspace(" ".repeat(REHEARSAL_WORKSPACE_LIMIT + 1)), { code: "FILE_TOO_LARGE" });
  assert.throws(() => decodeRehearsalWorkspace("あ".repeat(180000)), { code: "FILE_TOO_LARGE" });
});
test("each member retains the individual file and event bounds", () => {
  const data = structuredClone(rehearsalExampleV2());
  data.events = Array.from({ length: 201 }, (_, i) => event("DAT", "d" + i));
  assert.throws(() => encodeRehearsalWorkspace(pack([data])));
  data.events = Array.from({ length: 200 }, (_, i) => ({ ...data.events[0], id: "d" + i }));
  assert.equal(decodeRehearsalWorkspace(encodeRehearsalWorkspace(pack([data]))).ledgers[0].events.length, 200);
});
test("three independent ledgers and undo checkpoints survive repeated switching", () => {
  const w = createRehearsalWorkspace();
  for (const name of REHEARSAL_AGENTS) { w.reset(rehearsalExampleV2(name)); w.commit(w.preview(event(name))); }
  for (const name of REHEARSAL_AGENTS) {
    w.select(name); assert.equal(w.state().current.events.length, 3); assert.equal(w.state().undoCount, 1);
  }
  w.select("EMA"); w.undo();
  assert.equal(w.state().current.events.length, 2);
  w.select("DAT"); assert.equal(w.state().current.events.length, 3); assert.equal(w.state().undoCount, 1);
  w.clear(); assert.equal(w.state().current, null);
  assert.deepEqual(w.snapshot().ledgers.map(x => x.agent), ["EMA", "CAWELON"]);
});
test("switching revokes append review and cannot commit against another agent or on return", () => {
  const w = seeded(), review = w.preview(event()); w.select("EMA");
  assert.throws(() => w.commit(review), { code: "STALE_REVIEW" });
  w.select("DAT"); assert.throws(() => w.commit(review), { code: "STALE_REVIEW" });
  assert.equal(w.state().current.events.length, 2);
});
test("exports include applied data only; pending proposals are never saved", () => {
  const w = seeded(); w.preview(event());
  assert.equal(decodeRehearsalWorkspace(encodeRehearsalWorkspace(w.snapshot())).ledgers[0].events.length, 2);
});
test("restore preview changes nothing; confirmation atomically replaces all ledgers once", () => {
  const w = seeded(); w.commit(w.preview(event())); const before = encodeRehearsalWorkspace(w.snapshot());
  const review = w.previewRestore(pack([rehearsalExampleV2("EMA", "loss")], "EMA"));
  assert.equal(encodeRehearsalWorkspace(w.snapshot()), before); assert.equal(w.state().undoCount, 1);
  assert.equal(review.before.rows[0].present, true); assert.equal(review.after.rows[0].present, false);
  assert.throws(() => w.restore({ ...review }), { code: "STALE_REVIEW" });
  w.restore(review); assert.equal(w.state().activeAgent, "EMA"); assert.equal(w.state().undoCount, 0);
  assert.deepEqual(w.snapshot().ledgers.map(x => x.agent), ["EMA"]);
  assert.throws(() => w.restore(review), { code: "STALE_REVIEW" });
});
test("one invalid member cannot partly replace valid existing history", () => {
  const w = seeded(); const before = w.state().current;
  assert.throws(() => w.previewRestore(pack([rehearsalExampleV2("EMA"), { ...rehearsalExampleV2("CAWELON"), openingBalance: "bad" }])));
  assert.equal(w.state().current, before); assert.equal(w.snapshot().ledgers.length, 1);
});
for (const action of ["select", "clear", "reset", "preview", "undo", "cancel", "dispose"]) {
  test(action + " invalidates a restore review", () => {
    const w = seeded(); w.commit(w.preview(event())); const review = w.previewRestore(pack([], "CAWELON"));
    if (action === "select") w.select("EMA");
    else if (action === "reset") w.reset(rehearsalExampleV2("EMA"));
    else if (action === "preview") w.preview(event("DAT", "next"));
    else w[action]();
    assert.throws(() => w.restore(review), { code: action === "dispose" ? "WORKSPACE_DISPOSED" : "STALE_REVIEW" });
  });
}
test("empty restore is explicit; the selected absent agent stays absent", () => {
  const w = seeded(), r = w.previewRestore(pack([], "CAWELON"));
  assert.equal(w.snapshot().ledgers.length, 1); w.restore(r);
  assert.equal(w.snapshot().ledgers.length, 0); assert.equal(w.state().current, null);
  assert.equal(w.state().activeAgent, "CAWELON"); assert.equal(reportRehearsalWorkspace(w.snapshot()).constraintsSatisfied, false);
});
test("rejected business records remain visible and fail modeled constraints without corrupting other agents", () => {
  const report = reportRehearsalWorkspace(pack([rehearsalExampleV2("DAT", "limit"), rehearsalExampleV2("EMA")]));
  assert.equal(report.constraintsSatisfied, false);
  assert.equal(report.rows[0].report.cash, "1000000000"); assert.equal(report.rows[1].report.cash, "1028000000");
});
for (const operation of ["reset", "previewRestore"]) test(operation + " detects reentrant selection during input capture", () => {
  const w = seeded(); let changed = false;
  const source = operation === "reset" ? rehearsalExampleV2() : pack();
  const input = new Proxy(source, { ownKeys(target) {
    if (!changed) { changed = true; w.select("EMA"); }
    return Reflect.ownKeys(target);
  } });
  assert.throws(() => w[operation](input), { code: "STALE_REVIEW" });
  assert.equal(w.state().activeAgent, "EMA"); assert.equal(w.state().current, null);
  assert.equal(w.snapshot().ledgers[0].agent, "DAT");
});
test("event reflection cannot retain an append review after switching away", () => {
  const w = seeded(); let changed = false;
  const input = new Proxy(event(), { getOwnPropertyDescriptor(target, key) {
    if (!changed) { changed = true; w.select("EMA"); } return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  assert.throws(() => w.preview(input), { code: "STALE_REVIEW" });
  w.select("DAT"); assert.equal(w.state().hasReview, false); assert.equal(w.state().current.events.length, 2);
});
test("dispose revokes all agents; a foreign workspace cannot consume a review", () => {
  const a = seeded(), b = seeded(), review = a.previewRestore(pack());
  assert.throws(() => b.restore(review), { code: "STALE_REVIEW" });
  a.dispose(); assert.throws(() => a.snapshot(), { code: "WORKSPACE_DISPOSED" });
  assert.throws(() => a.reset(rehearsalExampleV2()), { code: "WORKSPACE_DISPOSED" });
  assert.throws(() => a.select("DAT"), { code: "WORKSPACE_DISPOSED" });
});
