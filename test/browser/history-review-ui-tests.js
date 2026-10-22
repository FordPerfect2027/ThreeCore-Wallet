import { mountHistoryReview } from "/examples/history-review-panel.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";
const ACCOUNT = "0x" + "11".repeat(20);
function archive(block = "42", changes = {}) {
  const history = createPortfolioHistory();
  if (block !== null) history.add({
    agent: "DAT", account: ACCOUNT, chainId: 84532, siteOrigin: "http://localhost:4184",
    connectionEpoch: 1, blockNumber: block, blockHash: "0x" + "ab".repeat(32),
    nativeBalanceBaseUnits: "16", readOnly: true, securityAudit: false,
    holdings: [{ address: "0x" + "33".repeat(20), hasCode: true, balanceBaseUnits: "42", notice: null }],
    ...changes,
  });
  return history.exportText();
}
export function registerHistoryReviewUITests(test) {
  const assert = (value, message) => { if (!value) throw Error(message); };
  function scenario(name, action) {
    test("history: review " + name, () => {
      const parent = document.createElement("section");
      document.querySelector("#grid").append(parent);
      let current = archive(), incoming = archive("43"), revision = 1, replace = false;
      const downloads = [];
      const panel = mountHistoryReview({ document, parent, agent: "DAT",
        getArchive: () => current, getIncoming: () => incoming,
        getRevision: () => revision, getReplace: () => replace,
        download: ({ prepared }) => downloads.push(prepared),
      });
      const find = suffix => parent.querySelector(".history-review-" + suffix);
      const click = suffix => find(suffix).click();
      try { action({ panel, find, click, downloads,
        current: text => { current = text; }, incoming: text => { incoming = text; },
        revision: value => { revision = value; }, replace: value => { replace = value; } }); }
      finally { panel.dispose(); parent.remove(); }
    });
  }
  scenario("does not generate reports until asked", ({ find, downloads }) => {
    assert(find("details").textContent === "", "initial empty state");
    assert(find("save").disabled, "JSON save disabled");
    assert(find("save-text").disabled, "text save disabled");
    assert(downloads.length === 0, "no automatic downloads");
  });
  scenario("shows current coverage and limits", ({ click, find }) => {
    click("current");
    assert(find("details").textContent.includes("記録: 1件"), "count shown");
    assert(find("details").textContent.includes("監査・安全性の判定ではありません"), "coverage not audit");
    assert(!find("save").disabled, "explicit export available");
  });
  scenario("shows empty-history warning without fabricated data", ({ current, click, find }) => {
    current(archive(null));
    click("current");
    assert(find("details").textContent.includes("履歴は空です"), "empty warning");
  });
  scenario("shows unknown balances as unknown", ({ current, click, find }) => {
    current(archive("42", { holdings: [{ address: "0x" + "33".repeat(20), hasCode: false,
      balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }] }));
    click("current");
    assert(find("details").textContent.includes("ゼロ残高とは異なります"), "unknown warning");
  });
  scenario("shows replacement exclusion before applying", ({ replace, click, find }) => {
    replace(true);
    click("impact");
    assert(find("details").textContent.includes("除外予定: DAT"), "excluded record visible");
    assert(find("status").textContent.includes("まだ適用していません"), "not applied");
  });
  scenario("exports structured coverage separately from restore JSON", ({ click, downloads, find }) => {
    click("current");
    click("save");
    assert(downloads[0].filename === "ThreeCore-DAT-coverage-r1.json", "review filename");
    assert(JSON.parse(downloads[0].text).schema === "threecore-history-review-v1", "review schema");
    assert(find("status").textContent.includes("復元用の履歴ファイルではありません"), "distinct purpose");
  });
  scenario("exports a readable explanation as text", ({ click, downloads, find }) => {
    click("current");
    const text = find("details").textContent;
    click("save-text");
    assert(downloads[0].filename.endsWith(".txt"), "text extension");
    assert(downloads[0].text === text, "displayed explanation preserved");
  });
  scenario("refuses stale revision for both export formats", ({ click, revision, downloads, find }) => {
    click("current");
    revision(2);
    click("save-text");
    assert(downloads.length === 0, "stale text not exported");
    assert(find("save").disabled, "JSON disabled too");
  });
  scenario("refuses changed incoming data after impact review", ({ click, incoming, downloads }) => {
    click("impact");
    incoming(archive("99"));
    click("save");
    assert(downloads.length === 0, "stale impact not exported");
  });
  scenario("refuses changed import mode", ({ click, replace, downloads }) => {
    click("impact");
    replace(true);
    click("save");
    assert(downloads.length === 0, "stale mode not exported");
  });
  scenario("does not execute bad JSON as HTML", ({ click, incoming, find }) => {
    incoming('<img src=x onerror="alert(1)">');
    click("impact");
    assert(!find("status").querySelector("img"), "no HTML injection");
    assert(find("save").disabled, "invalid report unavailable");
  });
  scenario("clears a previous result if a new impact fails", ({ click, incoming, find }) => {
    click("current");
    incoming("broken");
    click("impact");
    assert(find("details").textContent === "", "old result removed");
    assert(find("save-text").disabled, "old text not downloadable");
  });
  scenario("refuses different-agent candidate", ({ click, incoming, find }) => {
    incoming(archive("43", { agent: "EMA" }));
    click("impact");
    assert(find("save").disabled, "agent boundary enforced");
  });
  scenario("clear and invalidation disable report exports", ({ click, panel, find }) => {
    click("current");
    panel.invalidate();
    assert(find("save").disabled, "invalidated JSON");
    click("current");
    click("clear");
    assert(find("details").textContent === "", "cleared description");
    assert(find("save-text").disabled, "cleared text");
  });
  scenario("uses accessible status updates", ({ find }) => {
    assert(find("status").getAttribute("role") === "status", "status role");
    assert(find("status").getAttribute("aria-live") === "polite", "polite announcement");
  });
}
