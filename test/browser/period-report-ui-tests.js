import { mountPeriodReportPanel } from "/examples/period-report-panel.js";
import { createPeriodLibraryStorage } from "/src/period-library-storage.js";
import { preparePeriodReportFile, decodePeriodReportFile } from "/src/period-report-file.js";
import { createPeriodReportController } from "/src/period-report-controller.js";
import { reportInput, reportLibrary, selection, id, LATER, memoryStorage, waitUntil,
  changedSlot, manyEventsInput, forkedInput, deferred, entry, library } from "/test/helpers/period-report-fixtures.js";

const assert = (value, message = "Period report browser assertion failed") => { if (!value) throw Error(message); };
function fixture(options = {}) {
  const parent = document.createElement("div"); document.body.append(parent);
  const store = options.store ?? memoryStorage(options.initial ?? reportLibrary()), files = [];
  const mounted = mountPeriodReportPanel({ document, parent, storage: store.storage,
    now: () => LATER, download: file => files.push(file), ...options.panel });
  const q = name => parent.querySelector(".period-report-" + name);
  const f = { parent, store, files, mounted, q,
    click(name) { assert(!q(name).disabled, "Disabled: " + name); q(name).click(); },
    set(name, value, event = "change") { q(name).value = value; q(name).dispatchEvent(new Event(event, { bubbles: true })); },
    settled: () => waitUntil(() => q("panel").getAttribute("aria-busy") === "false"),
    async choose() { f.click("refresh"); await f.settled(); for (const [agent, value] of Object.entries(selection())) f.set("select-" + agent, value); },
    async build() { await f.choose(); f.click("prepare"); f.click("apply"); await f.settled(); },
    async file(text) {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "report.json", { type: "application/json" }));
      q("file").files = transfer.files; q("file").dispatchEvent(new Event("change", { bubbles: true })); await f.settled();
    },
    async import(input) { await f.file((await preparePeriodReportFile(input)).text); },
    acknowledge() { q("export-ack").checked = true; q("export-ack").dispatchEvent(new Event("change", { bubbles: true })); },
    dispose() { mounted.dispose(); parent.remove(); },
  };
  return f;
}

function request(value) {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
    value.onblocked = () => reject(Error("Test database blocked"));
  });
}

async function database(callback) {
  const name = "threecore-test-period-report-" + crypto.randomUUID();
  const adapters = [];
  const connect = () => {
    const adapter = createPeriodLibraryStorage({ indexedDB, name }); adapters.push(adapter); return adapter;
  };
  try { await callback(connect, name); }
  finally {
    adapters.forEach(adapter => adapter.close());
    // Only the random, synthetic database owned by this test is removed.
    await request(indexedDB.deleteDatabase(name));
  }
}

async function seed(storage, source = reportLibrary()) {
  const current = await storage.read();
  await storage.change(current.revision, { kind: "import", entries: source.entries });
}

