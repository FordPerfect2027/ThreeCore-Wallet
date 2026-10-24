import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountReportSetPanel } from "../examples/report-set-panel.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { sequenceHistory, sequenceSet, demoSetHistory, historyMemory, historyDocument,
  clone, id, AFTER, fileFrom, waitUntil, deferred } from "./helpers/report-set-fixtures.js";

function fixture(initial = sequenceHistory(), options = {}) {
  const document = { createElement: tag => new Element(tag) }, parent = new Element("div");
  const store = options.store ?? historyMemory(initial), files = [];
  const mounted = mountReportSetPanel({ document, parent, storage: store.storage,
    now: () => AFTER, download: file => files.push(file), ...options.panel });
  const q = name => parent.find("report-set-" + name);
  const f = { document, parent, store, files, mounted, q,
    click(name) { assert.equal(q(name).disabled, false, "Disabled: " + name); q(name).click(); },
    set(name, value, event = "change") { q(name).value = value; q(name).dispatchEvent(new Event(event)); },
    check(name, value = true) { q(name).checked = value; q(name).dispatchEvent(new Event("change")); },
    choice(number, checked = true) {
      const control = q("choices").children.find(label => label.children[0].value === id(100 + number)).children[0];
      control.checked = checked; control.dispatchEvent(new Event("change"));
    },
    async settled() { await waitUntil(() => q("panel").getAttribute("aria-busy") === "false"); },
    async load() { f.click("refresh"); await f.settled(); },
    async accept() {
      await f.load(); f.click("select-visible"); f.click("prepare"); f.click("apply"); await f.settled();
    },
    async file(text) {
      q("file").files = [fileFrom(text)];
      q("file").dispatchEvent(new Event("change")); await f.settled();
    },
    dispose() { mounted.dispose(); },
  };
  return f;
}

test("set panel mounts with accessible labels and no reads or wallet calls", () => {
  const f = fixture();
  assert.deepEqual(f.store.calls, []);
  assert.equal(f.q("panel").getAttribute("aria-label"), "複数の保存報告の期間確認");
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  for (const name of ["prepare", "apply", "json", "html", "csv", "inspect"]) {
    assert.equal(f.q(name).disabled, true, name);
  }
  assert.equal(f.q("file").disabled, false);
  f.dispose();
});

test("loading retains explicit empty selection and native checkboxes", async () => {
  const f = fixture(); await f.load();
  assert.equal(f.q("choices").children.length, 3);
  assert.match(f.q("count").textContent, /3\/3/);
  assert.match(f.q("selection-count").textContent, /選択 0件/);
  assert.equal(f.mounted.getState().selection.length, 0);
  assert.ok(f.q("choices").children.every(label => label.children[0].type === "checkbox"));
  f.dispose();
});

test("selection changes keep focused checkbox nodes and do not duplicate handlers", async () => {
  const f = fixture(); await f.load();
  const first = f.q("choices").children[0].children[0];
  f.choice(1); f.choice(2); f.choice(1, false); f.choice(1);
  assert.equal(f.q("choices").children[0].children[0], first);
  assert.deepEqual(f.mounted.getState().selection, [id(102), id(101)]);
  assert.equal(f.q("prepare").disabled, false);
  f.dispose();
});

test("filtering never silently deselects hidden reports", async () => {
  const f = fixture(); await f.load(); f.choice(1); f.choice(2);
  f.set("search", "報告 3", "input");
  assert.match(f.q("count").textContent, /1\/3/);
  assert.match(f.q("selection-count").textContent, /選択 2件（絞り込み対象外 2件）/);
  f.click("select-visible");
  assert.deepEqual(f.mounted.getState().selection, [id(101), id(102), id(103)]);
  f.click("prepare");
  assert.match(f.q("review-text").textContent, /報告 1/);
  assert.match(f.q("review-text").textContent, /報告 3/);
  assert.equal(f.mounted.getState().input, null);
  f.dispose();
});

test("clearing selection clears hidden choices too", async () => {
  const f = fixture(); await f.load(); f.click("select-visible");
  f.set("search", "報告 2", "input"); f.click("clear-selection");
  assert.equal(f.mounted.getState().selection.length, 0);
  assert.equal(f.q("prepare").disabled, true);
  f.set("search", "", "input");
  assert.ok(f.q("choices").children.every(label => !label.children[0].checked));
  f.dispose();
});

