import { mountHistoryFiles } from "/examples/history-files.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";

const TOKEN = "0x" + "33".repeat(20);
const ACCOUNT = "0x" + "11".repeat(20);
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
function text(rows = [snapshot()]) {
  const history = createPortfolioHistory();
  history.merge(rows);
  return history.exportText();
}
const delay = () => new Promise(resolve => setTimeout(resolve, 0));
export function registerHistoryFileUITests(test) {
  const assert = (value, message) => { if (!value) throw Error(message); };
  function scenario(name, action) {
    test("history: files " + name, async () => {
      const parent = document.createElement("section");
      document.querySelector("#grid").append(parent);
      const history = createPortfolioHistory();
      history.add(snapshot());
      const downloads = [], imports = [];
      const panel = mountHistoryFiles({ document, parent, agent: "DAT",
        getArchive: () => history.exportText(), getRevision: () => history.state().revision,
        onImportText: value => imports.push(value),
        download: ({ prepared }) => downloads.push(prepared),
      });
      const find = suffix => parent.querySelector(".history-" + suffix);
      const click = suffix => find(suffix).click();
      const input = (suffix, value) => {
        find(suffix).value = value;
        find(suffix).dispatchEvent(new Event("input", { bubbles: true }));
      };
      const selectFile = async (content, name = "history.json") => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([content], name, { type: "application/json" }));
        find("file-input").files = transfer.files;
        find("file-input").dispatchEvent(new Event("change", { bubbles: true }));
        for (let n = 0; n < 100 && find("file-input").disabled; n++) await delay();
      };
      try { await action({ parent, panel, history, downloads, imports, find, click, input, selectFile }); }
      finally { panel.dispose(); parent.remove(); }
    });
  }
  scenario("download starts only after an explicit click", ({ downloads, click, find }) => {
    assert(downloads.length === 0, "no automatic download");
    click("file-save");
    assert(downloads.length === 1, "explicit download");
    assert(downloads[0].filename === "ThreeCore-DAT-history-r1.json", "safe name");
    assert(find("backup-state").textContent.includes("保存完了はブラウザーで確認"), "no unverified save claim");
  });
  scenario("file selection loads JSON without applying it", async ({ selectFile, imports, history, find }) => {
    await selectFile(text([snapshot("100")]));
    assert(imports.length === 1, "JSON loaded");
    assert(JSON.parse(imports[0]).reports[0].snapshot.blockNumber === "100", "correct contents");
    assert(history.state().snapshots[0].blockNumber === "42", "not applied");
    assert(find("file-status").textContent.includes("まだ履歴は変更していません"), "preview instruction");
  });
  scenario("another agent file cannot overwrite input", async ({ selectFile, imports, find }) => {
    await selectFile(text([snapshot("100", { agent: "EMA" })]));
    assert(imports.length === 0, "agent mismatch refused");
    assert(find("file-status").textContent.includes("別のトークン"), "clear explanation");
  });
  scenario("malformed file is rejected without injected HTML", async ({ selectFile, imports, find }) => {
    await selectFile('<img src=x onerror="alert(1)">');
    assert(imports.length === 0, "invalid JSON refused");
    assert(!find("file-status").querySelector("img"), "text only");
  });
  scenario("wrong extension is rejected", async ({ selectFile, imports, find }) => {
    await selectFile(text(), "history.txt");
    assert(imports.length === 0, "wrong extension");
    assert(find("file-status").textContent.includes(".json"), "extension instruction");
  });
  scenario("BOM JSON file can be read", async ({ selectFile, imports }) => {
    await selectFile("\ufeff" + text());
    assert(imports.length === 1, "BOM accepted");
  });
  scenario("empty files do not clear old records", async ({ selectFile, history, find }) => {
    await selectFile("");
    assert(history.state().size === 1, "old records remain");
    assert(find("file-status").textContent.includes("空のファイル"), "empty explained");
  });
  scenario("filter rows and subset export preserve original collection", ({ history, click, input, downloads, find }) => {
    history.add(snapshot("43"));
    input("filter-maximum", "42");
    click("filter-run");
    assert(find("filter-results").textContent.startsWith("1 / 2件"), "filtered count");
    click("file-save-subset");
    assert(downloads.length === 1 && downloads[0].observationCount === 1, "subset only");
    assert(history.state().size === 2, "source preserved");
    assert(find("file-status").textContent.includes("全履歴の保存ではありません"), "partial explained");
  });
  scenario("filter edits invalidate prior subset export", ({ click, input, find }) => {
    click("filter-run");
    assert(!find("file-save-subset").disabled, "initial export available");
    input("filter-minimum", "42");
    assert(find("file-save-subset").disabled, "new filter requires review");
  });
  scenario("invalid numeric filter is not coerced to a different chain", ({ click, input, find }) => {
    input("filter-chain", "0x2105");
    click("filter-run");
    assert(find("file-save-subset").disabled, "invalid query cannot export");
  });
  scenario("no matches cannot be mistaken for deletion", ({ click, input, find, history }) => {
    input("filter-minimum", "100");
    click("filter-run");
    assert(find("filter-results").textContent.startsWith("0 / 1件"), "zero results");
    assert(history.state().size === 1, "not deleted");
  });
  scenario("reset removes filters without changing archive", ({ click, input, find, history }) => {
    input("filter-minimum", "100");
    click("filter-run");
    click("filter-reset");
    assert(find("filter-minimum").value === "", "reset filter");
    assert(find("filter-results").textContent === "", "results cleared");
    assert(history.state().size === 1, "archive unchanged");
  });
  scenario("new records reset backup and stale subset state", ({ click, history, panel, find }) => {
    click("file-save");
    click("filter-run");
    history.add(snapshot("43"));
    panel.invalidate();
    assert(find("file-save-subset").disabled, "stale subset invalid");
    assert(find("backup-state").textContent.includes("まだファイルとして"), "new backup needed");
  });
  scenario("descending order uses block numbers rather than text", ({ history, click, find }) => {
    history.add(snapshot("100"));
    find("filter-order").value = "newest";
    find("filter-order").dispatchEvent(new Event("change"));
    click("filter-run");
    const rows = find("filter-results").textContent.split("\n");
    assert(rows[1].includes("block 100"), "numeric order");
  });
  scenario("sequential valid files replace the candidate only", async ({ selectFile, imports, history }) => {
    await selectFile(text([snapshot("43")]));
    await selectFile(text([snapshot("44")]));
    assert(imports.length === 2, "two explicit selections");
    assert(JSON.parse(imports[1]).reports[0].snapshot.blockNumber === "44", "latest candidate");
    assert(history.state().size === 1, "neither auto-applied");
  });
  scenario("accessible names identify file and filter controls", ({ find }) => {
    for (const suffix of ["file-input", "filter-account", "filter-chain", "filter-minimum", "filter-maximum"]) {
      assert(Boolean(find(suffix).getAttribute("aria-label")), suffix + " label");
    }
    assert(find("file-status").getAttribute("role") === "status", "status role");
  });
}
