import { mountReportHistoryPanel } from "/examples/report-history-panel.js";
import { mountPeriodReportPanel } from "/examples/period-report-panel.js";
import { createReportHistoryStorage } from "/src/report-history-storage.js";
import { prepareReportHistoryFile, decodeReportHistoryFile } from "/src/report-history-file.js";
import { historyMemory, historyDocument, historyRecord, sampleHistory, reportInput, reportLibrary, libraryMemory,
  id, LATER, AFTER, waitUntil, forkedInput, saveHistory } from "/test/helpers/report-history-fixtures.js";

const assert = (value, message = "History UI assertion failed") => { if (!value) throw Error(message); };
function fixture(options = {}) {
  const parent = document.createElement("div"); document.body.append(parent);
  const store = options.store ?? historyMemory(options.initial ?? sampleHistory()), files = [], deliveries = [];
  let source = reportInput();
  const mounted = mountReportHistoryPanel({ document, parent, storage: store.storage,
    sourceStorage: libraryMemory(reportLibrary()).storage,
    getReport: () => source, stageReport: input => { deliveries.push(input); return true; },
    now: () => AFTER, createId: () => id(200), download: file => files.push(file), ...options.panel });
  const q = name => parent.querySelector(".report-history-" + name);
  const f = { parent, store, files, deliveries, mounted, q,
    source(input) { source = input; },
    click(name) { assert(!q(name).disabled, "Disabled: " + name); q(name).click(); },
    set(name, value, event = "change") { q(name).value = value; q(name).dispatchEvent(new Event(event, { bubbles: true })); },
    check(name, value = true) { q(name).checked = value; q(name).dispatchEvent(new Event("change", { bubbles: true })); },
    settled: () => waitUntil(() => q("panel").getAttribute("aria-busy") === "false"),
    async load() { f.click("refresh"); await f.settled(); },
    async file(text) {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "history.json", { type: "application/json" }));
      q("file").files = transfer.files; q("file").dispatchEvent(new Event("change", { bubbles: true })); await f.settled();
    },
    dispose() { mounted.dispose(); parent.remove(); },
  };
  return f;
}
function request(value) {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
    value.onblocked = () => reject(Error("History test database blocked"));
  });
}
async function database(callback) {
  const name = "threecore-test-report-history-" + crypto.randomUUID(), adapters = [];
  const connect = () => { const adapter = createReportHistoryStorage({ indexedDB, name }); adapters.push(adapter); return adapter; };
  try { await callback(connect, name); }
  finally {
    adapters.forEach(adapter => adapter.close());
    // This name is random, created only by this synthetic test, and contains no user data.
    await request(indexedDB.deleteDatabase(name));
  }
}
async function seed(storage, source = sampleHistory()) {
  const current = await storage.read();
  return storage.change(current.revision, { kind: "merge", document: source, skipConflicts: false });
}

