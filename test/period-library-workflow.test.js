import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodController } from "../src/period-controller.js";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { collectPeriod } from "../src/period-reader.js";
import { periodDraftKey, periodDraftProgress, periodDraftWorkspace } from "../src/period-draft.js";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile } from "../src/period-library-file.js";
import { compareLibraryDrafts, mutatePeriodLibrary } from "../src/period-library-model.js";
import {
  memoryStorage, library, entry, checkpoint, plan, context, id, LATER, TIME,
  ACCOUNT, OTHER, THIRD, fileFrom, deferred, tick, clone,
} from "./helpers/period-library-fixtures.js";
import { periodSession, hash } from "./helpers/period-fixtures.js";

function connectedControllers(selected, store, options = {}) {
  let sequence = 50;
  const session = options.fixture ?? periodSession(selected);
  const period = createPeriodController({
    getContext: () => selected.context,
    read: (agent, nextPlan, config) => collectPeriod(session.session, nextPlan, config),
  });
  const saved = createPeriodLibraryController({
    storage: store.storage,
    getCheckpoint: () => period.state.draft ? {
      draft: period.state.draft, requiresNewPlan: period.state.requiresNewPlan,
    } : null,
    stageCheckpoint: (draft, flags) => period.stageSaved(draft, flags),
    now: () => LATER,
    createId: () => id(++sequence),
  });
  return { period, saved, session, dispose() { saved.dispose(); period.dispose(); } };
}

for (const [agent, account] of [["DAT", ACCOUNT], ["EMA", OTHER], ["CAWELON", THIRD]]) {
  for (const chain of [8453, 84532]) {
    test("save, reopen, restore and resume every acquisition prefix: " + agent + "/" + chain, async () => {
      const selected = plan({}, context(agent, chain, account));
      const reference = await collectPeriod(periodSession(selected).session, selected);
      for (const prefix of [0, 1, 2, 3, 4, 5]) {
        const source = checkpoint(prefix, selected);
        const store = memoryStorage(library([entry(1, { draft: source })], 1));
        const f = connectedControllers(selected, store);
        try {
          await f.saved.refresh();
          f.saved.select(id(1));
          f.saved.prepareRestore();
          assert.equal(await f.saved.applyReview(), true);
          assert.equal(f.period.state.draft, null);
          assert.equal(f.session.calls.length, 0);
          assert.equal(f.period.apply(), true);
          assert.equal(f.period.state.checkedThisSession, false);
          assert.equal(await f.period.start(), true);
          // Original endpoint provenance is retained when resuming from another origin.
          const expected = { ...reference, earlier: source.earlier ?? reference.earlier,
            later: source.later ?? reference.later };
          assert.equal(periodDraftKey(f.period.state.draft), periodDraftKey(expected));
          assert.equal(f.period.state.checkedThisSession, true);
          const results = reconcileWorkspace(periodDraftWorkspace(f.period.state.draft));
          assert.equal(results.slots.find(row => row.agent === agent).status, "arithmetic-agreement");
          if (prefix < 5) {
            assert.equal(f.saved.prepareSave(agent + " resumed"), true);
            assert.equal(await f.saved.applyReview(), true);
            assert.equal(store.document.entries.length, 2);
            assert.equal(periodDraftProgress(store.document.entries[0].draft).completed, prefix);
            assert.equal(periodDraftProgress(store.document.entries[1].draft).completed, 5);
          }
          const backup = await preparePeriodLibraryFile(store.document);
          const reopened = await decodePeriodLibraryFile(backup.text);
          assert.equal(reopened.document.entries[0].draft.plan.context.account, account);
          assert.equal(reopened.document.entries[0].draft.plan.context.chainId, chain);
          assert.equal(reopened.document.entries[0].draft.plan.context.agent, agent);
        } finally { f.dispose(); }
      }
    });
  }
}