test("archive filtering adds an archived report explicitly without restoring it", async () => {
  const f = fixture(demoSetHistory()); await f.load();
  assert.match(f.q("count").textContent, /6\/7/);
  f.set("archive", "archived");
  assert.match(f.q("count").textContent, /1\/7/);
  f.click("select-visible"); f.click("prepare");
  assert.match(f.q("review-text").textContent, /CAWELON取得途中（非表示保管）/);
  f.click("apply"); await f.settled();
  assert.equal(f.mounted.getState().result.archivedCount, 1);
  assert.equal(f.store.document.entries[6].archived, true);
  f.dispose();
});

test("invalid filter input shows a useful message and preserves selected evidence", async () => {
  const f = fixture(); await f.load(); f.choice(1);
  f.set("search", "bad\n", "input");
  assert.equal(f.q("select-visible").disabled, true);
  assert.match(f.q("count").textContent, /検索条件/);
  assert.deepEqual(f.mounted.getState().selection, [id(101)]);
  f.set("search", "報告", "input");
  assert.equal(f.q("select-visible").disabled, false);
  f.dispose();
});

test("review and application are separate actions with three token cards", async () => {
  const f = fixture(); await f.load(); f.click("select-visible"); f.click("prepare");
  assert.equal(f.q("review").hidden, false);
  assert.equal(f.q("result").hidden, true);
  f.click("apply"); await f.settled();
  assert.equal(f.q("review").hidden, true);
  assert.equal(f.q("result").hidden, false);
  assert.equal(f.q("cards").children.length, 3);
  assert.ok(f.q("cards").children.every(card => card.getAttribute("data-state") === "continuous"));
  assert.match(f.q("summary").textContent, /3トークンとも期間境界で一致/);
  assert.match(f.q("check-count").textContent, /追加確認箇所は見つかりません/);
  f.dispose();
});

test("editing the name invalidates a pending review", async () => {
  const f = fixture(); await f.load(); f.choice(1); f.click("prepare");
  f.set("title", "new name", "input");
  assert.equal(f.q("apply").disabled, true);
  assert.equal(f.q("review").hidden, true);
  f.dispose();
});

test("source change during review is shown and never overwrites old accepted evidence", async () => {
  const f = fixture(); await f.accept();
  const accepted = f.mounted.getState().input;
  f.click("prepare");
  const changed = clone(f.store.document); changed.entries[0].note = "changed";
  f.store.replace(changed);
  f.click("apply"); await f.settled();
  assert.match(f.q("status").textContent, /確認中に選択した報告が変わりました/);
  assert.equal(f.mounted.getState().input, accepted);
  assert.equal(f.q("result").hidden, false);
  f.dispose();
});

test("source inspection keeps the frozen set and describes later metadata changes", async () => {
  const f = fixture(); await f.accept();
  const changed = clone(f.store.document); changed.entries[0].label = "renamed";
  f.store.replace(changed);
  f.click("inspect"); await f.settled();
  assert.match(f.q("inspection").textContent, /名前・メモ・保管状態が変更/);
  assert.equal(f.mounted.getState().input.entries[0].label, "報告 1");
  assert.ok(f.store.calls.every(call => call[0] === "read"));
  f.dispose();
});

test("new result clears export acknowledgement; selection editing does not replace that result", async () => {
  const f = fixture(); await f.accept(); f.check("ack");
  assert.equal(f.q("json").disabled, false);
  f.click("clear-selection"); f.choice(1);
  assert.equal(f.q("json").disabled, false);
  f.click("prepare"); f.click("apply"); await f.settled();
  assert.equal(f.q("ack").checked, false);
  assert.equal(f.q("json").disabled, true);
  f.dispose();
});

test("privacy controls apply to explanation files while JSON retains complete evidence", async () => {
  const f = fixture(); await f.accept(); f.check("ack");
  f.click("html"); await f.settled();
  assert.ok(!f.files[0].text.includes("確認用メモ 1"));
  f.check("notes"); f.check("short-addresses", false);
  f.click("csv"); await f.settled();
  assert.ok(f.files[1].text.includes("確認用メモ 1"));
  f.check("notes", false); f.check("short-addresses");
  f.click("json"); await f.settled();
  const imported = await decodeReportSetFile(f.files[2].text);
  assert.equal(imported.input.entries[0].note, "確認用メモ 1");
  assert.ok(f.q("json-help").textContent.includes("適用されません"));
  f.dispose();
});

