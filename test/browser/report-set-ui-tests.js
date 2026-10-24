import { mountReportSetPanel } from "/examples/report-set-panel.js";
import { createReportHistoryStorage } from "/src/report-history-storage.js";
import { prepareReportSetFile, decodeReportSetFile } from "/src/report-set-file.js";
import { analyzeReportSet } from "/src/report-set-engine.js";
import { sequenceHistory, sequenceSet, demoSetHistory, historyMemory, historyDocument,
  clone, id, AFTER, waitUntil, deferred } from "/test/helpers/report-set-fixtures.js";

const assert = (condition, message = "Report set UI assertion failed") => {
  if (!condition) throw Error(message);
};

function fixture(options = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const store = options.store ?? historyMemory(options.initial ?? sequenceHistory());
  const files = [];
  const mounted = mountReportSetPanel({ document, parent, storage: store.storage,
    now: () => AFTER, download: file => files.push(file), ...options.panel });
  const q = name => parent.querySelector(".report-set-" + name);
  const f = { parent, store, files, mounted, q,
    click(name) {
      assert(!q(name).disabled, "Disabled control " + name);
      q(name).click();
    },
    set(name, value, event = "change") {
      q(name).value = value;
      q(name).dispatchEvent(new Event(event, { bubbles: true }));
    },
    check(name, value = true) {
      q(name).checked = value;
      q(name).dispatchEvent(new Event("change", { bubbles: true }));
    },
    choice(number) {
      const checkbox = [...parent.querySelectorAll(".report-set-choice-check")]
        .find(element => element.value === id(100 + number));
      assert(checkbox && !checkbox.disabled, "Missing choice " + number);
      checkbox.click();
    },
    settled: () => waitUntil(() => q("panel").getAttribute("aria-busy") === "false"),
    async load() {
      f.click("refresh");
      await f.settled();
    },
    async accept() {
      await f.load();
      f.click("select-visible");
      f.click("prepare");
      f.click("apply");
      await f.settled();
    },
    async file(text) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], "report-set.json", { type: "application/json" }));
      q("file").files = transfer.files;
      q("file").dispatchEvent(new Event("change", { bubbles: true }));
      await f.settled();
    },
    dispose() { mounted.dispose(); parent.remove(); },
  };
  return f;
}

async function withDatabase(run) {
  const name = "threecore-test-report-set-" + crypto.randomUUID();
  const adapters = [];
  const connect = () => {
    const adapter = createReportHistoryStorage({ indexedDB, name });
    adapters.push(adapter);
    return adapter;
  };
  try { await run(connect); }
  finally {
    adapters.forEach(adapter => adapter.close());
    // Random database created for this isolated synthetic test; never a user store.
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error("Test-only set database is blocked"));
    });
  }
}

