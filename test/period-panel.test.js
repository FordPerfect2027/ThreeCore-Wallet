import test from "node:test";
import assert from "node:assert/strict";
import { mountPeriodPanel } from "../examples/period-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { collectPeriod } from "../src/period-reader.js";
import { preparePeriodFile } from "../src/period-file.js";
import { periodDraftKey } from "../src/period-draft.js";
import { context, checkpoint, plan, periodSession, fileFrom, deferred, tick } from "./helpers/period-fixtures.js";

function fixture(options = {}) {
  const parent = new Element("div");
  const document = { createElement: tag => new Element(tag) };
  const files = [];
  const deliveries = [];
  let reads = 0;
  const mounted = mountPeriodPanel({ document, parent,
    getContext: agent => context(agent),
    read: (agent, selected, config) => {
      reads++;
      return collectPeriod(periodSession(selected).session, selected, config);
    },
    stageWorkspace: (workspace, agent) => { deliveries.push({ workspace, agent }); return true; },
    download: value => files.push(value), ...options,
  });
  const q = name => parent.find("period-" + name);
  function input(name, value, event = "input") {
    q(name).value = value;
    q(name).dispatchEvent(new Event(event));
  }
  async function settled() {
    for (let i = 0; i < 500 && q("panel").getAttribute("aria-busy") === "true"; i++) await tick();
    assert.equal(q("panel").getAttribute("aria-busy"), "false");
  }
  return { parent, mounted, q, files, deliveries, input, settled, get reads() { return reads; },
    plan() { input("earlier", "30"); input("later", "42"); input("window-size", "5"); q("prepare").click(); },
    async file(text) { q("file").files = [fileFrom(text)]; q("file").dispatchEvent(new Event("change")); await settled(); },
    ack() { q("ack").checked = true; q("ack").dispatchEvent(new Event("change")); },
  };
}

test("period panel labels controls and exposes no active read action on mount", () => {
  const f = fixture();
  try {
    assert.equal(f.reads, 0);
    assert.equal(f.q("panel").getAttribute("aria-busy"), "false");
    assert.equal(f.q("start").disabled, true);
    assert.equal(f.q("save").disabled, true);
    assert.equal(f.q("send").disabled, true);
    assert.match(f.q("intro").textContent, /途中で停止/);
    assert.match(f.q("files-note").textContent, /暗号化されていません/);
    assert.equal(f.q("file").accept, ".json,application/json");
  } finally { f.mounted.dispose(); }
});

test("period panel separates planning, adoption and network reading", async () => {
  const f = fixture();
  try {
    f.plan();
    assert.equal(f.q("review").hidden, false);
    assert.match(f.q("review-text").textContent, /31 ～ 42/);
    assert.equal(f.mounted.getDraft(), null);
    f.q("apply").click();
    assert.equal(f.reads, 0);
    assert.equal(f.q("progress").value, 0);
    f.q("start").click(); await f.settled();
    assert.equal(f.reads, 1);
    assert.equal(f.q("before-amount").textContent, "100 DAT");
    assert.equal(f.q("after-amount").textContent, "107 DAT");
    assert.equal(f.q("progress").value, 5);
    assert.equal(f.q("rows").children.length, 3);
  } finally { f.mounted.dispose(); }
});

test("period panel does not silently replace existing progress", async () => {
  const f = fixture();
  try {
    await f.file((await preparePeriodFile(checkpoint(3))).text);
    f.q("apply").click();
    const old = periodDraftKey(f.mounted.getDraft());
    f.plan();
    assert.equal(f.q("apply").disabled, true);
    assert.equal(f.q("start").disabled, true);
    f.q("apply").click();
    assert.equal(periodDraftKey(f.mounted.getDraft()), old);
    f.ack();
    assert.equal(f.q("apply").disabled, false);
    f.q("apply").click();
    assert.equal(f.q("progress").value, 0);
  } finally { f.mounted.dispose(); }
});

test("editing any planning input invalidates the pending plan", () => {
  const f = fixture();
  try {
    for (const [name, value] of [["earlier", "31"], ["later", "43"], ["window-size", "6"]]) {
      f.plan();
      f.input(name, value);
      assert.equal(f.q("review").hidden, true);
      assert.equal(f.q("apply").disabled, true);
      assert.equal(f.mounted.getDraft(), null);
    }
  } finally { f.mounted.dispose(); }
});

test("restoring an EMA plan updates selected token and visible interval fields", async () => {
  const f = fixture();
  try {
    const selected = plan({ earlierBlock: "100", laterBlock: "130", windowSize: 10 }, context("EMA"));
    await f.file((await preparePeriodFile(checkpoint(0, selected))).text);
    f.q("apply").click();
    assert.equal(f.q("agent").value, "EMA");
    assert.equal(f.q("earlier").value, "100");
    assert.equal(f.q("later").value, "130");
    assert.equal(f.q("window-size").value, "10");
    assert.equal(f.reads, 0);
  } finally { f.mounted.dispose(); }
});

test("download buttons select independent draft, reconciliation and text formats", async () => {
  const f = fixture();
  try {
    await f.file((await preparePeriodFile(checkpoint())).text); f.q("apply").click();
    for (const name of ["save", "save-reconciliation", "save-text"]) { f.q(name).click(); await f.settled(); }
    assert.equal(f.files[0].filename, "ThreeCore-period-DAT.json");
    assert.equal(f.files[1].filename, "ThreeCore-balance-reconciliation.json");
    assert.equal(f.files[2].filename, "ThreeCore-period-summary.txt");
    assert.match(f.q("saved").textContent, /開始済み/);
  } finally { f.mounted.dispose(); }
});

test("period panel disables unsafe handoff after a known reorg", async () => {
  const f = fixture({ read: async () => { throw { code: "PERIOD_BLOCK_CHANGED" }; } });
  try {
    await f.file((await preparePeriodFile(checkpoint())).text); f.q("apply").click();
    f.q("start").click(); await f.settled();
    assert.equal(f.q("send").disabled, true);
    assert.equal(f.q("start").disabled, true);
    assert.equal(f.q("save-reconciliation").disabled, true);
    assert.equal(f.q("save").disabled, false);
    assert.match(f.q("badge").textContent, /再取得/);
    f.q("repair").click();
    assert.equal(f.q("review").hidden, false);
    assert.equal(f.q("apply").disabled, true);
    f.ack(); f.q("apply").click();
    assert.equal(f.q("start").disabled, false);
  } finally { f.mounted.dispose(); }
});

test("cancelled file import cannot show a late replacement review", async () => {
  const gate = deferred();
  const f = fixture({ controllerOptions: { readFile: () => gate.promise } });
  try {
    f.q("file").files = [fileFrom("{}")];
    f.q("file").dispatchEvent(new Event("change"));
    assert.equal(f.q("prepare").disabled, true);
    f.q("cancel").click();
    gate.resolve({ draft: checkpoint() });
    await tick();
    assert.equal(f.q("review").hidden, true);
    assert.equal(f.mounted.getDraft(), null);
  } finally { f.mounted.dispose(); }
});

test("disposal removes handlers and prevents later downloads", async () => {
  const gate = deferred();
  const f = fixture({ controllerOptions: { prepareFile: () => gate.promise } });
  f.plan(); f.q("apply").click();
  f.q("save").click();
  f.mounted.dispose();
  gate.resolve({ text: "late" });
  await tick();
  assert.equal(f.files.length, 0);
  assert.equal(f.parent.children.length, 0);
  f.mounted.dispose();
});