export function registerPeriodReportUITests(test) {
  test("period report: replacement review shows less complete incoming evidence", async () => {
    const f = fixture();
    try {
      await f.build(); const original = f.mounted.getInput();
      await f.import(reportInput({ counts: [3, 5, 5] }));
      assert(f.q("review-text").textContent.includes("取得工程が少ない控えに戻ります"));
      assert(f.q("review-text").textContent.includes("除外 1"));
      assert(f.mounted.getInput() === original);
      f.click("cancel"); assert(f.mounted.getInput() === original);
    } finally { f.dispose(); }
  });

  test("period report: removed quarantine is disclosed before replacing report", async () => {
    const f = fixture();
    try {
      await f.import(reportInput({ changes: { DAT: { requiresNewPlan: true } } }));
      f.click("apply"); await f.settled();
      await f.import(reportInput());
      assert(f.q("review-text").textContent.includes("印が外れています"));
      assert(f.q("review-text").textContent.includes("妥当性を認証していません"));
      assert(f.mounted.getReport().status === "attention");
    } finally { f.dispose(); }
  });

  test("period report: native storage survives reopening and reports three independent accounts", () => database(async connect => {
    const writer = connect(); await seed(writer); writer.close();
    const f = fixture({ store: { storage: connect() } });
    try {
      await f.build();
      assert(f.mounted.getReport().status === "arithmetic-agreement");
      assert(f.mounted.getReport().sharedAccounts.length === 0);
      assert(f.q("card-balance-DAT").textContent === "107 DAT");
      assert(f.q("card-balance-EMA").textContent === "107 EMA");
      assert(f.q("card-balance-CAWELON").textContent === "107 CAWELON");
    } finally { f.dispose(); }
  }));

  test("period report: full native lifecycle cannot change source revision or evidence", () => database(async connect => {
    const writer = connect(); await seed(writer); const before = await writer.read();
    const f = fixture({ store: { storage: connect() } });
    try {
      await f.build(); f.acknowledge();
      for (const name of ["json", "csv", "html"]) { f.click(name); await f.settled(); }
      assert(f.files.length === 3);
      await f.file(f.files[0].text); f.click("apply"); await f.settled();
      assert(JSON.stringify(await writer.read()) === JSON.stringify(before));
    } finally { f.dispose(); }
  }));

  test("period report: native rename during review is rejected", () => database(async connect => {
    const writer = connect(); await seed(writer);
    const f = fixture({ store: { storage: connect() } });
    try {
      await f.choose(); f.click("prepare");
      const current = await writer.read();
      await writer.change(current.revision, { kind: "rename", id: id(1), label: "Changed externally", time: LATER });
      f.click("apply"); await f.settled();
      assert(f.q("status").textContent.includes("変更"));
      assert(f.mounted.getReport() === null);
      assert((await writer.read()).entries[0].label === "Changed externally");
    } finally { f.dispose(); }
  }));

  test("period report: unrelated native addition is accepted without adding it to report", () => database(async connect => {
    const writer = connect(); await seed(writer);
    const f = fixture({ store: { storage: connect() } });
    try {
      await f.choose(); f.click("prepare");
      const current = await writer.read();
      await writer.change(current.revision, { kind: "import", entries: [entry(40)] });
      f.click("apply"); await f.settled();
      assert(f.mounted.getReport().selectedCount === 3);
      assert((await writer.read()).entries.length === 4);
    } finally { f.dispose(); }
  }));

  test("period report: archived native records remain explicitly selectable", () => database(async connect => {
    await seed(connect(), reportLibrary({ changes: { EMA: { archived: true } } }));
    const f = fixture({ store: { storage: connect() } });
    try {
      await f.build();
      assert(f.q("select-EMA").selectedOptions[0].textContent.includes("非表示保管"));
      assert(f.mounted.getReport().warnings.includes("ARCHIVED_SOURCE"));
      assert(f.q("issues").textContent.includes("非表示保管"));
    } finally { f.dispose(); }
  }));

  test("period report: no storage access before explicit refresh", () => {
    const f = fixture();
    try {
      assert(f.store.calls.length === 0);
      assert(f.q("prepare").disabled);
      assert(!f.q("file").disabled);
      assert(f.q("result").hidden);
      assert(f.q("status").getAttribute("aria-live") === "polite");
    } finally { f.dispose(); }
  });

  test("period report: real DOM uses text-only labels and titles", async () => {
    const f = fixture({ initial: reportLibrary({ changes: { DAT: { label: '<img src=x onerror="oops">' } } }) });
    try {
      await f.choose(); f.set("title", "<script>oops</script>", "input");
      f.click("prepare"); f.click("apply"); await f.settled();
      assert(f.q("result-title").textContent === "<script>oops</script>");
      assert(f.q("card-text-DAT").textContent.includes("<img"));
      assert(f.parent.querySelectorAll("img,script,iframe").length === 0);
    } finally { f.dispose(); }
  });

  test("period report: native file chooser payload stages before applying", async () => {
    const f = fixture();
    try {
      await f.import(reportInput({ title: "Imported report" }));
      assert(f.mounted.getReport() === null);
      assert(!f.q("review").hidden);
      assert(f.q("file").value === "");
      f.click("apply"); await f.settled();
      assert(f.mounted.getReport().title === "Imported report");
      assert(f.q("result-meta").textContent.includes("出所: 報告JSON"));
      assert(f.store.calls.length === 0);
    } finally { f.dispose(); }
  });

  test("period report: invalid JSON cannot replace an accepted report", async () => {
    const f = fixture();
    try {
      await f.build(); const before = f.mounted.getInput(); await f.file("not JSON");
      assert(f.q("status").getAttribute("data-error") === "true");
      assert(f.mounted.getInput() === before);
      assert(f.q("review").hidden);
    } finally { f.dispose(); }
  });

  test("period report: changed checksum cannot be approved", async () => {
    const f = fixture();
    try {
      const file = JSON.parse((await preparePeriodReportFile(reportInput())).text);
      file.input.title = "Tampered"; await f.file(JSON.stringify(file));
      assert(f.q("status").textContent.includes("チェックサム"));
      assert(f.q("apply").disabled);
      assert(f.mounted.getReport() === null);
    } finally { f.dispose(); }
  });

  test("period report: mixed acquisition states remain distinct in browser cards", async () => {
    const f = fixture();
    try {
      await f.import(reportInput({ counts: [0, 5, 5], changes: { CAWELON: { requiresNewPlan: true } } }));
      f.click("apply"); await f.settled();
      assert(f.q("card-balance-DAT").textContent === "未取得 DAT");
      assert(f.q("card-status-DAT").textContent === "取得途中");
      assert(f.q("card-status-CAWELON").textContent === "再取得が必要");
      assert(f.q("result-status").getAttribute("data-state") === "attention");
    } finally { f.dispose(); }
  });

  test("period report: forked evidence displays block numbers and per-agent hashes", async () => {
    const f = fixture();
    try {
      await f.import(forkedInput()); f.click("apply"); await f.settled();
      assert(!f.q("conflicts").hidden);
      assert(f.q("conflicts-text").textContent.includes("block 30"));
      assert(f.q("conflicts-text").textContent.includes("EMA: 0x"));
      assert(f.q("result-status").getAttribute("data-state") === "attention");
    } finally { f.dispose(); }
  });

  test("period report: a one-unit discrepancy is not rounded away in the browser", async () => {
    const f = fixture();
    try {
      const input = changedSlot(reportInput(), "EMA", entry => { entry.draft.later.balanceBaseUnits = "107000000000000000001"; });
      await f.import(input); f.click("apply"); await f.settled();
      assert(f.q("card-difference-EMA").textContent.includes("0.000000000000000001"));
      assert(f.mounted.getReport().status === "attention");
    } finally { f.dispose(); }
  });

  test("period report: real table paginates and filters without changing totals", async () => {
    const f = fixture();
    try {
      await f.import(manyEventsInput()); f.click("apply"); await f.settled();
      const before = f.mounted.getReport();
      assert(f.q("rows").rows.length === 25); f.click("next"); f.click("next");
      assert(f.q("rows").rows.length === 7); assert(f.q("next").disabled);
      f.set("direction", "outgoing"); assert(f.q("rows").rows.length === 0);
      assert(f.q("event-count").textContent.includes("1/1ページ"));
      f.set("direction", "all"); f.set("search", "unknown", "input");
      assert(f.q("rows").rows.length === 0);
      assert(f.mounted.getReport() === before);
      f.set("search", "", "input"); f.set("event-agent", "EMA");
      assert(f.q("rows").rows.length === 2);
    } finally { f.dispose(); }
  });

  for (const format of ["json", "csv", "html"]) {
    test("period report: explicit " + format + " export contains accepted snapshot", async () => {
      const f = fixture();
      try {
        await f.build(); assert(f.q(format).disabled); f.acknowledge();
        f.click(format); await f.settled();
        assert(f.files.length === 1);
        assert(f.files[0].filename.endsWith("." + format));
        if (format === "json") assert((await decodePeriodReportFile(f.files[0].text)).input.slots.length === 3);
        if (format === "html") assert(!/<script|<iframe/.test(f.files[0].text));
        if (format === "csv") assert(f.files[0].text.includes("unexplained_base_units"));
      } finally { f.dispose(); }
    });
  }

  test("period report: selecting new evidence clears export acknowledgement", async () => {
    const f = fixture();
    try {
      await f.build(); f.acknowledge(); f.set("select-EMA", "");
      assert(f.q("result").hidden); assert(!f.q("export-ack").checked); assert(f.q("json").disabled);
      f.click("prepare"); f.click("apply"); await f.settled();
      assert(f.mounted.getReport().status === "incomplete");
    } finally { f.dispose(); }
  });

  test("period report: changed title clears review and disabled button cannot apply", async () => {
    const f = fixture();
    try {
      await f.choose(); f.click("prepare"); f.set("title", "New title", "input");
      assert(f.q("review").hidden); assert(f.q("apply").disabled);
      f.q("apply").click(); assert(f.mounted.getReport() === null);
    } finally { f.dispose(); }
  });

  test("period report: cancel a slow native-style read without late result", async () => {
    const gate = deferred(), store = memoryStorage(reportLibrary(), { beforeRead: () => gate.promise });
    const f = fixture({ store });
    try {
      f.click("refresh"); assert(f.q("file").disabled); f.click("cancel"); gate.resolve(); await f.settled();
      assert(f.q("prepare").disabled); assert(!f.q("file").disabled);
      assert(f.mounted.getReport() === null);
    } finally { f.dispose(); }
  });

  test("period report: reopening exported report does not need browser persistence", async () => {
    const first = fixture(); let text;
    try { await first.build(); first.acknowledge(); first.click("json"); await first.settled(); text = first.files[0].text; }
    finally { first.dispose(); }
    const second = fixture({ initial: library([]) });
    try {
      await second.file(text); second.click("apply"); await second.settled();
      assert(second.mounted.getReport().allArithmeticAgreement);
      assert(second.store.document.entries.length === 0);
      assert(second.store.calls.length === 0);
    } finally { second.dispose(); }
  });

  test("period report: disposed native controller cannot publish a late review", () => database(async connect => {
    await seed(connect());
    const gate = deferred();
    const controller = createPeriodReportController({ storage: connect(), readFile: () => gate.promise });
    const pending = controller.importFile({}); controller.dispose();
    gate.resolve({ input: reportInput(), checksumVerified: true });
    assert(await pending === false); assert(controller.state.review === null);
  }));
}