export function registerReportHistoryUITests(test) {
  test("history: source inspection identifies the original records without changing history", async () => {
    const f = fixture();
    try {
      await f.load(); f.set("selected", id(101));
      const before = JSON.stringify(f.store.document);
      f.click("inspect-sources"); await f.settled();
      assert(f.q("sources-text").textContent.includes("同じ控えがあります"));
      assert(f.mounted.getState().sourceInspection.matched === 3);
      assert(JSON.stringify(f.store.document) === before);
      f.set("selected", id(102)); assert(f.q("sources-text").textContent === "");
    } finally { f.dispose(); }
  });
  test("history: comparison describes same-period records without claiming continuity", async () => {
    const f = fixture();
    try {
      await f.load(); f.set("baseline", id(101)); f.set("selected", id(102)); f.click("compare");
      assert(f.q("comparison-text").textContent.includes("同じ期間の報告です"));
      assert(f.q("comparison-text").textContent.includes("連続した証拠とは確認できていません"));
    } finally { f.dispose(); }
  });
  test("history: mounting is lazy and labels expose the meaning of controls", () => {
    const f = fixture();
    try {
      assert(f.store.calls.length === 0);
      assert(f.q("status").getAttribute("aria-live") === "polite");
      assert(f.q("save").disabled && f.q("apply").disabled && f.q("file").disabled);
      assert(f.q("notice").textContent.includes("ポート"));
    } finally { f.dispose(); }
  });
  test("history: native text entry saves a reviewed report with metadata", async () => {
    const f = fixture({ initial: historyDocument() });
    try {
      await f.load(); f.set("label", "ブラウザーで確認", "input");
      f.set("note", "端末内だけで保全\n次回確認", "input"); f.set("tags", "weekly, daily", "input");
      f.click("save"); assert(f.store.document.entries.length === 0);
      assert(f.q("review-text").textContent.includes("次回確認"));
      f.click("apply"); await f.settled();
      assert(f.store.document.entries.length === 1);
      assert(f.store.document.entries[0].tags.join(",") === "daily,weekly");
      assert(f.q("selected").value === id(200));
    } finally { f.dispose(); }
  });
  test("history: native IndexedDB survives adapter reopening", () => database(async connect => {
    const writer = connect(); await seed(writer); writer.close();
    const f = fixture({ store: { storage: connect() } });
    try {
      await f.load(); assert(f.mounted.getState().document.entries.length === 4);
      f.set("selected", id(101)); f.set("note", "再起動後も保持", "input");
      f.click("annotate"); await f.settled();
    } finally { f.dispose(); }
    const saved = await connect().read(); assert(saved.entries[0].note === "再起動後も保持");
  }));
  test("history: native compare-and-swap rejects a second stale writer", () => database(async connect => {
    const a = connect(), b = connect();
    const first = await a.read(), second = await b.read();
    await a.change(first.revision, saveHistory());
    let error;
    try { await b.change(second.revision, saveHistory(2)); } catch (value) { error = value; }
    assert(error?.code === "PERIOD_HISTORY_STALE");
    assert((await b.read()).entries.length === 1);
  }));
  test("history: native cancellation before write leaves the database untouched", () => database(async connect => {
    const storage = connect(), aborter = new AbortController(); aborter.abort();
    let error;
    try { await storage.change(0, saveHistory(), { signal: aborter.signal }); } catch (value) { error = value; }
    assert(error?.code === "CHECKPOINT_CANCELLED"); assert((await storage.read()).entries.length === 0);
  }));
  test("history: archive can be reversed without losing annotations", async () => {
    const f = fixture();
    try {
      await f.load(); f.set("selected", id(101)); f.click("archive"); await f.settled();
      assert(f.q("selected").value === id(101)); assert(f.q("selection-note").textContent.includes("非表示保管"));
      f.click("restore"); await f.settled(); assert(!f.store.document.entries[0].archived);
      assert(f.store.document.entries[0].note === "確認用メモ 1");
    } finally { f.dispose(); }
  });
  test("history: filters retain an explicitly labelled outside-filter selection", async () => {
    const f = fixture();
    try {
      await f.load(); f.set("selected", id(101)); f.set("status-filter", "attention");
      assert(f.q("selected").value === id(101));
      assert(f.q("selected").selectedOptions[0].textContent.includes("対象外"));
      assert(f.q("count").textContent === "1/4件を表示");
    } finally { f.dispose(); }
  });
  test("history: duplicate saved report displays guidance and does not add another row", async () => {
    const f = fixture(); f.source(historyRecord().report);
    try {
      await f.load(); f.click("save"); assert(f.q("status").textContent.includes("すでに保存"));
      assert(f.store.document.entries.length === 4); assert(f.q("apply").disabled);
    } finally { f.dispose(); }
  });
  test("history: new report content invalidates old save review", async () => {
    const f = fixture({ initial: historyDocument() });
    try {
      await f.load(); f.click("save"); f.source(reportInput({ title: "new report" }));
      f.click("apply"); await f.settled(); assert(f.q("status").textContent.includes("表示中の報告が変わりました"));
      assert(f.store.document.entries.length === 0);
    } finally { f.dispose(); }
  });
  test("history: annotations typed after review disable its apply button", async () => {
    const f = fixture({ initial: historyDocument() });
    try {
      await f.load(); f.click("save"); f.set("note", "changed", "input");
      assert(f.q("apply").disabled); assert(f.q("review").hidden);
    } finally { f.dispose(); }
  });
  test("history: whole backup includes hidden records even under a restrictive filter", async () => {
    const f = fixture();
    try {
      await f.load(); f.set("search", "missing", "input"); f.check("export-ack");
      f.click("backup-json"); await f.settled();
      assert((await decodeReportHistoryFile(f.files[0].text)).document.entries.length === 4);
    } finally { f.dispose(); }
  });
  test("history: filtered CSV is a catalog, not a replacement evidence archive", async () => {
    const f = fixture();
    try {
      await f.load(); f.set("status-filter", "attention"); f.check("export-ack");
      f.click("csv"); await f.settled(); assert(f.files[0].rows === 1);
      assert(f.files[0].restorable === false); assert(f.store.document.entries.length === 4);
    } finally { f.dispose(); }
  });
  test("history: changed selection requires a fresh export acknowledgment", async () => {
    const f = fixture();
    try {
      await f.load(); f.check("export-ack"); assert(!f.q("backup-json").disabled);
      f.set("selected", id(102)); assert(!f.q("export-ack").checked); assert(f.q("backup-json").disabled);
    } finally { f.dispose(); }
  });
  test("history: native file control previews additions before committing", async () => {
    const f = fixture({ initial: historyDocument() });
    try {
      await f.load(); await f.file((await prepareReportHistoryFile(sampleHistory())).text);
      assert(f.q("file").value === ""); assert(f.store.document.entries.length === 0);
      assert(f.q("review-text").textContent.includes("追加 4件")); f.click("apply"); await f.settled();
      assert(f.store.document.entries.length === 4);
    } finally { f.dispose(); }
  });
  test("history: conflicting file keeps local evidence and requires explicit exclusion", async () => {
    const f = fixture({ initial: historyDocument([historyRecord()]) });
    try {
      await f.load(); const file = await prepareReportHistoryFile(historyDocument([
        historyRecord(1, { report: forkedInput() }), historyRecord(2)]));
      await f.file(file.text); assert(f.q("apply").disabled);
      assert(!f.q("skip-conflicts-label").hidden); f.check("skip-conflicts");
      f.click("apply"); await f.settled(); assert(f.store.document.entries.length === 2);
      assert(f.store.document.entries[0].report.title === historyRecord().report.title);
    } finally { f.dispose(); }
  });
  test("history: duplicate import keeps local edited notes", async () => {
    const local = historyRecord(1, { note: "local" }); const f = fixture({ initial: historyDocument([local]) });
    try {
      await f.load(); await f.file((await prepareReportHistoryFile(historyDocument([historyRecord(1, { note: "remote" })]))).text);
      assert(f.q("review-text").textContent.includes("優先する記録: 1件"));
      f.click("apply"); await f.settled(); assert(f.store.document.entries[0].note === "local");
    } finally { f.dispose(); }
  });
  test("history: malformed JSON preserves existing records", async () => {
    const f = fixture();
    try {
      await f.load(); await f.file("invalid"); assert(f.q("status").getAttribute("data-error") === "true");
      assert(f.store.document.entries.length === 4); assert(f.q("review").hidden);
    } finally { f.dispose(); }
  });
  test("history: labels resembling HTML cannot create elements or execute scripts", async () => {
    const text = '<img src=x onerror="alert(1)">';
    const f = fixture({ initial: historyDocument([historyRecord(1, { label: text, note: text })]) });
    try {
      await f.load(); f.set("selected", id(101)); assert(f.q("selection-note").textContent.includes(text));
      assert(f.parent.querySelectorAll("img, script, iframe").length === 0);
    } finally { f.dispose(); }
  });
  test("history: saved-report comparison identifies a hash mismatch", async () => {
    const f = fixture();
    try {
      await f.load(); f.set("baseline", id(101)); f.set("selected", id(102)); f.click("compare");
      assert(f.q("comparison-text").textContent.includes("ハッシュ変更")); assert(f.deliveries.length === 0);
    } finally { f.dispose(); }
  });
  test("history: native backup restore is idempotent across database connections", () => database(async connect => {
    const first = connect(); await seed(first); const file = await prepareReportHistoryFile(await first.read()); first.close();
    const second = connect(), decoded = await decodeReportHistoryFile(file.text), before = await second.read();
    const after = await second.change(before.revision, { kind: "merge", document: decoded.document, skipConflicts: false });
    assert(after.revision === before.revision); assert(after.entries.length === 4);
  }));
  test("history: integrated report panel stages stored evidence then displays its origin", async () => {
    const parent = document.createElement("div"); document.body.append(parent);
    const report = mountPeriodReportPanel({ document, parent, storage: libraryMemory().storage });
    const f = fixture({ panel: { getReport: report.getInput, stageReport: report.stageHistory } });
    try {
      await f.load(); f.set("selected", id(101)); f.click("open"); f.click("apply"); await f.settled();
      assert(report.getInput() === null);
      const apply = parent.querySelector(".period-report-apply"); assert(!apply.disabled); apply.click();
      await waitUntil(() => parent.querySelector(".period-report-panel").getAttribute("aria-busy") === "false");
      assert(report.getReport().allArithmeticAgreement);
      assert(parent.querySelector(".period-report-result-meta").textContent.includes("PC内の報告履歴"));
    } finally { f.dispose(); report.dispose(); parent.remove(); }
  });
}
