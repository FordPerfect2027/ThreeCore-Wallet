import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountReportSetPanel } from "../examples/report-set-panel.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { prepareReportSetChecksFile, prepareReportSetComparisonFile, prepareReportSetCoverageFile, prepareReportSetComparisonEvidenceFile, reviewReportSetComparisonEvidence } from "../src/report-set-export.js";
import { decodePeriodReportFile } from "../src/period-report-file.js";
import { decodePeriodFile, preparePeriodFile } from "../src/period-file.js";
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

test("choosing a proposed window exports an unread draft and changes clear selection and acknowledgement", async () => {
  const initial = sequenceHistory([0n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); });
  const f = fixture(initial);
  try {
    await f.accept(); const before = f.mounted.getState().input;
    f.click("history-queue-show"); f.set("history-queue-window", "1"); f.click("history-queue-choose");
    assert.match(f.q("queue-window-selection").textContent, /36 ～ 42/); assert.equal(f.q("queue-window-json").disabled, true);
    f.check("ack"); f.click("queue-window-json");
    assert.equal(f.q("history-queue-size").disabled, true); assert.equal(f.q("history-queue-window").disabled, true);
    await f.settled(); assert.equal(f.files.length, 1);
    const decoded = await decodePeriodFile(f.files[0].text); assert.equal(decoded.draft.plan.earlierBlock, "35"); assert.equal(decoded.draft.plan.laterBlock, "42");
    assert.equal(decoded.draft.earlier, null); assert.equal(decoded.draft.records.length, 0);
    f.set("history-queue-size", "3", "input"); assert.equal(f.q("queue-window-json").disabled, true); assert.equal(f.q("ack").checked, false);
    f.click("history-queue-show"); f.set("history-queue-window", "2"); f.click("history-queue-choose");
    assert.match(f.q("queue-window-selection").textContent, /37 ～ 39/);
    assert.equal(f.mounted.getState().input, before);
    const oldChoose = f.q("history-queue-choose");
    await f.file((await prepareReportSetFile(sequenceSet())).text); f.click("apply"); await f.settled(); oldChoose.click();
    assert.match(f.q("queue-window-selection").textContent, /選択なし/); assert.equal(f.q("queue-window-json").disabled, true);
  } finally { f.dispose(); }
});

test("whole-page draft selection is offered only for contiguous windows and keeps the saved span exact", async () => {
  const transform = report => { const draft = report.slots[0].entry.draft; draft.earlier = null; draft.later = null; draft.records = []; };
  const f = fixture(sequenceHistory([0n], transform));
  try {
    await f.accept(); f.set("history-queue-size", "1", "input"); f.click("history-queue-show");
    assert.ok(f.q("history-queue-window").children.some(option => option.value === "page"));
    f.set("history-queue-window", "page"); f.click("history-queue-choose"); f.check("ack"); f.click("queue-window-json"); await f.settled();
    const decoded = await decodePeriodFile(f.files[0].text); assert.equal(decoded.draft.plan.earlierBlock, "32"); assert.equal(decoded.draft.plan.laterBlock, "42");
    await f.file((await prepareReportSetFile(sequenceSet(sequenceHistory([0n, 24n], transform)))).text);
    f.click("apply"); await f.settled(); f.click("history-queue-show");
    assert.ok(!f.q("history-queue-window").children.some(option => option.value === "page"));
    f.set("history-queue-window", "page"); assert.equal(f.q("history-queue-choose").disabled, true);
  } finally { f.dispose(); }
});

test("replacement comparison is readable and can be saved before applying with separate acknowledgement", async () => {
  const f = fixture();
  try {
    await f.accept(); const before = f.mounted.getState().input;
    const after = clone(sequenceSet()); after.entries[0].label = "<img src=x>"; after.entries[0].note = "PRIVATE_COMPARISON_NOTE";
    await f.file((await prepareReportSetFile(after)).text);
    assert.match(f.q("review-text").textContent, /現在表示中の確認セットとの差/); assert.match(f.q("review-text").textContent, /<img src=x>/);
    assert.equal(f.q("review-text").children.length, 0); assert.equal(f.q("comparison-json").disabled, true);
    f.check("ack"); assert.equal(f.q("comparison-json").disabled, true);
    f.check("comparison-ack"); f.click("comparison-json"); await f.settled();
    assert.equal(f.files.length, 1); assert.doesNotMatch(f.files[0].text, /PRIVATE_COMPARISON_NOTE/);
    assert.equal(f.mounted.getState().input, before); assert.equal(f.mounted.getState().phase, "review");
    await f.file((await prepareReportSetFile(sequenceSet(demoSetHistory()))).text);
    assert.equal(f.q("comparison-ack").checked, false); assert.equal(f.q("comparison-json").disabled, true);
    f.click("apply"); await f.settled(); assert.equal(f.mounted.getState().input.entries.length, 7);
  } finally { f.dispose(); }
});

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