test("saved checkpoint remains untouched when live block revalidation detects a reorg", async () => {
  const selected = plan();
  const source = checkpoint(3, selected);
  const store = memoryStorage(library([entry(1, { draft: source })], 1));
  const session = periodSession(selected);
  session.hashes.set("30", hash(999));
  const f = connectedControllers(selected, store, { fixture: session });
  try {
    await f.saved.refresh();
    f.saved.select(id(1)); f.saved.prepareRestore();
    await f.saved.applyReview(); f.period.apply();
    assert.equal(await f.period.start(), false);
    assert.equal(f.period.state.requiresNewPlan, true);
    assert.equal(periodDraftKey(store.document.entries[0].draft), periodDraftKey(source));
    assert.equal(f.saved.prepareSave("Block conflict retained"), true);
    assert.equal(await f.saved.applyReview(), true);
    assert.equal(store.document.entries[1].requiresNewPlan, true);
    assert.equal(store.document.entries[0].requiresNewPlan, false);
    const comparison = compareLibraryDrafts(store.document.entries[0].draft, store.document.entries[1].draft);
    assert.equal(comparison.kind, "identical");
    const portable = await preparePeriodLibraryFile(store.document);
    const nextStore = memoryStorage((await decodePeriodLibraryFile(portable.text)).document);
    const reopened = connectedControllers(selected, nextStore);
    try {
      await reopened.saved.refresh();
      reopened.saved.select(id(51));
      reopened.saved.prepareRestore();
      await reopened.saved.applyReview();
      reopened.period.apply();
      assert.equal(await reopened.period.start(), false);
      assert.equal(reopened.period.state.error, "PERIOD_NEW_PLAN_REQUIRED");
      assert.equal(reopened.session.calls.length, 0);
    } finally { reopened.dispose(); }
  } finally { f.dispose(); }
});

test("quarantined restore can deliberately prepare a new plan without deleting the old record", async () => {
  const selected = plan();
  const source = checkpoint(3, selected);
  const store = memoryStorage(library([entry(1, { draft: source, requiresNewPlan: true })]));
  const f = connectedControllers(selected, store);
  try {
    await f.saved.refresh(); f.saved.select(id(1)); f.saved.prepareRestore();
    await f.saved.applyReview(); f.period.apply();
    assert.equal(f.period.prepareRepair(), true);
    assert.equal(f.period.state.review.requiresReplacement, true);
    assert.equal(f.period.apply(), false);
    assert.equal(f.period.apply(true), true);
    assert.equal(f.period.state.requiresNewPlan, false);
    assert.equal(periodDraftProgress(f.period.state.draft).completed, 0);
    assert.equal(await f.period.start(), true);
    assert.equal(f.saved.prepareSave("Recollected"), true);
    assert.equal(await f.saved.applyReview(), true);
    assert.equal(store.document.entries.length, 2);
    assert.equal(store.document.entries[0].requiresNewPlan, true);
    assert.equal(store.document.entries[1].requiresNewPlan, false);
  } finally { f.dispose(); }
});

test("exporting a collection while a draft is edited exports only committed snapshots", async () => {
  const selected = plan();
  const store = memoryStorage(library([entry(1, { draft: checkpoint(2) })]));
  const f = connectedControllers(selected, store);
  const files = [];
  try {
    await f.saved.refresh();
    f.period.stageSaved(checkpoint(5), { requiresNewPlan: false });
    f.period.apply();
    await f.saved.exportFile("all", value => files.push(value));
    const decoded = await decodePeriodLibraryFile(files[0].text);
    assert.equal(periodDraftProgress(decoded.document.entries[0].draft).completed, 2);
    assert.equal(periodDraftProgress(f.period.state.draft).completed, 5);
    assert.equal(store.document.entries.length, 1);
  } finally { f.dispose(); }
});

test("unrelated current wallet context never alters archived saved identities", async () => {
  const contexts = [
    context("DAT", 8453, ACCOUNT),
    context("DAT", 84532, OTHER),
    context("EMA", 84532, THIRD),
  ];
  const rows = contexts.map((value, index) => entry(index + 1, {
    archived: true, draft: checkpoint(2, plan({}, value)),
  }));
  const store = memoryStorage(library(rows));
  const f = connectedControllers(plan({}, context("CAWELON", 8453, THIRD)), store);
  try {
    await f.saved.refresh();
    const original = JSON.stringify(store.document);
    for (const row of rows) {
      f.saved.select(row.id);
      f.saved.prepareRestore();
      await f.saved.applyReview();
      assert.equal(f.period.apply(true), true);
      assert.equal(await f.period.start(), false);
      assert.equal(f.period.state.error, "PERIOD_CONTEXT_MISMATCH");
      assert.equal(JSON.stringify(store.document), original);
    }
  } finally { f.dispose(); }
});

