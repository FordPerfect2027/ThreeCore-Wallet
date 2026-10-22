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