test("JSON import stages a review before display and never inserts history rows", async () => {
  const f = fixture(historyDocument());
  await f.file((await prepareReportSetFile(sequenceSet())).text);
  assert.equal(f.q("review").hidden, false);
  assert.equal(f.q("result").hidden, true);
  assert.equal(f.q("file").value, "");
  f.click("apply"); await f.settled();
  assert.match(f.q("origin").textContent, /確認セットJSON/);
  assert.equal(f.store.document.entries.length, 0);
  assert.equal(f.files.length, 0);
  f.dispose();
});

test("tampered file keeps previous output visible and reports checksum failure", async () => {
  const f = fixture(); await f.accept();
  const accepted = f.mounted.getState().input;
  const file = JSON.parse((await prepareReportSetFile(sequenceSet())).text);
  file.input.title = "tampered";
  await f.file(JSON.stringify(file));
  assert.equal(f.mounted.getState().input, accepted);
  assert.equal(f.q("review").hidden, true);
  assert.equal(f.q("status").getAttribute("data-error"), "true");
  f.dispose();
});

test("diagnostic filtering narrows visible checks without changing the result", async () => {
  const f = fixture(demoSetHistory()); await f.accept();
  const accepted = f.mounted.getState().result;
  assert.ok(f.q("check-list").children.length > 0);
  f.set("check-agent", "EMA"); f.set("check-severity", "conflict");
  assert.ok(f.q("check-list").children.length > 0);
  assert.ok(f.q("check-list").children.every(item => item.getAttribute("data-severity") === "conflict"));
  f.set("check-search", "not present", "input");
  assert.equal(f.q("check-list").children.length, 0);
  assert.match(f.q("check-count").textContent, /^0\//);
  assert.equal(f.mounted.getState().result, accepted);
  f.dispose();
});

test("diagnostic malformed query never reports zero unresolved checks", async () => {
  const f = fixture(demoSetHistory()); await f.accept();
  f.set("check-search", "\n", "input");
  assert.match(f.q("check-count").textContent, /検索条件を確認/);
  assert.equal(f.q("check-list").children.length, 0);
  f.dispose();
});

test("all untrusted names are rendered as text nodes, including diagnostics", async () => {
  const source = clone(sequenceHistory([0n, 24n]));
  source.entries[0].label = "<img src=x onerror=alert(1)>";
  const f = fixture(source); await f.accept();
  assert.match(f.q("choices").children[0].children[1].textContent, /<img/);
  assert.ok(f.q("check-list").children[0].children[1].textContent.includes("<img"));
  const walk = node => [node, ...node.children.flatMap(walk)];
  assert.ok(!walk(f.parent).some(node => ["IMG", "SCRIPT", "IFRAME"].includes(node.tagName)));
  f.dispose();
});

test("busy state disables edits and cancelling suppresses a late read", async () => {
  const gate = deferred();
  const store = historyMemory(sequenceHistory(), { beforeRead: () => gate.promise });
  const f = fixture(undefined, { store });
  f.click("refresh");
  assert.equal(f.q("panel").getAttribute("aria-busy"), "true");
  assert.equal(f.q("file").disabled, true);
  assert.equal(f.q("title").disabled, true);
  f.click("cancel"); gate.resolve();
  await f.settled();
  assert.equal(f.mounted.getState().loaded, false);
  assert.equal(f.q("choices").children.length, 0);
  f.dispose();
});

test("panel disposal removes listeners and closes only its own storage adapter", async () => {
  const f = fixture(); await f.load();
  const refresh = f.q("refresh"), checkbox = f.q("choices").children[0].children[0];
  f.dispose();
  const before = f.store.calls.length;
  refresh.click(); checkbox.checked = true; checkbox.dispatchEvent(new Event("change"));
  assert.equal(f.store.calls.length, before);
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.store.closed, true);
  assert.equal(f.mounted.getState().disposed, true);
});