test("a failed later acquisition can save its completed prefix and resume after file restoration", async () => {
  const selected = plan();
  let failOnce = true;
  const session = periodSession(selected, { before(method, args) {
    if (failOnce && method === "logs" && args[0].fromBlock === "36") {
      failOnce = false;
      throw Error("Synthetic interruption");
    }
  } });
  const store = memoryStorage();
  const f = connectedControllers(selected, store, { fixture: session });
  try {
    await f.saved.refresh();
    f.period.prepare({ earlierBlock: "30", laterBlock: "42", windowSize: 5 });
    f.period.apply();
    assert.equal(await f.period.start(), false);
    assert.equal(periodDraftProgress(f.period.state.draft).completed, 3);
    assert.equal(f.saved.prepareSave("Interrupted after first window"), true);
    assert.equal(await f.saved.applyReview(), true);
    const bytes = await preparePeriodLibraryFile(store.document);
    const destination = memoryStorage();
    const restored = connectedControllers(selected, destination);
    try {
      await restored.saved.refresh();
      await restored.saved.importFile(fileFrom(bytes.text));
      await restored.saved.applyReview();
      restored.saved.select(id(51));
      restored.saved.prepareRestore();
      await restored.saved.applyReview();
      restored.period.apply();
      assert.equal(await restored.period.start(), true);
      assert.equal(periodDraftProgress(restored.period.state.draft).completed, 5);
      assert.equal(destination.document.entries[0].label, "Interrupted after first window");
    } finally { restored.dispose(); }
  } finally { f.dispose(); }
});

test("a cancelled save cannot accidentally replace a subsequently restored current draft", async () => {
  const selected = plan();
  const gate = deferred();
  const store = memoryStorage(library([entry(1, { draft: checkpoint(1) })]), {
    beforeChange: () => gate.promise,
  });
  const f = connectedControllers(selected, store);
  try {
    await f.saved.refresh();
    f.period.stageSaved(checkpoint(3), { requiresNewPlan: false });
    f.period.apply();
    f.saved.prepareSave("Cancelled");
    const pending = f.saved.applyReview();
    f.saved.cancel();
    f.period.stageSaved(checkpoint(5), { requiresNewPlan: false });
    f.period.apply(true);
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(periodDraftProgress(f.period.state.draft).completed, 5);
    assert.equal(store.document.entries.length, 1);
    assert.equal(periodDraftProgress(store.document.entries[0].draft).completed, 1);
  } finally { f.dispose(); }
});

test("metadata edits and round trips do not alter arbitrary large exact amounts", async () => {
  const raw = clone(checkpoint(2));
  raw.earlier.balanceBaseUnits = "90071992547409931234567890";
  raw.later.balanceBaseUnits = "90071992547409931234567891";
  let document = library([entry(1, { draft: raw })]);
  const expected = periodDraftKey(raw);
  for (let round = 0; round < 8; round++) {
    document = mutatePeriodLibrary(document, document.revision, {
      kind: "rename", id: id(1), label: "Revision " + round, time: LATER,
    });
    document = mutatePeriodLibrary(document, document.revision, {
      kind: "archive", id: id(1), archived: round % 2 === 0, time: LATER,
    });
    document = (await decodePeriodLibraryFile((await preparePeriodLibraryFile(document)).text)).document;
    assert.equal(periodDraftKey(document.entries[0].draft), expected);
    assert.equal(document.entries[0].createdAt, TIME);
  }
});

test("exact duplicate imports from two files never cause record multiplication", async () => {
  const file = await preparePeriodLibraryFile(library([entry(), entry(2, { draft: checkpoint(5) })]));
  const store = memoryStorage();
  const f = connectedControllers(plan(), store);
  try {
    await f.saved.refresh();
    for (let index = 0; index < 3; index++) {
      await f.saved.importFile(fileFrom(file.text));
      await f.saved.applyReview();
      assert.equal(store.document.entries.length, 2);
      assert.equal(store.document.revision, 1);
    }
  } finally { f.dispose(); }
});

test("cross-file conflict preserves both original files and the committed destination", async () => {
  const original = await preparePeriodLibraryFile(library([entry()]));
  const changed = await preparePeriodLibraryFile(library([entry(1, { label: "Changed in another copy" })]));
  const store = memoryStorage((await decodePeriodLibraryFile(original.text)).document);
  const f = connectedControllers(plan(), store);
  try {
    await f.saved.refresh();
    const before = JSON.stringify(store.document);
    assert.equal(await f.saved.importFile(fileFrom(changed.text)), false);
    assert.equal(f.saved.state.error, "PERIOD_LIBRARY_IMPORT_CONFLICT");
    assert.equal(JSON.stringify(store.document), before);
    assert.equal((await decodePeriodLibraryFile(original.text)).document.entries[0].label, "控え 1");
    assert.equal((await decodePeriodLibraryFile(changed.text)).document.entries[0].label, "Changed in another copy");
  } finally { f.dispose(); }
});
