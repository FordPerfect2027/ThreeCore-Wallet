import { createPortfolioHistory } from "/src/portfolio-history.js";
import { createHistoryRecovery } from "/src/history-recovery.js";
import { mountHistoryRecovery } from "/examples/history-recovery-panel.js";

function observation(block) {
  return {
    agent: "DAT", account: "0x" + "11".repeat(20), chainId: 84532,
    siteOrigin: "http://localhost:4184", connectionEpoch: 1, blockNumber: block,
    blockHash: "0x" + "ab".repeat(32), nativeBalanceBaseUnits: "16",
    holdings: [{ address: "0x" + "33".repeat(20), hasCode: true, balanceBaseUnits: "42", notice: null }],
    readOnly: true, securityAudit: false,
  };
}
export function registerHistoryRecoveryUITests(test) {
  const assert = (value, message) => { if (!value) throw Error(message); };
  function scenario(name, action) {
    test("history: recovery " + name, () => {
      const parent = document.createElement("section");
      document.querySelector("#grid").append(parent);
      const history = createPortfolioHistory();
      history.merge([observation("1"), observation("2")]);
      const recovery = createHistoryRecovery(history);
      const downloads = [], copies = [];
      let restored = 0;
      const panel = mountHistoryRecovery({ document, parent, agent: "DAT", recovery,
        onRestore: () => { restored++; }, onCopyArchive: text => copies.push(text),
        download: ({ prepared }) => downloads.push(prepared) });
      const find = suffix => parent.querySelector(".history-recovery-" + suffix);
      const click = suffix => find(suffix).click();
      try { action({ history, recovery, panel, find, click, downloads, copies,
        restored: () => restored,
        remove: () => { recovery.remove(0, history.state().revision); panel.refresh(); } }); }
      finally { panel.dispose(); recovery.dispose(); parent.remove(); }
    });
  }
  scenario("starts without an actionable backup", ({ find }) => {
    assert(find("preview").disabled, "no backup preview");
    assert(find("apply").disabled, "no apply");
    assert(find("save").disabled, "no recovery download");
  });
  scenario("requires preview before restoring a removed record", ({ remove, click, history, find }) => {
    remove();
    assert(history.state().size === 1, "record removed");
    assert(find("apply").disabled, "no immediate apply");
    click("preview");
    assert(history.state().size === 1, "preview does not restore");
    assert(find("details").textContent.includes("復元後 2件"), "count visible");
    click("apply");
    assert(history.state().size === 2, "explicitly restored");
  });
  scenario("restores a confirmed clear operation", ({ recovery, panel, click, history }) => {
    recovery.clear(1);
    panel.refresh();
    click("preview");
    assert(history.state().size === 0, "preview remains empty");
    click("apply");
    assert(history.state().size === 2, "restored all");
  });
  scenario("new records disable direct recovery", ({ remove, history, panel, find }) => {
    remove();
    history.add(observation("99"));
    panel.refresh();
    assert(find("preview").disabled, "stale destination");
    assert(!find("copy").disabled, "separate review possible");
    assert(find("status").textContent.includes("履歴が変わっています"), "explained");
  });
  scenario("new records after preview cannot be overwritten", ({ remove, click, history, find, restored }) => {
    remove();
    click("preview");
    history.add(observation("99"));
    click("apply");
    assert(history.state().snapshots[1].blockNumber === "99", "new observation retained");
    assert(restored() === 0, "no restoration callback");
    assert(find("apply").disabled, "stale preview consumed");
  });
  scenario("saves an ordinary recovery archive on demand", ({ remove, click, downloads, history }) => {
    remove();
    click("save");
    assert(downloads.length === 1, "one explicit download");
    assert(downloads[0].filename.endsWith("-before-change.json"), "distinct name");
    assert(JSON.parse(downloads[0].text).reports.length === 2, "prior collection");
    assert(history.state().size === 1, "not restored by downloading");
  });
  scenario("copies archive for separate review without applying it", ({ remove, click, copies, history }) => {
    remove();
    click("copy");
    assert(copies.length === 1, "candidate copied");
    assert(history.state().size === 1, "history unchanged");
  });
  scenario("unconfirmed discard never removes the recovery slot", ({ remove, click, recovery }) => {
    remove();
    click("discard");
    assert(recovery.state().hasBackup, "backup retained");
  });
  scenario("explicit discard affects only the backup", ({ remove, click, find, history, recovery }) => {
    remove();
    find("discard-confirm").checked = true;
    click("discard");
    assert(!recovery.state().hasBackup, "backup discarded");
    assert(history.state().size === 1, "live history retained");
  });
  scenario("next deletion resets old discard acknowledgement", ({ remove, find }) => {
    remove();
    find("discard-confirm").checked = true;
    remove();
    assert(!find("discard-confirm").checked, "fresh confirmation required");
  });
  scenario("context invalidation disables the prior apply", ({ remove, click, panel, find, history }) => {
    remove();
    click("preview");
    panel.invalidate();
    assert(find("apply").disabled, "cancelled preview");
    assert(history.state().size === 1, "not restored");
  });
  scenario("latest deletion keeps only its immediate predecessor", ({ remove, click, history }) => {
    remove();
    remove();
    click("preview");
    click("apply");
    assert(history.state().size === 1, "only last step undone");
    assert(history.state().snapshots[0].blockNumber === "2", "prior remaining record");
  });
  scenario("status is accessible and uses text content", ({ find, remove }) => {
    remove();
    assert(find("status").getAttribute("role") === "status", "status role");
    assert(find("status").getAttribute("aria-live") === "polite", "announcement mode");
    assert(find("details").querySelectorAll("script").length === 0, "no executable markup");
  });
  scenario("detailed report is text-only and requires a fresh apply preview", ({ remove, click, find, history }) => {
    remove();
    click("preview");
    assert(!find("apply").disabled, "preview armed");
    click("report");
    assert(find("apply").disabled, "report disarms apply");
    assert(find("details").textContent.includes("操作前の履歴・復元確認レポート"), "readable report");
    assert(find("details").textContent.includes("block 1 / hash"), "full reference");
    assert(find("details").querySelectorAll("script").length === 0, "safe text");
    assert(history.state().size === 1, "report does not restore");
    click("preview");
    click("apply");
    assert(history.state().size === 2, "fresh review restores");
  });
  scenario("stale archive details remain readable without overwriting new records", ({ remove, click, find, history, panel }) => {
    remove();
    history.add(observation("3"));
    panel.refresh();
    click("report");
    assert(find("details").textContent.includes("操作後に履歴が変わっています"), "stale warning");
    assert(find("preview").disabled, "direct recovery blocked");
    assert(find("apply").disabled, "no implicit apply");
    assert(history.state().snapshots[1].blockNumber === "3", "new record retained");
  });
  scenario("disposed controls cannot restore detached data", ({ remove, panel, find, history }) => {
    remove();
    const preview = find("preview");
    panel.dispose();
    preview.click();
    assert(history.state().size === 1, "detached callback removed");
  });
}
