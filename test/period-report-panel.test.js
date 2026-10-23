import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountPeriodReportPanel } from "../examples/period-report-panel.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { reportInput, reportLibrary, selection, id, memoryStorage, waitUntil, tick,
  fileFrom, walk, changedSlot, manyEventsInput, deferred, LATER } from "./helpers/period-report-fixtures.js";

function fixture(initial = reportLibrary(), options = {}) {
  const parent = new Element("div"), document = { createElement: tag => new Element(tag) };
  const store = options.store ?? memoryStorage(initial), files = [];
  const mounted = mountPeriodReportPanel({ document, parent, storage: store.storage,
    download: file => files.push(file), now: () => LATER, ...options.panel });
  const q = name => parent.find("period-report-" + name);
  const f = { parent, mounted, store, files, q,
    click(name) { assert.equal(q(name).disabled, false, "Disabled: " + name); q(name).click(); },
    set(name, value, event = "change") { q(name).value = value; q(name).dispatchEvent(new Event(event)); },
    async settled() { await waitUntil(() => q("panel").getAttribute("aria-busy") === "false"); },
    async choose() {
      f.click("refresh"); await f.settled();
      for (const [agent, value] of Object.entries(selection())) f.set("select-" + agent, value);
    },
    async build() { await f.choose(); f.click("prepare"); f.click("apply"); await f.settled(); },
    async import(input) {
      const file = await preparePeriodReportFile(input);
      q("file").files = [fileFrom(file.text)]; q("file").dispatchEvent(new Event("change"));
      await f.settled();
    },
    acknowledge() { q("export-ack").checked = true; q("export-ack").dispatchEvent(new Event("change")); },
    dispose() { mounted.dispose(); },
  };
  return f;
}

test("panel starts without reading local storage and uses an accessible status region", () => {
  const f = fixture();
  assert.deepEqual(f.store.calls, []);
  assert.equal(f.q("panel").getAttribute("aria-label"), "3トークンの保存期間レポート");
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  assert.equal(f.q("prepare").disabled, true);
  assert.equal(f.q("file").disabled, false);
  assert.equal(f.q("result").hidden, true);
  assert.equal(f.q("review").hidden, true);
  f.dispose();
});

test("read selectors show only each token and preserve no-selection option", async () => {
  const f = fixture(); f.click("refresh"); await f.settled();
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    const options = f.q("select-" + agent).children;
    assert.equal(options.length, 2);
    assert.equal(options[0].value, "");
    assert.ok(options[1].textContent.includes(agent));
    assert.ok(options[1].textContent.includes("chain 84532"));
    assert.equal(f.q("select-" + agent).value, "");
  }
  f.dispose();
});

test("review displays accounts and range before accepting the report", async () => {
  const f = fixture(); await f.choose(); f.click("prepare");
  assert.equal(f.q("review").hidden, false);
  assert.match(f.q("review-text").textContent, /30→42/);
  assert.match(f.q("review-text").textContent, /0x1111/);
  assert.equal(f.q("result").hidden, true);
  f.click("apply"); await f.settled();
  assert.equal(f.q("review").hidden, true);
  assert.equal(f.q("result").hidden, false);
  assert.equal(f.q("card-balance-DAT").textContent, "107 DAT");
  assert.equal(f.q("card-balance-EMA").textContent, "107 EMA");
  assert.equal(f.q("card-balance-CAWELON").textContent, "107 CAWELON");
  assert.equal(f.q("card-difference-DAT").textContent, "未説明の差: 0");
  f.dispose();
});

test("incomplete, archived and quarantined records are visible choices", async () => {
  const f = fixture(reportLibrary({ counts: [0, 3, 5], changes: { DAT: { archived: true }, CAWELON: { requiresNewPlan: true } } }));
  await f.build();
  assert.match(f.q("select-DAT").children[1].textContent, /途中.*非表示保管/);
  assert.match(f.q("select-CAWELON").children[1].textContent, /再取得/);
  assert.equal(f.q("card-balance-DAT").textContent, "未取得 DAT");
  assert.equal(f.q("card-status-CAWELON").textContent, "再取得が必要");
  assert.ok(f.q("issues").children.length >= 3);
  f.dispose();
});

test("text fields never become HTML elements", async () => {
  const f = fixture(reportLibrary({ changes: { DAT: { label: '<img src=x onerror="oops">' } } }));
  await f.choose(); f.set("title", "<script>oops</script>", "input"); f.click("prepare"); f.click("apply"); await f.settled();
  assert.equal(f.q("result-title").textContent, "<script>oops</script>");
  assert.match(f.q("card-text-DAT").textContent, /<img/);
  assert.equal(walk(f.parent).filter(node => ["SCRIPT", "IMG", "IFRAME"].includes(node.tagName)).length, 0);
  f.dispose();
});

