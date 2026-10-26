import { mountHistoryPanel } from "/examples/history-panel.js";
import { encodePortfolioReport } from "/src/portfolio-report.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";

const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "33".repeat(20);
function snapshot(block = "42", changes = {}) {
  return {
    agent: "DAT", account: ACCOUNT, chainId: 84532,
    siteOrigin: "http://localhost:4184", connectionEpoch: 1,
    blockNumber: block, blockHash: "0x" + "ab".repeat(32),
    nativeBalanceBaseUnits: "16", readOnly: true, securityAudit: false,
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: "42", notice: null }],
    ...changes,
  };
}
function archive(rows) {
  const history = createPortfolioHistory();
  history.merge(rows);
  return history.exportText();
}
export function registerHistoryUITests(test) {
  const assert = (condition, text) => { if (!condition) throw Error(text); };
  function scenario(name, action) {
    test("history: " + name, () => {
      const parent = document.createElement("section");
      document.querySelector("#grid").append(parent);
      let current = snapshot();
      let report = encodePortfolioReport(current);
      const panel = mountHistoryPanel({ document, parent, agent: "DAT",
        getSnapshot: () => current, getReport: () => report });
      const find = selector => parent.querySelector(selector);
      const click = selector => find(selector).click();
      const input = value => {
        find(".history-json").value = value;
        find(".history-json").dispatchEvent(new Event("input", { bubbles: true }));
      };
      const count = () => parent.querySelectorAll(".history-list li").length;
      try { action({ parent, panel, find, click, input, count,
        current: value => { current = value; }, report: value => { report = value; } }); }
      finally { panel.dispose(); parent.remove(); }
    });
  }
  scenario("initial state disables destructive and apply controls", ({ find, count }) => {
    assert(count() === 0, "empty history");
    for (const selector of [".history-apply", ".history-remove", ".history-clear", ".history-compare"]) {
      assert(find(selector).disabled, selector + " disabled");
    }
  });
  scenario("silent replacement-mode changes require a fresh review", ({ click, find, input, count }) => {
    click(".history-add-current");
    input(archive([snapshot("99")]));
    find(".history-replace").checked = true;
    click(".history-preview");
    // A property assignment need not emit change (e.g. restored form state).
    find(".history-replace").checked = false;
    click(".history-apply");
    assert(count() === 1, "original count preserved");
    assert(find(".history-list").textContent.includes("block 42"), "reviewed replacement was not applied");
    assert(find(".history-apply").disabled, "old review consumed");
    click(".history-preview");
    click(".history-apply");
    assert(count() === 2, "explicit fresh merge succeeds");
  });
  scenario("custom holdings validator cannot inject a record or HTML", ({ current, click, count, find }) => {
    click(".history-add-current");
    const next = snapshot("99"); let touched = 0;
    next.holdings.map = () => { touched++; return [{ address: "<img src=x>", privateKey: "fixture-only" }]; };
    current(next); click(".history-add-current");
    assert(touched === 0, "untrusted map was not invoked");
    assert(count() === 1, "existing history preserved");
    assert(!find(".history-list").querySelector("img"), "nothing interpreted as HTML");
  });
  scenario("holding accessors cannot clear existing history during validation", ({ current, click, count, panel }) => {
    click(".history-add-current");
    const before = panel.exportArchive(); const next = snapshot("99"); let calls = 0;
    Object.defineProperty(next.holdings, "0", { get() { calls++; throw Error("fixture-accessor"); } });
    current(next); click(".history-add-current");
    assert(calls === 0 && count() === 1, "getter refused and history preserved");
    assert(panel.exportArchive() === before, "byte-identical archive");
  });
  for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
    test("history: " + agent + " checks the captured identity before adding a snapshot", () => {
      const parent = document.createElement("section"); document.querySelector("#grid").append(parent);
      const other = ["DAT", "EMA", "CAWELON"][(index + 1) % 3];
      let reads = 0;
      let next = new Proxy(snapshot("42", { agent: other }), { get(target, key) {
        if (key === "agent" && reads++ === 0) return agent;
        return Reflect.get(target, key);
      } });
      const panel = mountHistoryPanel({ document, parent, agent, getSnapshot: () => next, getReport: () => "" });
      try {
        parent.querySelector(".history-add-current").click();
        assert(JSON.parse(panel.exportArchive()).reports.length === 0, "other token rejected");
        assert(reads === 0, "no proxy value getter used");
        next = snapshot("43", { agent });
        parent.querySelector(".history-add-current").click();
        assert(JSON.parse(panel.exportArchive()).reports[0].snapshot.agent === agent, "own token accepted");
      } finally { panel.dispose(); parent.remove(); }
    });
    test("history: " + agent + " reviewed replacement and recovery preserve saved observations", () => {
      const parent = document.createElement("section"); document.querySelector("#grid").append(parent);
      const panel = mountHistoryPanel({ document, parent, agent,
        getSnapshot: () => snapshot("42", { agent }), getReport: () => "" });
      const click = name => parent.querySelector(name).click();
      try {
        click(".history-add-current"); const before = panel.exportArchive();
        const json = parent.querySelector(".history-json");
        json.value = archive([snapshot("99", { agent })]); json.dispatchEvent(new Event("input"));
        parent.querySelector(".history-replace").checked = true;
        click(".history-preview");
        assert(panel.exportArchive() === before, "preview did not replace");
        click(".history-apply");
        const after = JSON.parse(panel.exportArchive());
        assert(after.reports.length === 1 && after.reports[0].snapshot.blockNumber === "99", "replacement verified");
        assert(after.reports[0].snapshot.agent === agent, "token identity retained");
        assert(parent.querySelector(".history-apply").disabled, "single use review");
        click(".history-recovery-preview");
        assert(JSON.parse(panel.exportArchive()).reports[0].snapshot.blockNumber === "99", "recovery preview is read-only");
        click(".history-recovery-apply");
        assert(panel.exportArchive() === before, "reviewed recovery restores the exact original archive");
      } finally { panel.dispose(); parent.remove(); }
    });
  }
  scenario("current snapshot is added and deduplicated", ({ click, count, find }) => {
    click(".history-add-current");
    click(".history-add-current");
    assert(count() === 1, "duplicate not added");
    assert(find(".history-status").textContent.includes("同じ記録"), "duplicate status");
  });
  scenario("missing current result does not create a record", ({ current, click, count }) => {
    current(null);
    click(".history-add-current");
    assert(count() === 0, "no fabricated snapshot");
  });
  scenario("single historical report can be added", ({ report, click, count }) => {
    report(encodePortfolioReport(snapshot("99")));
    click(".history-add-report");
    assert(count() === 1, "report added");
  });
  scenario("other agent report is refused", ({ report, click, count }) => {
    report(encodePortfolioReport(snapshot("99", { agent: "EMA" })));
    click(".history-add-report");
    assert(count() === 0, "agent isolation");
  });
  scenario("conflicting observation retains original", ({ click, current, count, find }) => {
    click(".history-add-current");
    current(snapshot("42", { nativeBalanceBaseUnits: "99" }));
    click(".history-add-current");
    assert(count() === 1, "original retained");
    assert(find(".history-status").textContent.includes("矛盾"), "conflict explained");
  });
  scenario("archive preview does not commit before explicit apply", ({ input, click, count, find }) => {
    input(archive([snapshot()]));
    click(".history-preview");
    assert(count() === 0, "preview no mutation");
    assert(!find(".history-apply").disabled, "apply enabled");
    click(".history-apply");
    assert(count() === 1, "explicit apply");
    assert(find(".history-apply").disabled, "single use");
  });
  scenario("editing JSON invalidates reviewed content", ({ input, click, count, find }) => {
    input(archive([snapshot()]));
    click(".history-preview");
    input(archive([snapshot("43")]));
    assert(find(".history-apply").disabled, "edited preview disabled");
    click(".history-apply");
    assert(count() === 0, "not applied");
  });
  scenario("changing merge mode invalidates preview", ({ input, click, find }) => {
    input(archive([snapshot()]));
    click(".history-preview");
    find(".history-replace").checked = true;
    find(".history-replace").dispatchEvent(new Event("change"));
    assert(find(".history-apply").disabled, "mode change needs review");
  });
  scenario("other agent archive never becomes applicable", ({ input, click, find, count }) => {
    input(archive([snapshot("42", { agent: "EMA" })]));
    click(".history-preview");
    assert(find(".history-apply").disabled, "wrong agent disabled");
    assert(count() === 0, "no mixed history");
  });
  scenario("malformed import retains existing history", ({ input, click, count, find }) => {
    click(".history-add-current");
    input("<img src=x onerror=alert(1)>");
    click(".history-preview");
    assert(count() === 1, "existing retained");
    assert(find(".history-apply").disabled, "invalid preview disabled");
    assert(!find(".history-status").querySelector("img"), "text only");
  });
  scenario("explicit replace changes history only after apply", ({ click, find, input, count }) => {
    click(".history-add-current");
    input(archive([snapshot("100")]));
    find(".history-replace").checked = true;
    find(".history-replace").dispatchEvent(new Event("change"));
    click(".history-preview");
    assert(count() === 1, "original before apply");
    click(".history-apply");
    assert(count() === 1 && find(".history-list").textContent.includes("100"), "replaced");
  });
  scenario("timeline and selected comparison render exact values", ({ click, current, find }) => {
    click(".history-add-current");
    current(snapshot("43", { nativeBalanceBaseUnits: "17" }));
    click(".history-add-current");
    click(".history-compare");
    assert(find(".history-details").textContent.includes("+1"), "exact difference");
    click(".history-timeline");
    assert(find(".history-details").textContent.includes("42 → 43"), "timeline");
  });
  scenario("explicit remove affects selected record only", ({ click, current, count, find }) => {
    click(".history-add-current");
    current(snapshot("43"));
    click(".history-add-current");
    click(".history-remove");
    assert(count() === 1 && find(".history-list").textContent.includes("42"), "selected removed");
  });
  scenario("clear requires acknowledgement and exported text survives", ({ click, find, count }) => {
    click(".history-add-current");
    click(".history-export");
    const saved = find(".history-json").value;
    click(".history-clear");
    assert(count() === 1, "unconfirmed clear blocked");
    find(".history-clear-confirm").checked = true;
    click(".history-clear");
    assert(count() === 0, "confirmed clear");
    assert(find(".history-json").value === saved, "export survives clearing");
  });
  scenario("context invalidation cancels import without erasing saved records", ({ click, input, panel, count, find }) => {
    click(".history-add-current");
    input(archive([snapshot("43")]));
    click(".history-preview");
    panel.invalidate();
    assert(count() === 1, "history retained");
    assert(find(".history-apply").disabled, "context review invalidated");
  });
  scenario("new records invalidate an old clear acknowledgement", ({ click, find, current }) => {
    click(".history-add-current");
    find(".history-clear-confirm").checked = true;
    current(snapshot("43"));
    click(".history-add-current");
    assert(!find(".history-clear-confirm").checked, "new contents require fresh confirmation");
  });
  scenario("changing comparison selection removes an old result", ({ click, find, current }) => {
    click(".history-add-current");
    current(snapshot("43"));
    click(".history-add-current");
    click(".history-compare");
    assert(find(".history-details").textContent.length > 0, "comparison visible");
    find(".history-first").dispatchEvent(new Event("change"));
    assert(find(".history-details").textContent === "", "old result cleared");
  });
  scenario("disposed controls cannot mutate detached history", ({ click, find, panel }) => {
    const add = find(".history-add-current");
    click(".history-add-current");
    panel.dispose();
    add.click();
    assert(!find(".history-panel"), "panel removed");
  });
}

