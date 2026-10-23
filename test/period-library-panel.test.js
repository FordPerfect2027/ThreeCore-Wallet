import test from "node:test";
import assert from "node:assert/strict";
import { mountPeriodLibraryPanel } from "../examples/period-library-panel.js";
import { mountPeriodPanel } from "../examples/period-panel.js";
import { createPeriodController } from "../src/period-controller.js";
import { collectPeriod } from "../src/period-reader.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile } from "../src/period-library-file.js";
import { periodDraftKey } from "../src/period-draft.js";
import { libraryErrorText, libraryEntryText, libraryComparisonText } from "../src/period-library-view.js";
import { Element } from "./helpers/panel-dom.js";
import { memoryStorage, sampleLibrary, id, LATER, checkpoint, entry, plan, context, deferred, tick, fileFrom, walk } from "./helpers/period-library-fixtures.js";
import { periodSession } from "./helpers/period-fixtures.js";

function fixture(options = {}) {
  const parent = new Element("div");
  const document = { createElement: tag => new Element(tag) };
  const store = options.store ?? memoryStorage(options.initial);
  const files = [], restored = [];
  let current = { draft: checkpoint(3), requiresNewPlan: false };
  let number = 10;
  const mounted = mountPeriodLibraryPanel({
    document, parent, storage: store.storage,
    getCheckpoint: () => current,
    stageCheckpoint: (draft, metadata) => { restored.push({ draft, metadata }); return true; },
    download: file => files.push(file),
    now: () => LATER,
    createId: () => id(++number),
    ...options.panel,
  });
  const q = name => parent.find("period-library-" + name);
  async function settled() {
    for (let i = 0; i < 500 && q("panel").getAttribute("aria-busy") === "true"; i++) await tick();
    assert.equal(q("panel").getAttribute("aria-busy"), "false");
  }
  const input = (name, value, type = "input") => {
    q(name).value = value; q(name).dispatchEvent(new Event(type));
  };
  const select = label => {
    const button = walk(parent).find(node => node.getAttribute("aria-label") === "控えを選択: " + label);
    assert.ok(button, "Missing row " + label);
    button.click();
  };
  return { parent, document, mounted, store, q, files, restored, input, settled, select,
    source(value) { current = value; },
    async open() { q("refresh").click(); await settled(); },
    async file(text) {
      q("file").files = [fileFrom(text)];
      q("file").dispatchEvent(new Event("change"));
      await settled();
    },
  };
}

test("library panel is inert on mount with labeled controls and privacy notice", () => {
  const f = fixture();
  assert.equal(f.store.calls.length, 0);
  assert.equal(f.q("save").disabled, true);
  assert.equal(f.q("file").disabled, true);
  assert.equal(f.q("review").hidden, true);
  assert.equal(f.q("detail").hidden, true);
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  assert.match(f.q("notice").textContent, /暗号化されていません/);
  assert.match(f.q("file-note").textContent, /認証しません/);
  f.mounted.dispose();
});

test("visible save workflow requires review before persistence", async () => {
  const f = fixture();
  await f.open();
  f.input("label", "DAT morning");
  f.q("save").click();
  assert.equal(f.q("review").hidden, false);
  assert.equal(f.store.document.entries.length, 0);
  f.q("apply").click(); await f.settled();
  assert.equal(f.store.document.entries.length, 1);
  assert.equal(f.q("detail").hidden, false);
  assert.match(f.q("detail-text").textContent, /DAT morning/);
  assert.equal(f.q("rows").children.length, 1);
  f.mounted.dispose();
});

test("editing a reviewed save name invalidates that review", async () => {
  const f = fixture();
  await f.open();
  f.input("label", "Original");
  f.q("save").click();
  f.input("label", "Changed");
  assert.equal(f.q("review").hidden, true);
  assert.equal(f.q("apply").disabled, true);
  assert.equal(f.store.document.entries.length, 0);
  f.mounted.dispose();
});

test("row selection exposes the exact public account and historical scope", async () => {
  const f = fixture({ initial: sampleLibrary() });
  await f.open();
  assert.equal(f.q("rows").children.length, 3);
  f.select("EMA 取得済み");
  assert.match(f.q("detail-text").textContent, /EMA/);
  assert.match(f.q("detail-text").textContent, /Base Sepolia/);
  assert.match(f.q("detail-text").textContent, /30/);
  assert.equal(f.restored.length, 0);
  f.q("restore").click();
  assert.equal(f.q("review").hidden, false);
  f.q("apply").click(); await f.settled();
  assert.equal(f.restored.length, 1);
  assert.equal(f.restored[0].draft.plan.context.agent, "EMA");
  f.mounted.dispose();
});