export function registerReportSetUITests(test) {
  test("report set: timeline cells expose report details and support keyboard navigation", async () => {
    const f = fixture();
    try {
      await f.accept();
      const buttons = [...f.parent.querySelectorAll(".report-set-timeline-cell")];
      assert(buttons.length === 9);
      buttons[0].focus();
      buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      assert(document.activeElement === buttons[1]);
      buttons[1].click();
      assert(buttons[1].getAttribute("aria-pressed") === "true");
      assert(f.parent.querySelector(".report-set-timeline-detail").textContent.includes("報告 2"));
      buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
      assert(document.activeElement === buttons[2]);
      assert(buttons[2].getAttribute("aria-pressed") === "false");
    } finally { f.dispose(); }
  });

  test("report set: timeline gap selection describes neighbors without altering selection", async () => {
    const f = fixture({ initial: sequenceHistory([0n, 24n]) });
    try {
      await f.accept();
      const before = f.mounted.getState().input;
      const gap = f.parent.querySelector('.report-set-timeline-cell[data-tone="gap"]');
      assert(gap);
      gap.click();
      const text = f.parent.querySelector(".report-set-timeline-detail").textContent;
      assert(text.includes("(42, 54]"));
      assert(text.includes("直前の報告: 報告 1"));
      assert(text.includes("直後の報告: 報告 2"));
      assert(f.mounted.getState().input === before);
      assert(f.store.calls.every(call => call[0] === "read"));
    } finally { f.dispose(); }
  });

  test("report set: accepting a new set replaces old timeline controls cleanly", async () => {
    const f = fixture();
    try {
      await f.accept();
      const old = f.parent.querySelector(".report-set-timeline-cell");
      const oldText = f.parent.querySelector(".report-set-timeline-detail");
      f.choice(2); f.click("prepare"); f.click("apply"); await f.settled();
      assert(!old.isConnected);
      const before = oldText.textContent;
      old.click();
      assert(oldText.textContent === before);
      assert(f.parent.querySelectorAll(".report-set-timeline").length === 1);
      assert(f.parent.querySelectorAll('.report-set-timeline-cell[data-tone="gap"]').length === 3);
    } finally { f.dispose(); }
  });

  test("report set: lazy mounting has labelled controls and requires explicit reading", () => {
    const f = fixture();
    try {
      assert(f.store.calls.length === 0);
      assert(f.q("prepare").disabled && f.q("json").disabled);
      assert(f.q("status").getAttribute("role") === "status");
      assert(f.q("title").labels.length === 1);
      assert(f.q("file").labels.length === 1);
      assert(f.q("short-addresses").checked);
      assert(!f.q("notes").checked);
    } finally { f.dispose(); }
  });

  test("report set: native checkbox selection preserves focused nodes", async () => {
    const f = fixture();
    try {
      await f.load();
      const first = f.parent.querySelector(".report-set-choice-check");
      first.focus(); first.click();
      assert(document.activeElement === first);
      assert(first.checked);
      f.choice(2);
      assert(f.parent.querySelector(".report-set-choice-check") === first);
      assert(f.mounted.getState().selection.length === 2);
    } finally { f.dispose(); }
  });

  test("report set: hidden choices remain selected and are disclosed before acceptance", async () => {
    const f = fixture();
    try {
      await f.load(); f.choice(1); f.choice(2);
      f.set("search", "報告 3", "input");
      assert(f.q("selection-count").textContent.includes("対象外 2件"));
      const labels = [...f.parent.querySelectorAll(".report-set-choice")];
      assert(labels.filter(label => getComputedStyle(label).display !== "none").length === 1);
      f.click("select-visible"); f.click("prepare");
      assert(f.q("review-text").textContent.includes("報告 1"));
      assert(f.q("review-text").textContent.includes("報告 3"));
      assert(f.q("result").hidden);
    } finally { f.dispose(); }
  });

  test("report set: accepted continuous evidence renders three cards and tables", async () => {
    const f = fixture();
    try {
      await f.accept();
      assert(!f.q("result").hidden);
      assert(f.q("cards").children.length === 3);
      assert([...f.q("cards").children].every(card => card.dataset.state === "continuous"));
      assert(f.q("ranges").querySelectorAll("table").length === 3);
      assert(f.q("ranges").querySelectorAll("th[scope=col]").length === 12);
      assert(f.q("check-count").textContent.includes("追加確認箇所は見つかりません"));
      assert(f.store.calls.every(call => call[0] === "read"));
    } finally { f.dispose(); }
  });

  test("report set: diagnostic filter exposes conflicts without changing accepted evidence", async () => {
    const f = fixture({ initial: demoSetHistory() });
    try {
      await f.accept();
      const original = f.mounted.getState().input;
      f.set("check-agent", "EMA"); f.set("check-severity", "conflict");
      assert(f.q("check-list").children.length > 0);
      assert([...f.q("check-list").children].every(item => item.dataset.severity === "conflict"));
      assert(f.q("check-list").querySelectorAll("details details").length > 0);
      f.set("check-search", "absent search result", "input");
      assert(f.q("check-count").textContent.startsWith("0/"));
      assert(f.mounted.getState().input === original);
    } finally { f.dispose(); }
  });

  test("report set: archive filter discloses a hidden report and never restores it", async () => {
    const f = fixture({ initial: demoSetHistory() });
    try {
      await f.load(); f.set("archive", "archived"); f.click("select-visible"); f.click("prepare");
      assert(f.q("review-text").textContent.includes("非表示保管"));
      f.click("apply"); await f.settled();
      assert(f.mounted.getState().result.archivedCount === 1);
      assert(f.store.document.entries[6].archived);
    } finally { f.dispose(); }
  });

  test("report set: native File imports require a review before replacing the screen", async () => {
    const f = fixture({ initial: historyDocument() });
    try {
      const file = await prepareReportSetFile(sequenceSet());
      await f.file(file.text);
      assert(!f.q("review").hidden && f.q("result").hidden);
      assert(f.q("file").value === "");
      f.click("apply"); await f.settled();
      assert(f.q("origin").textContent.includes("確認セットJSON"));
      assert(f.store.document.entries.length === 0);
      assert(f.store.calls.length === 0);
    } finally { f.dispose(); }
  });

  test("report set: canceled imported file leaves the preceding result intact", async () => {
    const f = fixture();
    try {
      await f.accept(); const previous = f.mounted.getState().input;
      await f.file((await prepareReportSetFile(sequenceSet(sequenceHistory([0n, 24n])))).text);
      f.click("cancel");
      assert(f.mounted.getState().input === previous);
      assert(f.q("review").hidden);
    } finally { f.dispose(); }
  });

  test("report set: native SHA-256 rejects changed evidence with an old checksum", async () => {
    const f = fixture();
    try {
      await f.accept(); const previous = f.mounted.getState().result;
      const data = JSON.parse((await prepareReportSetFile(sequenceSet())).text);
      data.input.entries[0].note = "changed";
      await f.file(JSON.stringify(data));
      assert(f.mounted.getState().result === previous);
      assert(f.q("status").dataset.error === "true");
      assert(f.q("review").hidden);
    } finally { f.dispose(); }
  });

  for (const format of ["json", "html", "csv"]) {
    test("report set: " + format + " export requires acknowledgement and produces a bounded file", async () => {
      const f = fixture();
      try {
        await f.accept();
        assert(f.q(format).disabled);
        f.check("ack"); f.click(format); await f.settled();
        assert(f.files.length === 1);
        assert(f.files[0].filename.endsWith("." + format));
        assert(new TextEncoder().encode(f.files[0].text).byteLength === f.files[0].byteLength);
        if (format === "json") {
          const decoded = await decodeReportSetFile(f.files[0].text);
          assert(analyzeReportSet(decoded.input).allContinuous);
        } else {
          assert(!f.files[0].text.includes("確認用メモ 1"));
        }
      } finally { f.dispose(); }
    });
  }

  test("report set: explanation export settings do not strip the original JSON evidence", async () => {
    const f = fixture();
    try {
      await f.accept(); f.check("ack"); f.check("notes"); f.check("short-addresses", false);
      f.click("html"); await f.settled();
      assert(f.files[0].text.includes("確認用メモ 1"));
      const account = f.mounted.getState().input.entries[0].report.slots[0].entry.draft.plan.context.account;
      assert(f.files[0].text.includes(account));
      f.check("notes", false); f.check("short-addresses");
      f.click("json"); await f.settled();
      assert(f.files[1].text.includes(account));
      assert(f.files[1].text.includes("確認用メモ 1"));
    } finally { f.dispose(); }
  });

  test("report set: text from a hostile report name cannot create elements", async () => {
    const initial = clone(sequenceHistory([0n, 24n]));
    initial.entries[0].label = '<img src=x onerror="alert(1)">';
    const f = fixture({ initial });
    try {
      await f.accept();
      assert(f.q("check-list").textContent.includes("<img"));
      assert(f.parent.querySelectorAll("img,script,iframe").length === 0);
      f.check("ack"); f.click("html"); await f.settled();
      const parsed = new DOMParser().parseFromString(f.files[0].text, "text/html");
      assert(parsed.querySelectorAll("img,script,iframe,form").length === 0);
      assert(parsed.querySelector("meta[http-equiv]").content.includes("connect-src 'none'"));
    } finally { f.dispose(); }
  });

  test("report set: browser result stays immutable after local source metadata changes", async () => {
    const f = fixture();
    try {
      await f.accept(); const original = f.mounted.getState().input;
      const changed = clone(f.store.document); changed.entries[0].label = "later label";
      f.store.replace(changed);
      f.click("inspect"); await f.settled();
      assert(f.q("inspection").textContent.includes("名前・メモ・保管状態が変更"));
      assert(f.mounted.getState().input === original);
      assert(!f.q("summary").textContent.includes("later label"));
    } finally { f.dispose(); }
  });

  test("report set: IndexedDB source can close and reopen without read-only review changing it", async () => {
    await withDatabase(async connect => {
      const writer = connect();
      const empty = await writer.read();
      const saved = await writer.change(empty.revision, { kind: "merge", document: sequenceHistory(), skipConflicts: false });
      const f = fixture({ store: { storage: connect() } });
      try {
        await f.accept(); f.check("ack"); f.click("json"); await f.settled();
        assert(JSON.stringify(await writer.read()) === JSON.stringify(saved));
        f.dispose();
        const next = fixture({ store: { storage: connect() } });
        try {
          await next.load();
          assert(next.mounted.getState().document.entries.length === 3);
          assert(next.mounted.getState().selection.length === 0);
          await next.file(f.files[0].text);
          next.click("apply"); await next.settled();
          assert(next.mounted.getState().result.allContinuous);
          assert(JSON.stringify(await writer.read()) === JSON.stringify(saved));
        } finally { next.dispose(); }
      } finally { f.dispose(); }
    });
  });

  test("report set: a second IndexedDB writer changing a selected source blocks pending acceptance", async () => {
    await withDatabase(async connect => {
      const writer = connect();
      await writer.change(0, { kind: "merge", document: sequenceHistory(), skipConflicts: false });
      const f = fixture({ store: { storage: connect() } });
      try {
        await f.load(); f.click("select-visible"); f.click("prepare");
        const current = await writer.read();
        await writer.change(current.revision, { kind: "annotate", id: id(101), label: "another tab",
          note: "later", tags: [], time: AFTER });
        f.click("apply"); await f.settled();
        assert(f.mounted.getState().error === "PERIOD_SET_SOURCE_CHANGED");
        assert(f.mounted.getState().input === null);
        assert((await writer.read()).entries[0].label === "another tab");
      } finally { f.dispose(); }
    });
  });

  test("report set: canceled pending read does not overwrite browser controls later", async () => {
    const gate = deferred();
    const store = historyMemory(sequenceHistory(), { beforeRead: () => gate.promise });
    const f = fixture({ store });
    try {
      f.click("refresh");
      assert(f.q("file").disabled);
      f.click("cancel"); gate.resolve(); await f.settled();
      assert(!f.mounted.getState().loaded);
      assert(f.q("choices").children.length === 0);
    } finally { f.dispose(); }
  });
}
