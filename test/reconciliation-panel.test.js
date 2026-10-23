import test from "node:test";
import assert from "node:assert/strict";
import { mountReconciliationPanel } from "../examples/reconciliation-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { scenario, workspace, previewWorkspace, deferred, tick, fileFrom, record, archive, event } from "./helpers/reconciliation-fixtures.js";
import { prepareReconciliationFile } from "../src/reconciliation-file.js";
import { reconciliationKey } from "../src/reconciliation-model.js";

function fixture(options = {}) {
  const parent = new Element("div");
  const document = { createElement: name => new Element(name), body: new Element("body") };
  const downloads = [];
  const app = mountReconciliationPanel({ document, parent,
    readObservation: agent => scenario(agent).earlier,
    readArchive: agent => scenario(agent).archive,
    download: file => downloads.push(file), ...options });
  const q = name => parent.find("reconciliation-" + name);
  return { app, parent, q, downloads,
    click(name) { assert.equal(q(name).disabled, false, name); q(name).click(); },
    input(name, value, type = "change") { q(name).value = value; q(name).dispatchEvent(new Event(type)); },
    ack() { q("ack").checked = true; q("ack").dispatchEvent(new Event("change")); },
    async import(file) {
      q("file").files = [file];
      q("file").dispatchEvent(new Event("change"));
      for (let attempt = 0; attempt < 100 && q("panel").getAttribute("aria-busy") === "true"; attempt++) await tick();
      assert.equal(q("panel").getAttribute("aria-busy"), "false");
    },
  };
}

test("panel labels every input and starts with a non-destructive empty state", () => {
  const f = fixture();
  try {
    for (const name of ["agent", "import-kind", "file", "filter-agent", "direction", "search", "ack"]) {
      assert.ok(f.q(name).getAttribute("aria-label"));
    }
    assert.equal(f.q("panel").getAttribute("aria-label"), "残高と履歴の照合");
    assert.equal(f.q("status").getAttribute("role"), "status");
    assert.equal(f.q("status").getAttribute("aria-live"), "polite");
    assert.equal(f.q("review").hidden, true);
    assert.equal(f.q("clear").disabled, true);
    assert.equal(f.q("apply").disabled, true);
    assert.equal(f.q("undo").disabled, true);
    assert.equal(f.q("redo").disabled, true);
  } finally { f.app.dispose(); }
});

test("changing selected token updates all three source descriptions", () => {
  const f = fixture({ initial: previewWorkspace() });
  try {
    f.input("agent", "CAWELON");
    assert.match(f.q("input-earlier").textContent, /CAWELON/);
    assert.match(f.q("input-later").textContent, /CAWELON/);
    assert.match(f.q("input-archive").textContent, /2期間/);
    assert.match(f.q("evidence").textContent, /CAWELONの計算に使う元記録/);
  } finally { f.app.dispose(); }
});

test("all source removals require acknowledgement before applying", () => {
  const f = fixture({ initial: workspace() });
  try {
    for (const part of ["earlier", "later", "archive"]) {
      f.click("remove-" + part);
      assert.equal(f.q("apply").disabled, true);
      assert.equal(f.q("review").hidden, false);
      f.ack();
      f.click("apply");
      assert.equal(f.q("input-" + part).textContent, "未登録");
      assert.equal(f.q("remove-" + part).disabled, true);
      f.click("undo");
      assert.notEqual(f.q("input-" + part).textContent, "未登録");
    }
  } finally { f.app.dispose(); }
});

test("source invalidation removes actionable stale capture preview", () => {
  const f = fixture();
  try {
    f.click("capture-earlier");
    assert.equal(f.q("apply").disabled, false);
    f.app.invalidateSources();
    assert.equal(f.q("review").hidden, true);
    assert.equal(f.q("apply").disabled, true);
    assert.equal(f.q("input-earlier").textContent, "未登録");
  } finally { f.app.dispose(); }
});

test("import disables mutation controls and cancel immediately releases them", async () => {
  const gate = deferred();
  const f = fixture({ controllerOptions: { readFile: async () => gate.promise } });
  try {
    f.q("file").files = [fileFrom("{}")];
    f.q("file").dispatchEvent(new Event("change"));
    assert.equal(f.q("file").value, "");
    for (const name of ["capture-earlier", "capture-later", "capture-archive", "calculate", "file", "import-kind", "export-json"]) {
      assert.equal(f.q(name).disabled, true, name);
    }
    assert.equal(f.q("cancel").disabled, false);
    f.click("cancel");
    gate.resolve(previewWorkspace());
    await tick();
    assert.equal(f.q("review").hidden, true);
    assert.equal(f.q("file").disabled, false);
    assert.equal(f.q("capture-earlier").disabled, false);
  } finally { f.app.dispose(); }
});

