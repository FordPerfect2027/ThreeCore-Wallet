import { decodePeriodLibraryFile } from "/src/period-library-file.js";
import { mountPeriodPanel } from "/examples/period-panel.js";
import { checkpoint as proposalCheckpoint } from "/test/helpers/period-fixtures.js";
import { manyEventsInput } from "/test/helpers/period-report-fixtures.js";
import { mountReportSetPanel } from "/examples/report-set-panel.js";
import { createReportHistoryStorage } from "/src/report-history-storage.js";
import { prepareReportSetFile, decodeReportSetFile } from "/src/report-set-file.js";
import { prepareReportSetEventComparisonFile, prepareReportSetChecksFile, prepareReportSetComparisonFile, prepareReportSetCoverageFile, prepareReportSetComparisonEvidenceFile, reviewReportSetComparisonEvidence } from "/src/report-set-export.js";
import { decodePeriodReportFile } from "/src/period-report-file.js";
import { decodePeriodFile, preparePeriodFile } from "/src/period-file.js";
import { analyzeReportSet } from "/src/report-set-engine.js";
import { sequenceHistory, sequenceSet, demoSetHistory, historyMemory, historyDocument, historyRecord,
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
  test("report set: recover one token collection while retaining source restrictions and refusing conflicting IDs", async () => {
    const source=sequenceSet(sequenceHistory([0n,12n],(report,index)=>report.slots.forEach((slot,n)=>{slot.entry.id=id(1000+3*index+n);slot.entry.requiresNewPlan=true;})));
    const f=fixture();
    try{
      await f.file((await prepareReportSetFile(source)).text);f.click("apply");await f.settled();const original=f.mounted.getState().input;
      f.click("token-library-heading");f.check("ack");assert(f.q("token-library-json").disabled);
      await f.file((await prepareReportSetFile(sequenceSet())).text);const pending=f.mounted.getState().review;
      f.check("token-library-ack");f.click("token-library-json");await f.settled();
      const library=(await decodePeriodLibraryFile(f.files[0].text)).document;
      assert(library.entries.length===2&&library.entries.every(row=>row.requiresNewPlan));
      assert(JSON.stringify(library.entries)===JSON.stringify(source.entries.map(row=>row.report.slots[0].entry)));
      assert(f.mounted.getState().input===original&&f.mounted.getState().review===pending&&f.store.calls.length===0);
      f.set("token-library-agent","EMA");assert(!f.q("token-library-ack").checked&&f.q("token-library-json").disabled);
      f.check("token-library-ack");f.click("apply");await f.settled();assert(f.q("token-library-json").disabled&&!f.q("token-library-ack").checked);
      assert(f.q("token-library-description").textContent.includes("同じ保存番号に異なる"));
    }finally{f.dispose();}
  });

  test("report set: replacement comparison saves before applying and resets its acknowledgement for another candidate", async () => {
    const f = fixture();
    try {
      await f.accept(); const before = f.mounted.getState().input;
      await f.file((await prepareReportSetFile(sequenceSet(demoSetHistory()))).text);
      assert(f.q("review-text").textContent.includes("現在表示中の確認セットとの差"));
      assert(f.q("review-text").textContent.includes("追加 4")); assert(f.q("comparison-json").disabled);
      f.check("comparison-ack"); f.click("comparison-json"); await f.settled();
      const data = JSON.parse(f.files[0].text); assert(data.comparison.counts.added === 4 && !data.restorable);
      assert(f.mounted.getState().input === before && f.mounted.getState().phase === "review");
      await f.file((await prepareReportSetFile(sequenceSet())).text);
      assert(!f.q("comparison-ack").checked && f.q("comparison-json").disabled);
      f.click("apply"); await f.settled(); assert(f.mounted.getState().review === null);
    } finally { f.dispose(); }
  });
  test("report set: a contiguous page saves ten unread windows in one period file", async () => {
    const initial = sequenceHistory([0n], report => {
      const draft = report.slots[0].entry.draft; draft.plan.laterBlock = "24030"; draft.plan.windowSize = 2000;
      draft.earlier = null; draft.later = null; draft.records = [];
    });
    const f = fixture({ initial });
    try {
      await f.accept(); f.parent.querySelector(".report-set-history-coverage summary").click(); f.click("history-queue-show");
      f.set("history-queue-window", "page"); f.click("history-queue-choose"); f.check("ack"); f.click("queue-window-json"); await f.settled();
      const decoded = await decodePeriodFile(f.files[0].text);
      assert(decoded.draft.plan.earlierBlock === "4030" && decoded.draft.plan.laterBlock === "24030" && decoded.draft.plan.windowSize === 2000);
      assert(decoded.draft.earlier === null && decoded.draft.records.length === 0);
      assert(f.q("queue-window-order").textContent.includes("古いブロックから順"));
    } finally { f.dispose(); }
  });
  test("report set: a proposed missing interval saves as an empty period draft after acknowledgement", async () => {
    const initial = sequenceHistory([0n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); });
    const f = fixture({ initial });
    try {
      await f.accept(); const before = f.mounted.getState().input;
      f.parent.querySelector(".report-set-history-coverage summary").click();
      f.click("history-queue-show"); f.set("history-queue-window", "1"); f.click("history-queue-choose");
      assert(f.q("queue-window-selection").textContent.includes("36 ～ 42") && f.q("queue-window-json").disabled);
      f.check("ack"); f.click("queue-window-json"); assert(f.q("history-queue-window").disabled); await f.settled();
      const decoded = await decodePeriodFile(f.files[0].text);
      assert(decoded.draft.plan.earlierBlock === "35" && decoded.draft.plan.laterBlock === "42");
      assert(decoded.draft.earlier === null && decoded.draft.later === null && decoded.draft.records.length === 0);
      f.set("history-queue-size", "3", "input");
      assert(f.q("queue-window-json").disabled && !f.q("ack").checked && f.mounted.getState().input === before);
    } finally { f.dispose(); }
  });
  test("report set: missing-history proposals show 2,000 blocks times ten without executing reads", async () => {
    const initial = sequenceHistory([0n], report => {
      const draft = report.slots[0].entry.draft;
      draft.plan.laterBlock = "24030"; draft.plan.windowSize = 2000;
      draft.earlier = null; draft.later = null; draft.records = [];
    });
    const f = fixture({ initial });
    try {
      await f.accept(); const before = f.mounted.getState().input;
      const coverage = f.parent.querySelector(".report-set-history-coverage"); coverage.querySelector("summary").click();
      const q = name => coverage.querySelector(".report-set-history-queue-" + name);
      q("show").click(); assert(q("output").textContent.includes("20000ブロック / 10回分"));
      q("next").click(); assert(q("page").value === "2" && q("output").textContent.includes("4000ブロック / 2回分"));
      assert(q("next").disabled); q("previous").click(); assert(q("page").value === "1");
      q("size").value = "1000"; q("size").dispatchEvent(new Event("input", { bubbles: true }));
      assert(q("next").disabled && q("output").textContent.includes("表示し直して"));
      q("show").click(); assert(q("output").textContent.includes("10000ブロック / 10回分"));
      assert(f.mounted.getState().input === before && f.files.length === 0);
    } finally { f.dispose(); }
  });
  test("report set: saved history coverage distinguishes a partial record from its plan", async () => {
    const f = fixture({ initial: demoSetHistory() });
    try {
      await f.file((await prepareReportSetFile(sequenceSet(demoSetHistory()))).text);
      f.click("apply"); await f.settled(); const before = f.mounted.getState().input;
      const groups = [...f.parent.querySelectorAll(".report-set-history-coverage")];
      assert(groups.length === 3); const caw = groups[2]; caw.querySelector("summary").click();
      assert(caw.open); assert(caw.querySelector(".report-set-history-coverage-summary").textContent.includes("履歴記録なし 7"));
      const pending = caw.querySelector('[data-kind="pending"]'); pending.click();
      assert(pending.getAttribute("aria-pressed") === "true");
      assert(caw.querySelector(".report-set-history-coverage-detail").textContent.includes("計画はあるが履歴記録なし"));
      const recorded = caw.querySelector('[data-kind="recorded"]'); recorded.click();
      assert(pending.getAttribute("aria-pressed") === "false");
      assert(caw.querySelector(".report-set-history-coverage-detail").textContent.includes("保存区間"));
      assert(f.mounted.getState().input === before && f.files.length === 0);
    } finally { f.dispose(); }
  });
  test("report set: checklist CSV keeps global findings after filtering to zero",async()=>{
    const f=fixture({initial:demoSetHistory()});
    try{
      await f.accept();const original=f.mounted.getState().input;assert(f.q("checks-csv").disabled);f.check("ack");
      f.set("check-severity","conflict");f.click("checks-csv");await f.settled();
      assert(f.files.length===1&&f.files[0].matched>0&&f.files[0].query.severity==="conflict");
      f.set("check-search","no matching check","input");f.click("checks-csv");await f.settled();
      assert(f.files[1].matched===0&&f.files[1].total>0&&f.files[1].text.trimEnd().split("\r\n").length===2);
      f.set("check-search","x".repeat(101),"input");assert(f.q("checks-csv").disabled);
      assert(f.mounted.getState().input===original);
    }finally{f.dispose();}
  });

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

  test("report set: check references remain searchable and exportable in the native screen", async () => {
    const f = fixture({ initial: sequenceHistory([0n, 24n]) });
    try {
      await f.accept(); const original = f.mounted.getState().input;
      const id = f.q("check-list").children[0].getAttribute("data-check-id");
      assert(/^check-\d+$/.test(id));
      f.set("check-search", id.toUpperCase(), "input");
      assert(f.q("check-list").children.length === 1);
      assert(f.q("check-list").children[0].querySelector("summary").textContent.startsWith(id + " / "));
      f.check("ack"); f.click("checks-csv"); await f.settled();
      assert(f.files[0].matched === 1 && f.files[0].total === 3);
      assert(f.files[0].query.search === id && f.mounted.getState().input === original);
      assert(!f.mounted.getState().result.allContinuous);
      f.set("check-search", "", "input"); assert(f.q("check-list").children.length === 3);
    } finally { f.dispose(); }
  });

  test("report set: structured check download retains the source digest and raw observations", async () => {
    const f = fixture({ initial: sequenceHistory([0n, 0n]) });
    try {
      await f.accept(); const original = f.mounted.getState().input;
      assert(f.q("checks-json").disabled); f.check("ack"); f.set("check-severity", "conflict");
      f.click("checks-json"); await f.settled(); const data = JSON.parse(f.files[0].text);
      assert(data.items.some(item => item.observations.length > 0)); assert(data.options.includeNotes === false);
      assert(data.sourcePayloadDigest === (await prepareReportSetFile(original)).digest);
      assert(data.restorable === false && f.mounted.getState().input === original);
      f.set("check-search", "x".repeat(101), "input"); assert(f.q("checks-json").disabled);
    } finally { f.dispose(); }
  });

  test("report set: native file selection compares saved details and saves a bound result", async () => {
    const f = fixture({ initial: sequenceHistory([0n, 0n]) });
    const choose = async text => {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "check-details.json", { type: "application/json" }));
      f.q("check-file").files = transfer.files; f.q("check-file").dispatchEvent(new Event("change", { bubbles: true })); await f.settled();
    };
    try {
      assert(f.q("check-file").disabled); await f.accept(); const input = f.mounted.getState().input;
      const file = await prepareReportSetChecksFile(input); await choose(file.text);
      assert(f.q("check-review-output").textContent.includes("再計算と一致"));
      assert(f.q("check-review-output").textContent.includes("確認が必要な箇所あり"));
      f.check("ack"); f.click("check-review"); await f.settled();
      assert(JSON.parse(f.files[0].text).matchesRecomputation && f.mounted.getState().input === input);
      const changed = JSON.parse(file.text); changed.items = []; await choose(JSON.stringify(changed));
      assert(f.q("check-review-output").textContent.includes("食い違い"));
      assert(f.mounted.getState().checkReview.matchesRecomputation === false && f.q("check-file").value === "");
    } finally { f.dispose(); }
  });

  test("report set: selecting one original exports an unchanged reloadable period report", async () => {
    const f = fixture();
    try {
      assert(f.q("source-report").disabled); await f.accept(); const input = f.mounted.getState().input;
      f.set("source-report", input.entries[1].id); assert(f.q("source-report-json").disabled);
      f.check("ack"); f.click("source-report-json"); await f.settled();
      const decoded = await decodePeriodReportFile(f.files[0].text);
      assert(JSON.stringify(decoded.input) === JSON.stringify(input.entries[1].report));
      assert(f.files[0].sourceReportId === input.entries[1].id && f.mounted.getState().input === input);
      f.set("title", "Another set", "input"); f.click("prepare"); f.click("apply"); await f.settled();
      assert(f.q("source-report").value === "" && f.q("source-report-json").disabled);
    } finally { f.dispose(); }
  });
  test("report set: native saved-comparison review keeps both pending originals unchanged", async () => {
    const f = fixture();
    const choose = async text => {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "saved-comparison.json", { type: "application/json" }));
      f.q("comparison-file").files = transfer.files; f.q("comparison-file").dispatchEvent(new Event("change", { bubbles: true })); await f.settled();
    };
    try {
      assert(f.q("comparison-file").disabled); await f.accept(); const before = f.mounted.getState().input;
      const after = sequenceSet(demoSetHistory()); await f.file((await prepareReportSetFile(after)).text);
      const saved = await prepareReportSetComparisonFile(before, after); await choose(saved.text);
      assert(f.q("comparison-review-output").textContent.includes("再計算と一致"));
      assert(f.q("comparison-review-json").disabled); f.check("comparison-ack"); f.click("comparison-review-json"); await f.settled();
      assert(JSON.parse(f.files[0].text).matchesRecomputation && f.mounted.getState().input === before);
      const changed = JSON.parse(saved.text); changed.comparison.rows = []; await choose(JSON.stringify(changed));
      assert(f.q("comparison-review-output").textContent.includes("食い違い")); assert(f.q("comparison-file").value === "");
      await f.file((await prepareReportSetFile(after)).text);
      assert(f.mounted.getState().comparisonReview === null && f.q("comparison-review-json").disabled);
      assert(!f.q("comparison-ack").checked && f.mounted.getState().input === before);
    } finally { f.dispose(); }
  });


  test("report set: native coverage exports include every group despite a zero-match check filter", async () => {
    const f = fixture({ initial: demoSetHistory() });
    try {
      assert(f.q("coverage-json").disabled); await f.accept(); const before = f.mounted.getState().input;
      assert(f.q("coverage-csv").disabled); f.check("ack"); f.set("check-search", "not in any check", "input");
      f.click("coverage-json"); await f.settled(); const data = JSON.parse(f.files[0].text);
      assert(data.groupCount === 3 && data.summary.allContinuous === false && data.options.shortAddresses === true);
      f.check("short-addresses", false); f.click("coverage-csv"); await f.settled();
      assert(f.files[1].text.includes('"group-summary"'));
      assert(f.files[1].text.includes(before.entries[0].report.slots[0].entry.draft.plan.context.account));
      assert(f.mounted.getState().input === before && f.files.every(file => file.restorable === false));
    } finally { f.dispose(); }
  });


  test("report set: native wrong-format selection provides destination guidance without applying data", async () => {
    const f = fixture();
    try {
      await f.accept(); const original = f.mounted.getState().input;
      await f.file((await preparePeriodFile(original.entries[0].report.slots[0].entry.draft)).text);
      assert(f.q("status").textContent.includes("控えの保存と復元") && f.q("apply").disabled);
      await f.file((await prepareReportSetCoverageFile(original)).text);
      assert(f.q("status").textContent.includes("元の履歴を復元するファイルではありません"));
      await f.file((await prepareReportSetComparisonFile(original, sequenceSet(demoSetHistory()))).text);
      assert(f.q("status").textContent.includes("保存した比較JSONを照合"));
      assert(f.mounted.getState().input === original && f.mounted.getState().review === null);
    } finally { f.dispose(); }
  });


  test("report set: native portable evidence review works without a displayed set and source export has its own acknowledgement", async () => {
    const f = fixture(), before = sequenceSet(), after = sequenceSet(demoSetHistory());
    const choose = async text => {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "comparison-evidence.json", { type: "application/json" }));
      f.q("comparison-evidence-file").files = transfer.files; f.q("comparison-evidence-file").dispatchEvent(new Event("change", { bubbles: true })); await f.settled();
    };
    try {
      assert(!f.q("comparison-evidence-file").disabled); await choose((await prepareReportSetComparisonEvidenceFile(before, after)).text);
      assert(f.mounted.getState().input === null && f.q("comparison-evidence-output").textContent.includes("再計算と一致"));
      f.check("comparison-evidence-review-ack"); f.click("comparison-evidence-review-json"); await f.settled();
      assert(JSON.parse(f.files[0].text).imported === false);
      await f.accept(); const accepted = f.mounted.getState().input; await f.file((await prepareReportSetFile(after)).text);
      f.check("ack"); f.check("comparison-ack"); assert(f.q("comparison-evidence-json").disabled);
      f.check("comparison-evidence-ack"); f.click("comparison-evidence-json"); await f.settled();
      assert(f.files[1].containsOriginalEvidence && f.mounted.getState().input === accepted);
      assert((await reviewReportSetComparisonEvidence(f.files[1].text)).comparisonReview.matchesRecomputation);
      await f.file((await prepareReportSetFile(after)).text); assert(!f.q("comparison-evidence-ack").checked && f.q("comparison-evidence-json").disabled);
      const wrongInner = JSON.parse((await prepareReportSetComparisonEvidenceFile(before, after)).text);
      wrongInner.beforeFileText = JSON.stringify({ schema: "threecore.period-file.v1" }); await choose(JSON.stringify(wrongInner));
      assert(f.q("status").textContent.includes("一式に含まれる") && !f.q("status").textContent.includes("控えの保存と復元"));
      assert(f.mounted.getState().input === accepted);
    } finally { f.dispose(); }
  });


  test("report set: native recovery saves either verified original without changing the displayed set", async () => {
    const f = fixture(), before = sequenceSet(), after = sequenceSet(demoSetHistory());
    const choose = async text => {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "comparison-evidence.json", { type: "application/json" }));
      f.q("comparison-evidence-file").files = transfer.files; f.q("comparison-evidence-file").dispatchEvent(new Event("change", { bubbles: true })); await f.settled();
    };
    try {
      assert(f.q("evidence-source-role").disabled); const bundle = await prepareReportSetComparisonEvidenceFile(before, after);
      await choose(bundle.text); f.set("evidence-source-role", "before");
      f.check("comparison-evidence-review-ack"); assert(f.q("evidence-source-json").disabled);
      f.check("evidence-source-ack"); f.click("evidence-source-json"); await f.settled();
      assert(f.files[0].text === JSON.parse(bundle.text).beforeFileText && f.mounted.getState().input === null);
      f.set("evidence-source-role", "after"); assert(!f.q("evidence-source-ack").checked && f.q("evidence-source-json").disabled);
      f.check("evidence-source-ack"); f.click("evidence-source-json"); await f.settled();
      assert((await decodeReportSetFile(f.files[1].text)).input.entries.length === 7);
      await f.accept(); const accepted = f.mounted.getState().input;
      const changed = JSON.parse(bundle.text), comparison = JSON.parse(changed.comparisonText); comparison.comparison.rows = [];
      changed.comparisonText = JSON.stringify(comparison); await choose(JSON.stringify(changed));
      assert(f.q("evidence-source-role").value === "" && !f.q("evidence-source-ack").checked);
      assert(f.q("comparison-evidence-output").textContent.includes("食い違い"));
      f.set("evidence-source-role", "before"); f.check("evidence-source-ack"); f.click("evidence-source-json"); await f.settled();
      assert(f.files[2].comparisonMatchesRecomputation === false && f.files[2].text === changed.beforeFileText);
      assert(f.mounted.getState().input === accepted && f.q("comparison-evidence-output").textContent.includes("食い違い"));
    } finally { f.dispose(); }
  });

  test("report set: native event comparison limits paging but exports every difference without changing sources", async () => {
    const report = manyEventsInput(57), changed = clone(report);
    for (const row of changed.slots[0].entry.draft.records[0].events) row.amountBaseUnits = "2";
    const f = fixture({ initial: historyDocument([historyRecord(1, { report }), historyRecord(2, { report: changed })]) });
    try {
      await f.accept(); const accepted = f.mounted.getState().input;
      f.set("event-before", id(101)); f.set("event-after", id(102)); f.click("event-compare");
      assert(f.q("event-output").textContent.includes("内容違い 57") && f.q("event-output").textContent.includes("1/2ページ"));
      f.click("event-next"); assert(f.q("event-output").textContent.includes("2/2ページ") && f.q("event-next").disabled);
      f.check("ack"); assert(f.q("event-json").disabled); f.check("event-ack"); f.click("event-json"); await f.settled();
      assert(JSON.parse(f.files[0].text).comparison.differences.length === 57 && f.mounted.getState().input === accepted);
      f.set("event-agent", "EMA"); assert(!f.q("event-ack").checked && f.q("event-json").disabled);
      f.click("event-compare"); assert(f.q("event-output").textContent.includes("一致しています"));
      await f.file((await prepareReportSetFile(sequenceSet())).text); f.click("apply"); await f.settled();
      assert(f.q("event-before").value === "" && f.q("event-json").disabled);
    } finally { f.dispose(); }
  });

  test("report set: native discrepancy selection creates a new unread scope without applying evidence", async () => {
    const initial = sequenceHistory([0n, 0n], (report, index) => { if (index === 1) report.slots[0].entry.draft.records[0].events[0].amountBaseUnits = "1"; });
    const f = fixture({ initial });
    try {
      await f.accept(); const accepted = f.mounted.getState().input;
      f.set("event-before", id(101)); f.set("event-after", id(102)); f.click("event-compare");
      f.set("event-recheck-choice", "e:1"); assert(f.q("event-recheck-range").textContent.includes("35 ～ 35"));
      f.check("event-ack"); assert(f.q("event-recheck-json").disabled);
      f.check("event-recheck-ack"); f.click("event-recheck-json"); await f.settled();
      const decoded = await decodePeriodFile(f.files[0].text);
      assert(decoded.draft.plan.earlierBlock === "34" && decoded.draft.plan.laterBlock === "35");
      assert(decoded.draft.earlier === null && decoded.draft.records.length === 0 && f.mounted.getState().input === accepted);
      f.set("event-agent", "EMA"); assert(f.q("event-recheck-choice").value === "" && !f.q("event-recheck-ack").checked);
      assert(f.q("event-recheck-json").disabled && f.files.length === 1);
    } finally { f.dispose(); }
  });

  test("report set: native direct proposal handoff retains old period evidence until a separate apply", async () => {
    let destination, reads = 0, contexts = 0;
    const initial = sequenceHistory([0n, 0n], (report, index) => { if (index === 1) report.slots[0].entry.draft.records[0].events[0].amountBaseUnits = "1"; });
    const f = fixture({ initial, panel: { stagePeriodProposal: draft => destination.stageProposed(draft) } });
    const target = document.createElement("div"); document.body.append(target);
    const q = name => target.querySelector(".period-" + name);
    destination = mountPeriodPanel({ document, parent: target, getContext() { contexts++; throw Error("NO_CONNECTION"); }, read() { reads++; throw Error("NO_READ"); } });
    try {
      destination.stageSaved(proposalCheckpoint(3), { requiresNewPlan: false }); q("apply").click(); const old = destination.getDraft();
      await f.accept(); const accepted = f.mounted.getState().input;
      f.set("event-before", id(101)); f.set("event-after", id(102)); f.click("event-compare"); f.set("event-recheck-choice", "e:1");
      f.click("event-recheck-send"); await f.settled();
      assert(q("review-text").textContent.includes("新しい未取得") && destination.getDraft() === old && q("apply").disabled && q("start").disabled);
      q("ack").click(); q("apply").click();
      assert(destination.getDraft().plan.earlierBlock === "34" && destination.getDraft().records.length === 0);
      assert(f.mounted.getState().input === accepted && f.files.length === 0 && reads === 0 && contexts === 0);
      f.set("event-agent", "EMA"); assert(f.q("event-recheck-send").disabled);
    } finally { f.dispose(); destination.dispose(); target.remove(); }
  });

  test("set block scope keeps selected and accepted sources while filtering the same token", async () => {
  const initial = sequenceHistory([0n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); });
  const f = fixture({ initial });
  try {
    await f.accept(); const accepted = f.mounted.getState().input, before = JSON.stringify(f.store.document);
    f.set("agent-filter", "DAT"); f.set("block-filter", "36", "input"); f.set("block-scope", "saved");
    assert(f.q("count").textContent.includes("0/1")); assert(f.q("select-visible").disabled);
    assert(f.q("selection-count").textContent.includes("絞り込み対象外 1件"));
    assert(f.mounted.getState().selection.length === 1 && f.mounted.getState().input === accepted);
    f.set("agent-filter", "CAWELON"); assert(f.q("count").textContent.includes("1/1")); assert(!f.q("select-visible").disabled);
    f.set("agent-filter", "DAT"); f.set("block-scope", "planned"); assert(f.q("count").textContent.includes("1/1"));
    f.set("block-filter", "01", "input"); assert(f.q("count").textContent.includes("検索条件")); assert(f.q("select-visible").disabled);
    f.set("block-filter", "", "input"); assert(f.q("count").textContent.includes("1/1"));
    assert(f.mounted.getState().input === accepted && JSON.stringify(f.store.document) === before);
    assert(f.files.length === 0 && f.store.calls.every(call => call[0] === "read"));
  } finally { f.dispose(); }
  });

  test("saved event comparison review distinguishes file fidelity and observed differences", async () => {
  const initial = sequenceHistory([0n, 0n], (report, index) => { if (index) report.slots[0].entry.draft.records[0].events[0].amountBaseUnits = "1"; });
  const f = fixture({ initial });
  try {
    await f.accept(); const before = f.mounted.getState().input;
    const comparison = await prepareReportSetEventComparisonFile(before, { beforeId: id(101), afterId: id(102), agent: "DAT" });
    const transfer = new DataTransfer(); transfer.items.add(new File([comparison.text], "comparison.json", { type: "application/json" })); f.q("event-review-file").files = transfer.files; f.q("event-review-file").dispatchEvent(new Event("change", { bubbles: true }));
    await f.settled(); assert(f.q("event-review-output").textContent.includes("ファイルの内容は再計算と一致"));
    assert(f.q("event-review-output").textContent.includes("保存観測に食い違いあり"));
    assert(f.q("event-review-json").disabled); f.check("event-ack"); assert(f.q("event-review-json").disabled);
    f.check("event-review-ack"); f.click("event-review-json"); await f.settled();
    assert(f.files.length === 1 && JSON.parse(f.files[0].text).matchesRecomputation);
    assert(f.mounted.getState().input === before && f.store.calls.every(row => row[0] === "read"));
    await f.file((await prepareReportSetFile(sequenceSet())).text); f.click("apply"); await f.settled();
    assert(f.mounted.getState().eventComparisonReview === null && f.q("event-review-json").disabled && !f.q("event-review-ack").checked);
  } finally { f.dispose(); }
  });

  test("saved coverage review keeps pending ranges visible and detects changed coverage", async () => {
  const initial = sequenceHistory([0n, 24n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); });
  const f = fixture({ initial });
  try {
    assert(f.q("coverage-review-file").disabled); await f.accept(); const before = f.mounted.getState().input;
    f.q("coverage-review-heading").click();
    const file = await prepareReportSetCoverageFile(before);
    const feed = async text => { const transfer = new DataTransfer(); transfer.items.add(new File([text], "coverage.json", { type: "application/json" })); f.q("coverage-review-file").files = transfer.files; f.q("coverage-review-file").dispatchEvent(new Event("change", { bubbles: true })); await f.settled(); };
    await feed(file.text); assert(f.q("coverage-review-output").textContent.includes("ファイルの内容は再計算と一致"));
    assert(f.q("coverage-review-output").textContent.includes("計画内で履歴記録なし 14"));
    assert(f.q("coverage-review-output").textContent.includes("合算しません"));
    assert(f.q("coverage-review-json").disabled); f.check("ack"); assert(f.q("coverage-review-json").disabled);
    f.check("coverage-review-ack"); f.click("coverage-review-json"); await f.settled();
    assert(f.files.length === 1 && JSON.parse(f.files[0].text).groups[0].pendingPlannedBlocks === "14");
    const altered = JSON.parse(file.text); altered.groups[0].recordedUniqueBlocks = "900";
    await feed(JSON.stringify(altered)); assert(f.q("coverage-review-output").textContent.includes("再計算との食い違い"));
    assert(f.q("coverage-review-json").disabled && !f.q("coverage-review-ack").checked);
    assert(f.mounted.getState().input === before && f.store.calls.every(row => row[0] === "read"));
    await f.file((await prepareReportSetFile(sequenceSet())).text); f.click("apply"); await f.settled();
    assert(f.mounted.getState().coverageReview === null && f.q("coverage-review-json").disabled);
  } finally { f.dispose(); }
  });

}