test("changing a token selector clears stale report and export acknowledgement", async () => {
  const f = fixture(); await f.build(); f.acknowledge();
  assert.equal(f.q("json").disabled, false);
  f.set("select-EMA", "");
  assert.equal(f.q("result").hidden, true);
  assert.equal(f.q("export-ack").checked, false);
  assert.equal(f.q("json").disabled, true);
  f.dispose();
});

test("editing report name invalidates pending review", async () => {
  const f = fixture(); await f.choose(); f.click("prepare");
  f.set("title", "Changed name", "input");
  assert.equal(f.q("review").hidden, true);
  assert.equal(f.q("apply").disabled, true);
  f.dispose();
});

test("file import clears chooser and stages a review before display", async () => {
  const f = fixture(); await f.import(reportInput({ title: "From JSON" }));
  assert.equal(f.q("file").value, "");
  assert.equal(f.q("review").hidden, false);
  assert.match(f.q("review-text").textContent, /保存一覧には追加されません/);
  assert.equal(f.mounted.getReport(), null);
  f.click("apply"); await f.settled();
  assert.equal(f.mounted.getReport().title, "From JSON");
  assert.deepEqual(f.store.calls, []);
  f.dispose();
});

test("import parse failure retains accepted report and shows a safe status", async () => {
  const f = fixture(); await f.build();
  f.q("file").files = [fileFrom("malformed")]; f.q("file").dispatchEvent(new Event("change")); await f.settled();
  assert.equal(f.q("status").getAttribute("data-error"), "true");
  assert.match(f.q("status").textContent, /JSON/);
  assert.equal(f.mounted.getReport().status, "arithmetic-agreement");
  f.dispose();
});

for (const format of ["json", "csv", "html"]) {
  test("export button " + format + " follows acknowledgement and produces the requested file", async () => {
    const f = fixture(); await f.build();
    assert.equal(f.q(format).disabled, true);
    f.acknowledge(); f.click(format); await f.settled();
    assert.equal(f.files.length, 1);
    assert.equal(f.files[0].filename, "ThreeCore-period-report." + format);
    assert.equal(f.store.calls.filter(row => row[0] === "change").length, 0);
    f.dispose();
  });
}

test("pagination and filters do not change cards or the full report", async () => {
  const f = fixture(); await f.import(manyEventsInput()); f.click("apply"); await f.settled();
  const before = f.mounted.getReport();
  assert.equal(f.q("rows").children.length, 25);
  assert.equal(f.q("previous").disabled, true);
  f.click("next"); assert.equal(f.q("rows").children.length, 25);
  f.click("next"); assert.equal(f.q("rows").children.length, 7);
  assert.equal(f.q("next").disabled, true);
  f.set("direction", "outgoing");
  assert.equal(f.q("rows").children.length, 0);
  assert.match(f.q("event-count").textContent, /0\/57件.*1\/1ページ/);
  assert.equal(f.mounted.getReport(), before);
  f.set("direction", "all"); f.set("search", "no-result", "input");
  assert.equal(f.q("rows").children.length, 0);
  f.set("search", "", "input"); f.set("event-agent", "EMA");
  assert.equal(f.q("rows").children.length, 2);
  f.dispose();
});

test("cancelled refresh does not leave selection controls enabled with stale data", async () => {
  const gate = deferred();
  const store = memoryStorage(reportLibrary(), { beforeRead: () => gate.promise });
  const f = fixture(undefined, { store }); f.click("refresh");
  assert.equal(f.q("panel").getAttribute("aria-busy"), "true");
  assert.equal(f.q("file").disabled, true);
  f.click("cancel"); gate.resolve(); await tick();
  assert.equal(f.q("prepare").disabled, true);
  assert.equal(f.q("file").disabled, false);
  f.dispose();
});

test("dispose removes host and event handlers and closes storage exactly once", async () => {
  const f = fixture(); const button = f.q("refresh");
  f.dispose(); f.dispose(); button.click(); await tick();
  assert.equal(f.parent.children.length, 0);
  assert.deepEqual(f.store.calls, [["close"]]);
});

test("selected source changes are explained without constructing a stale report", async () => {
  const f = fixture(); await f.choose(); f.click("prepare");
  f.store.external({ kind: "rename", id: id(1), label: "Changed", time: LATER });
  f.click("apply"); await f.settled();
  assert.match(f.q("status").textContent, /変更/);
  assert.equal(f.q("result").hidden, true);
  assert.equal(f.q("review").hidden, true);
  f.dispose();
});