test("file-selection cancellation does not clear current records", async () => {
  const f = fixture({ initial: workspace() });
  try {
    const before = reconciliationKey(f.app.getWorkspace());
    f.q("file").files = [];
    f.q("file").dispatchEvent(new Event("change"));
    await tick();
    assert.equal(reconciliationKey(f.app.getWorkspace()), before);
    assert.equal(f.q("status").getAttribute("data-error"), "false");
  } finally { f.app.dispose(); }
});

test("import kind changes dismiss review without touching working evidence", async () => {
  const f = fixture();
  try {
    await f.import(fileFrom((await prepareReconciliationFile(workspace())).text));
    assert.equal(f.q("review").hidden, false);
    f.input("import-kind", "earlier");
    assert.equal(f.q("review").hidden, true);
    assert.equal(f.q("input-earlier").textContent, "未登録");
  } finally { f.app.dispose(); }
});

test("calculation shows per-token state and enables exports only for current report", () => {
  const f = fixture({ initial: previewWorkspace() });
  try {
    for (const name of ["text", "summary", "events", "ledger", "windows"]) assert.equal(f.q("export-" + name).disabled, true);
    f.click("calculate");
    for (const name of ["text", "summary", "events", "ledger", "windows"]) assert.equal(f.q("export-" + name).disabled, false);
    assert.match(f.q("result-DAT").textContent, /計算が一致/);
    assert.equal(f.q("verdict").textContent, "保存した記録の計算が一致");
    assert.deepEqual(f.q("amounts").children.map(child => child.textContent),
      ["残高の増減", "7 DAT", "履歴による増減", "7 DAT", "説明できない差額", "0 DAT"]);
    assert.equal(f.q("result").getAttribute("data-result-status"), "arithmetic-agreement");
    assert.match(f.q("result-EMA").textContent, /差額: 2 EMA/);
    assert.match(f.q("result-CAWELON").textContent, /未取得: 37 ～ 39/);
    f.click("clear");
    f.ack();
    f.click("apply");
    assert.equal(f.q("export-summary").disabled, true);
    assert.match(f.q("result-DAT").textContent, /まだ照合していません/);
  } finally { f.app.dispose(); }
});

test("paged result table bounds rendered rows and responds to search", () => {
  const slot = scenario();
  slot.archive = archive([record(30, 42, Array.from({ length: 55 }, (_, index) => event({ amountBaseUnits: "1" }, index)))]);
  const f = fixture({ initial: workspace([slot]) });
  try {
    f.click("calculate");
    assert.equal(f.q("event-rows").children.length, 25);
    assert.equal(f.q("previous").disabled, true);
    f.click("next");
    f.click("next");
    assert.equal(f.q("event-rows").children.length, 5);
    assert.equal(f.q("next").disabled, true);
    f.input("search", "missing", "input");
    assert.equal(f.q("event-rows").children.length, 0);
    assert.match(f.q("pagination").textContent, /0件/);
    f.input("search", "\u0000", "input");
    assert.match(f.q("pagination").textContent, /検索条件/);
  } finally { f.app.dispose(); }
});

test("downloads are independent output artifacts and do not overwrite source state", async () => {
  const f = fixture({ initial: previewWorkspace() });
  try {
    const before = reconciliationKey(f.app.getWorkspace());
    f.click("calculate");
    for (const name of ["json", "text", "summary", "events", "ledger", "windows"]) {
      f.click("export-" + name);
      for (let attempt = 0; attempt < 100 && f.q("panel").getAttribute("aria-busy") === "true"; attempt++) await tick();
    }
    assert.equal(f.downloads.length, 6);
    assert.equal(new Set(f.downloads.map(file => file.filename)).size, 6);
    assert.equal(reconciliationKey(f.app.getWorkspace()), before);
    assert.match(f.q("export-status").textContent, /開始済み/);
  } finally { f.app.dispose(); }
});

test("dispose removes listeners and host, and can be called twice", () => {
  const f = fixture();
  const button = f.q("capture-earlier");
  const status = f.q("status");
  const before = status.textContent;
  f.app.dispose();
  f.app.dispose();
  button.click();
  assert.equal(status.textContent, before);
  assert.equal(f.parent.children.length, 0);
});