test("filtered checklist CSV preserves source summary on zero matches and respects export controls",async()=>{
  const f=fixture(demoSetHistory());
  try{
    await f.accept();const original=f.mounted.getState().input;
    assert.equal(f.q("checks-csv").disabled,true);f.check("ack");
    f.set("check-severity","conflict");f.click("checks-csv");await f.settled();
    assert.equal(f.files.length,1);assert.ok(f.files[0].matched>0);assert.equal(f.files[0].summaryRow,true);
    assert.equal(f.files[0].query.severity,"conflict");
    f.set("check-search","no matching check","input");f.click("checks-csv");await f.settled();
    assert.equal(f.files[1].matched,0);assert.ok(f.files[1].total>0);assert.equal(f.files[1].text.trimEnd().split("\r\n").length,2);
    f.set("check-search","x".repeat(101),"input");assert.equal(f.q("checks-csv").disabled,true);
    assert.equal(f.mounted.getState().input,original);
    const button=f.q("checks-csv");f.dispose();button.click();assert.equal(f.files.length,2);
  }finally{f.dispose();}
});

test("visible check references can be searched and exported without changing source conclusions", async () => {
  const f = fixture(sequenceHistory([0n, 24n]));
  try {
    await f.accept(); const original = f.mounted.getState().input;
    const id = f.q("check-list").children[0].getAttribute("data-check-id");
    assert.match(id, /^check-\d+$/); assert.match(f.q("check-search-help").textContent, /確認セット内/);
    f.set("check-search", id.toUpperCase(), "input");
    assert.equal(f.q("check-list").children.length, 1);
    assert.ok(f.q("check-list").children[0].children[0].textContent.startsWith(id + " / "));
    f.check("ack"); f.click("checks-csv"); await f.settled();
    assert.equal(f.files[0].matched, 1); assert.equal(f.files[0].total, 3);
    assert.equal(f.files[0].query.search, id); assert.equal(f.mounted.getState().input, original);
    assert.equal(f.mounted.getState().result.allContinuous, false);
    f.set("check-search", "", "input"); assert.equal(f.q("check-list").children.length, 3);
  } finally { f.dispose(); }
});

test("check-detail JSON saves exact observations with the selected disclosure controls", async () => {
  const f = fixture(sequenceHistory([0n, 0n]));
  try {
    await f.accept(); const original = f.mounted.getState().input;
    assert.equal(f.q("checks-json").disabled, true); f.check("ack"); f.set("check-severity", "conflict");
    f.click("checks-json"); await f.settled(); const data = JSON.parse(f.files[0].text);
    assert.ok(data.items.some(item => item.observations.length > 0)); assert.equal(data.options.includeNotes, false);
    assert.equal(data.sourcePayloadDigest, (await prepareReportSetFile(original)).digest);
    assert.match(f.q("json-help").textContent, /保存値・ハッシュ/);
    f.set("check-search", "x".repeat(101), "input"); assert.equal(f.q("checks-json").disabled, true);
    assert.equal(f.mounted.getState().input, original);
  } finally { f.dispose(); }
});

test("saved check details are compared on screen and the completed result can be saved", async () => {
  const f = fixture(sequenceHistory([0n, 0n]));
  try {
    assert.equal(f.q("check-file").disabled, true); await f.accept(); const input = f.mounted.getState().input;
    const file = await prepareReportSetChecksFile(input);
    f.q("check-file").files = [fileFrom(file.text)]; f.q("check-file").dispatchEvent(new Event("change"));
    await f.settled(); assert.match(f.q("check-review-output").textContent, /再計算と一致/);
    assert.match(f.q("check-review-output").textContent, /確認が必要な箇所あり/);
    assert.equal(f.q("check-review").disabled, true); f.check("ack"); f.click("check-review"); await f.settled();
    assert.equal(JSON.parse(f.files[0].text).matchesRecomputation, true);
    const changed = JSON.parse(file.text); changed.items = [];
    f.q("check-file").files = [fileFrom(JSON.stringify(changed))]; f.q("check-file").dispatchEvent(new Event("change"));
    await f.settled(); assert.match(f.q("check-review-output").textContent, /食い違い/);
    assert.equal(f.mounted.getState().input, input); assert.equal(f.q("check-file").value, "");
    f.q("check-file").files = [fileFrom("{")]; f.q("check-file").dispatchEvent(new Event("change"));
    await f.settled(); assert.match(f.q("check-review-output").textContent, /最後に完了した/);
    assert.equal(f.mounted.getState().checkReview.matchesRecomputation, false);
  } finally { f.dispose(); }
});