test("token, archive and text filters only affect visible rows", async () => {
  const f = fixture({ initial: sampleLibrary() });
  await f.open();
  f.input("agent", "DAT", "change");
  assert.equal(f.q("rows").children.length, 1);
  f.input("archive", "all", "change");
  assert.equal(f.q("rows").children.length, 2);
  f.input("search", "古い");
  assert.equal(f.q("rows").children.length, 1);
  assert.equal(f.store.document.entries.length, 4);
  assert.deepEqual(f.store.calls, [["read"]]);
  f.mounted.dispose();
});

test("rename renders untrusted HTML-looking labels as text", async () => {
  const f = fixture({ initial: sampleLibrary() });
  await f.open();
  f.select("DAT 途中");
  f.input("rename", "<img src=x onerror=alert(1)>");
  f.q("rename-save").click(); await f.settled();
  assert.equal(f.store.document.entries[0].label, "<img src=x onerror=alert(1)>");
  assert.equal(walk(f.parent).filter(node => node.tagName === "IMG").length, 0);
  assert.match(f.q("detail-text").textContent, /<img/);
  f.mounted.dispose();
});

test("purge control requires archive and explicit acknowledgement", async () => {
  const f = fixture({ initial: sampleLibrary() });
  await f.open();
  f.select("DAT 途中");
  assert.equal(f.q("purge-ack").disabled, true);
  f.q("archive-save").click(); await f.settled();
  assert.equal(f.q("purge-ack").disabled, false);
  assert.equal(f.q("purge").disabled, true);
  f.q("purge-ack").checked = true;
  f.q("purge-ack").dispatchEvent(new Event("change"));
  assert.equal(f.q("purge").disabled, false);
  f.q("purge").click(); await f.settled();
  assert.equal(f.store.document.entries.length, 3);
  assert.equal(f.q("detail").hidden, true);
  f.mounted.dispose();
});

test("purge acknowledgement does not transfer to a newly selected record", async () => {
  const f = fixture({ initial: sampleLibrary() });
  await f.open();
  f.input("archive", "all", "change");
  f.select("DAT 古い保管");
  f.q("purge-ack").checked = true;
  f.q("purge-ack").dispatchEvent(new Event("change"));
  f.select("EMA 取得済み");
  assert.equal(f.q("purge-ack").checked, false);
  assert.equal(f.q("purge").disabled, true);
  f.mounted.dispose();
});

test("JSON import previews additions and CSV export follows visible filters", async () => {
  const f = fixture();
  await f.open();
  await f.file((await preparePeriodLibraryFile(sampleLibrary())).text);
  assert.equal(f.store.document.entries.length, 0);
  assert.equal(f.q("review").hidden, false);
  f.q("apply").click(); await f.settled();
  f.input("agent", "CAWELON", "change");
  f.q("export-csv").click(); await f.settled();
  assert.equal(f.files[0].rows, 1);
  assert.ok(f.files[0].text.includes("blocked"));
  f.q("export-all").click(); await f.settled();
  assert.equal((await decodePeriodLibraryFile(f.files[1].text)).document.entries.length, 4);
  f.mounted.dispose();
});

test("a storage quota error remains visible and cannot present a success state", async () => {
  const store = memoryStorage(undefined, { beforeChange() { throw { code: "CHECKPOINT_QUOTA" }; } });
  const f = fixture({ store });
  await f.open();
  f.input("label", "Quota");
  f.q("save").click();
  f.q("apply").click(); await f.settled();
  assert.equal(f.q("status").getAttribute("data-error"), "true");
  assert.equal(f.q("save").disabled, true);
  assert.equal(f.store.document.entries.length, 0);
  f.mounted.dispose();
});

test("disposing the panel removes visible content and closes storage once", () => {
  const f = fixture();
  const refresh = f.q("refresh");
  f.mounted.dispose(); f.mounted.dispose();
  refresh.click();
  assert.equal(f.parent.children.length, 0);
  assert.deepEqual(f.store.calls, [["close"]]);
});

function periodController(options = {}) {
  const calls = [];
  const controller = createPeriodController({
    getContext: agent => context(agent),
    read: async (agent, selected, config) => {
      calls.push([agent, selected]);
      return collectPeriod(periodSession(selected).session, selected, config);
    },
    ...options,
  });
  return { controller, calls };
}

test("restored period draft requires review and never starts network reading automatically", async () => {
  const f = periodController();
  assert.equal(f.controller.stageSaved(checkpoint(3), { requiresNewPlan: false }), true);
  assert.equal(f.controller.state.draft, null);
  assert.equal(f.controller.state.review.source, "library");
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.apply(), true);
  assert.equal(f.controller.state.checkedThisSession, false);
  assert.equal(f.controller.state.origin, "imported");
  assert.equal(f.calls.length, 0);
  assert.equal(await f.controller.start(), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.state.draft.records.length, 3);
  f.controller.dispose();
});

