import test from "node:test";
import assert from "node:assert/strict";
import { createReportSetController } from "../src/report-set-controller.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { buildMissingHistoryDraft, prepareMissingHistoryDraftFile } from "../src/report-set-export.js";
import { decodePeriodFile } from "../src/period-file.js";
import { sequenceHistory, sequenceSet, historyMemory, fileFrom } from "./helpers/report-set-fixtures.js";
import { controllerFixture } from "./helpers/vault-fixtures.js";
const partial = () => sequenceSet(sequenceHistory([0n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); }));
const activity = () => ({ agent: "DAT", direction: "all", search: "", order: "newest", page: 0, pageSize: 20 });

test("missing-window export captures the requested plan before progress observers mutate the query", async () => {
  const query = { groupId: "DAT-1", windowSize: 2, page: "0" }, input = partial(), expected = await prepareMissingHistoryDraftFile(input, query, "1"), files = [], store = historyMemory();
  const controller = createReportSetController({ storage: store.storage, onChange: state => { if (state.phase === "exporting") { query.windowSize = 1; query.page = "99"; } } });
  try {
    await controller.importFile(fileFrom((await prepareReportSetFile(input)).text)); await controller.applyReview(); const accepted = controller.state.input;
    assert.equal(await controller.exportMissingDraft(query, "1", true, file => files.push(file)), true);
    assert.equal(files[0].text, expected.text); assert.equal((await decodePeriodFile(files[0].text)).draft.plan.earlierBlock, "40");
    assert.equal(controller.state.input, accepted); assert.equal(store.calls.length, 0);
  } finally { controller.dispose(); }
});

test("invalid missing-window requests retain an unapplied candidate and perform no delivery", async () => {
  const store = historyMemory(), controller = createReportSetController({ storage: store.storage });
  try {
    const file = await prepareReportSetFile(partial()); await controller.importFile(fileFrom(file.text)); await controller.applyReview();
    await controller.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text)); const pending = controller.state.review;
    let delivered = 0; assert.equal(await controller.exportMissingDraft({ groupId: "DAT-1", windowSize: 0 }, "1", true, () => { delivered++; }), false);
    assert.equal(controller.state.review, pending); assert.equal(delivered, 0); assert.equal(store.calls.length, 0);
  } finally { controller.dispose(); }
});

test("cancelling during missing-window query reflection cannot revive the export", async () => {
  const controller = createReportSetController({ storage: historyMemory().storage });
  try {
    await controller.importFile(fileFrom((await prepareReportSetFile(partial())).text)); await controller.applyReview();
    let cancelled = false, delivered = 0;
    const query = new Proxy({ groupId: "DAT-1", windowSize: 2, page: "0" }, { getOwnPropertyDescriptor(target, key) { if (!cancelled) { cancelled = true; controller.cancel(); } return Reflect.getOwnPropertyDescriptor(target, key); } });
    assert.equal(await controller.exportMissingDraft(query, "1", true, () => { delivered++; }), false);
    assert.equal(cancelled, true); assert.equal(delivered, 0); assert.equal(controller.state.busy, false);
  } finally { controller.dispose(); }
});

test("shared draft proposal exposes an immutable normalized query without changing existing file bytes", async () => {
  const input = partial(), proposal = buildMissingHistoryDraft(input, { groupId: "DAT-1", windowSize: 2 }, "1");
  assert.ok(Object.isFrozen(proposal.query));
  assert.equal((await prepareMissingHistoryDraftFile(input, proposal.query, "1")).text, (await prepareMissingHistoryDraftFile(input, { groupId: "DAT-1", windowSize: 2 }, "1")).text);
});

test("filtered activity export cannot broaden DAT to all tokens during the export observer", async () => {
  const query = activity(), f = controllerFixture({ onChange: state => { if (state.activeAction === "export") query.agent = "all"; } });
  try {
    await f.capture(); const before = JSON.stringify(f.controller.state.working);
    const file = await f.controller.prepare("filtered-csv", false, query);
    assert.equal(query.agent, "all"); assert.equal(file.matched, 1); assert.equal(file.query.agent, "DAT");
    assert.equal(JSON.stringify(f.controller.state.working), before); assert.equal(f.storage.calls.length, 0);
  } finally { f.controller.dispose(); }
});

test("activity query capture rejects accessors and honors reflective cancellation or disposal", async () => {
  for (const action of ["cancel", "dispose"]) {
    const f = controllerFixture();
    try {
      await f.capture(); let interrupted = false;
      const query = new Proxy(activity(), { ownKeys(target) { if (!interrupted) { interrupted = true; f.controller[action](); } return Reflect.ownKeys(target); } });
      assert.equal(await f.controller.prepare("filtered-csv", false, query), null);
      assert.equal(f.controller.state.busy, false); assert.equal(f.storage.calls.filter(row => row.method === "read").length, 0);
    } finally { f.controller.dispose(); }
  }
  const f = controllerFixture(); let gets = 0;
  try {
    await f.capture(); const query = { ...activity(), get agent() { gets++; return "all"; } };
    assert.equal(await f.controller.prepare("filtered-csv", false, query), null); assert.equal(gets, 0); assert.equal(f.storage.calls.length, 0);
  } finally { f.controller.dispose(); }
});

test("unfiltered vault exports ignore unused queries", async () => {
  const f = controllerFixture(); let calls = 0;
  try {
    await f.capture(); const query = new Proxy({}, { ownKeys() { calls++; throw Error("Unused"); } });
    assert.ok(await f.controller.prepare("json", false, query)); assert.equal(calls, 0);
  } finally { f.controller.dispose(); }
});