test("an accepted original report can be selected and exported with its full evidence", async () => {
  const f = fixture();
  try {
    assert.equal(f.q("source-report").disabled, true); await f.accept(); const input = f.mounted.getState().input;
    assert.equal(f.q("source-report").children.length, input.entries.length + 1);
    assert.equal(f.q("source-report-json").disabled, true); f.set("source-report", input.entries[1].id);
    assert.equal(f.q("source-report-json").disabled, true); f.check("ack"); f.click("source-report-json"); await f.settled();
    assert.deepEqual((await decodePeriodReportFile(f.files[0].text)).input, input.entries[1].report);
    assert.equal(f.mounted.getState().input, input); assert.match(f.q("source-report-help").textContent, /全アドレス/);
    f.set("source-report", id(999)); assert.equal(f.q("source-report-json").disabled, true);
    f.set("title", "Another set", "input"); f.click("prepare"); f.click("apply"); await f.settled();
    assert.equal(f.q("source-report").value, ""); assert.equal(f.q("source-report-json").disabled, true);
  } finally { f.dispose(); }
});

test("saved comparisons are reviewed against the pending pair and saved without applying it", async () => {
  const f = fixture();
  const choose = async text => {
    f.q("comparison-file").files = [fileFrom(text)]; f.q("comparison-file").dispatchEvent(new Event("change")); await f.settled();
  };
  try {
    assert.equal(f.q("comparison-file").disabled, true); await f.accept(); const before = f.mounted.getState().input;
    const after = sequenceSet(demoSetHistory()); await f.file((await prepareReportSetFile(after)).text);
    const saved = await prepareReportSetComparisonFile(before, after); await choose(saved.text);
    assert.match(f.q("comparison-review-output").textContent, /再計算と一致/);
    assert.equal(f.q("comparison-review-json").disabled, true); f.check("comparison-ack"); f.click("comparison-review-json"); await f.settled();
    assert.equal(JSON.parse(f.files[0].text).matchesRecomputation, true); assert.equal(f.mounted.getState().input, before);
    const altered = JSON.parse(saved.text); altered.comparison.rows = []; await choose(JSON.stringify(altered));
    assert.match(f.q("comparison-review-output").textContent, /食い違い/); assert.equal(f.q("comparison-file").value, "");
    await f.file((await prepareReportSetFile(after)).text);
    assert.equal(f.mounted.getState().comparisonReview, null); assert.equal(f.q("comparison-review-json").disabled, true);
    assert.equal(f.q("comparison-ack").checked, false); assert.equal(f.mounted.getState().input, before);
    const control = f.q("comparison-file"); f.dispose(); control.files = [fileFrom(saved.text)]; control.dispatchEvent(new Event("change"));
    assert.equal(f.files.length, 1);
  } finally { f.dispose(); }
});

test("saved-history coverage exports all groups independently of check filters", async () => {
  const f = fixture(demoSetHistory());
  try {
    assert.equal(f.q("coverage-json").disabled, true); await f.accept(); const before = f.mounted.getState().input;
    assert.equal(f.q("coverage-csv").disabled, true); f.check("ack"); f.set("check-search", "not in any check", "input");
    f.click("coverage-json"); await f.settled(); const data = JSON.parse(f.files[0].text);
    assert.equal(data.groupCount, 3); assert.equal(data.summary.allContinuous, false); assert.equal(data.options.shortAddresses, true);
    f.check("short-addresses", false); f.click("coverage-csv"); await f.settled();
    assert.match(f.files[1].text, /"group-summary"/); assert.ok(f.files[1].text.includes(before.entries[0].report.slots[0].entry.draft.plan.context.account));
    assert.match(f.q("coverage-export-help").textContent, /イベント本体は含めません/); assert.equal(f.mounted.getState().input, before);
    const control = f.q("coverage-json"); f.dispose(); control.click(); assert.equal(f.files.length, 2);
  } finally { f.dispose(); }
});