test("replacing an acquired working draft with a library entry requires acknowledgement", () => {
  const f = periodController();
  f.controller.stageSaved(checkpoint(3), { requiresNewPlan: false });
  f.controller.apply();
  const key = periodDraftKey(f.controller.state.draft);
  f.controller.stageSaved(checkpoint(5), { requiresNewPlan: false });
  assert.equal(f.controller.state.review.requiresReplacement, true);
  assert.equal(f.controller.apply(), false);
  assert.equal(periodDraftKey(f.controller.state.draft), key);
  assert.equal(f.controller.apply(true), true);
  assert.equal(f.controller.state.draft.records.length, 3);
});

test("stored quarantine survives reopen and prevents reading until a new plan", async () => {
  const f = periodController();
  f.controller.stageSaved(checkpoint(3), { requiresNewPlan: true });
  f.controller.apply();
  assert.equal(f.controller.state.requiresNewPlan, true);
  assert.equal(await f.controller.start(), false);
  assert.equal(f.controller.state.error, "PERIOD_NEW_PLAN_REQUIRED");
  assert.equal(f.calls.length, 0);
});

test("re-staging the same rejected draft cannot clear quarantine in that screen", async () => {
  const f = periodController();
  f.controller.stageSaved(checkpoint(3), { requiresNewPlan: true });
  f.controller.apply();
  f.controller.stageSaved(checkpoint(3), { requiresNewPlan: false });
  f.controller.apply();
  assert.equal(f.controller.state.requiresNewPlan, true);
  assert.equal(await f.controller.start(), false);
});

test("library restore on a different account can be inspected but cannot read that account", async () => {
  const selected = context("EMA", 84532);
  const f = periodController();
  f.controller.stageSaved(checkpoint(3, plan({}, selected)), { requiresNewPlan: false });
  f.controller.apply();
  assert.equal(f.controller.state.agent, "EMA");
  assert.equal(await f.controller.start(), false);
  assert.equal(f.controller.state.error, "PERIOD_CONTEXT_MISMATCH");
  assert.equal(f.calls.length, 0);
});

test("malformed saved candidate clears any old preview without losing current draft", () => {
  const f = periodController();
  f.controller.stageSaved(checkpoint(3), { requiresNewPlan: false });
  f.controller.apply();
  const key = periodDraftKey(f.controller.state.draft);
  assert.equal(f.controller.stageSaved({}, { requiresNewPlan: false }), false);
  assert.equal(f.controller.state.review, null);
  assert.equal(periodDraftKey(f.controller.state.draft), key);
});

test("saved draft cannot replace work while acquisition is active", async () => {
  const gate = deferred();
  const f = periodController({ read: () => gate.promise });
  f.controller.stageSaved(checkpoint(0), { requiresNewPlan: false });
  f.controller.apply();
  const pending = f.controller.start();
  assert.equal(f.controller.stageSaved(checkpoint(3), { requiresNewPlan: false }), false);
  assert.equal(f.controller.state.error, "PERIOD_BUSY");
  f.controller.cancel();
  gate.resolve(checkpoint(5));
  assert.equal(await pending, false);
});

test("period panel bridge refuses to snapshot active acquisition", async () => {
  const parent = new Element("div"), document = { createElement: tag => new Element(tag) };
  const gate = deferred();
  const mounted = mountPeriodPanel({
    parent, document, getContext: agent => context(agent), read: () => gate.promise,
  });
  assert.equal(mounted.getCheckpoint(), null);
  mounted.stageSaved(checkpoint(0), { requiresNewPlan: false });
  parent.find("period-apply").click();
  parent.find("period-start").click();
  assert.throws(() => mounted.getCheckpoint(), error => error.code === "PERIOD_BUSY");
  mounted.dispose();
  gate.resolve(checkpoint(5));
  await tick();
});

test("sanitized error text never falls back to raw untrusted error content", () => {
  assert.equal(libraryErrorText("raw secret from provider"), libraryErrorText(undefined));
  assert.ok(!libraryErrorText("raw secret from provider").includes("raw secret"));
  assert.match(libraryEntryText(entry(1, { requiresNewPlan: true })), /再取得/);
  assert.match(libraryComparisonText({ kind: "changed-evidence", changedParts: ["earlier"], before: { completed: 2, total: 5 }, after: { completed: 3, total: 5 } }), /通信を行いません/);
});