test("wrong saved-artifact inputs explain the correct destination without replacing current evidence", async () => {
  const f = fixture();
  try {
    await f.accept(); const original = f.mounted.getState().input, saved = JSON.stringify(f.store.document);
    const period = await preparePeriodFile(original.entries[0].report.slots[0].entry.draft);
    await f.file(period.text); assert.match(f.q("status").textContent, /控えの保存と復元/);
    assert.equal(f.mounted.getState().input, original); assert.equal(f.q("apply").disabled, true);
    const coverage = await prepareReportSetCoverageFile(original); await f.file(coverage.text);
    assert.match(f.q("status").textContent, /元の履歴を復元するファイルではありません/);
    const comparison = await prepareReportSetComparisonFile(original, sequenceSet(demoSetHistory())); await f.file(comparison.text);
    assert.match(f.q("status").textContent, /保存した比較JSONを照合/);
    assert.equal(f.mounted.getState().input, original); assert.equal(JSON.stringify(f.store.document), saved);
    assert.ok(f.store.calls.every(row => row[0] === "read"));
  } finally { f.dispose(); }
});

test("portable comparison evidence is independently reviewed and requires separate full-source export acknowledgement", async () => {
  const f = fixture(), before = sequenceSet(), after = sequenceSet(demoSetHistory());
  const choose = async text => {
    f.q("comparison-evidence-file").files = [fileFrom(text)]; f.q("comparison-evidence-file").dispatchEvent(new Event("change")); await f.settled();
  };
  try {
    assert.equal(f.q("comparison-evidence-file").disabled, false);
    await choose((await prepareReportSetComparisonEvidenceFile(before, after)).text);
    assert.equal(f.mounted.getState().input, null); assert.match(f.q("comparison-evidence-output").textContent, /再計算と一致/);
    assert.equal(f.q("comparison-evidence-review-json").disabled, true); f.check("comparison-evidence-review-ack"); f.click("comparison-evidence-review-json"); await f.settled();
    assert.equal(JSON.parse(f.files[0].text).imported, false);
    await f.accept(); const accepted = f.mounted.getState().input;
    await f.file((await prepareReportSetFile(after)).text); f.check("ack"); f.check("comparison-ack");
    assert.equal(f.q("comparison-evidence-json").disabled, true);
    f.check("comparison-evidence-ack"); f.click("comparison-evidence-json"); await f.settled();
    assert.equal(f.files[1].containsOriginalEvidence, true); assert.equal(f.mounted.getState().input, accepted);
    assert.equal((await reviewReportSetComparisonEvidence(f.files[1].text)).comparisonReview.matchesRecomputation, true);
    await f.file((await prepareReportSetFile(after)).text); assert.equal(f.q("comparison-evidence-ack").checked, false);
    assert.equal(f.q("comparison-evidence-json").disabled, true); assert.equal(f.mounted.getState().evidenceReview.imported, false);
    const control = f.q("comparison-evidence-file"); f.dispose(); control.files = [fileFrom("{}")]; control.dispatchEvent(new Event("change")); assert.equal(f.files.length, 2);
  } finally { f.dispose(); }
});

test("verified source recovery resets disclosure on side changes and never replaces the displayed set", async () => {
  const f = fixture(), before = sequenceSet(), after = sequenceSet(demoSetHistory());
  const choose = async text => { f.q("comparison-evidence-file").files = [fileFrom(text)]; f.q("comparison-evidence-file").dispatchEvent(new Event("change")); await f.settled(); };
  try {
    assert.equal(f.q("evidence-source-role").disabled, true);
    const bundle = await prepareReportSetComparisonEvidenceFile(before, after); await choose(bundle.text);
    assert.equal(f.q("evidence-source-json").disabled, true); f.set("evidence-source-role", "before");
    f.check("comparison-evidence-review-ack"); assert.equal(f.q("evidence-source-json").disabled, true);
    f.check("evidence-source-ack"); f.click("evidence-source-json"); await f.settled();
    assert.deepEqual((await decodeReportSetFile(f.files[0].text)).input, before); assert.equal(f.mounted.getState().input, null);
    f.set("evidence-source-role", "after"); assert.equal(f.q("evidence-source-ack").checked, false); assert.equal(f.q("evidence-source-json").disabled, true);
    f.check("evidence-source-ack"); f.click("evidence-source-json"); await f.settled();
    assert.deepEqual((await decodeReportSetFile(f.files[1].text)).input, after);
    await f.accept(); const accepted = f.mounted.getState().input;
    await choose(bundle.text); assert.equal(f.q("evidence-source-role").value, ""); assert.equal(f.q("evidence-source-ack").checked, false);
    f.set("evidence-source-role", "before"); f.check("evidence-source-ack"); f.click("evidence-source-json"); await f.settled();
    assert.equal(f.mounted.getState().input, accepted); assert.ok(f.store.calls.every(row => row[0] === "read"));
    const control = f.q("evidence-source-json"); f.dispose(); control.click(); assert.equal(f.files.length, 3);
  } finally { f.dispose(); }
});
